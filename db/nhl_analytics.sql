-- SportsLab NHL research store — PostgreSQL 15+; schema only (no DB deployed).
-- Preserve provenance and pregame snapshots. NULL means unavailable, NEVER zero.
BEGIN;
CREATE SCHEMA IF NOT EXISTS sportslab;
SET search_path TO sportslab, public;

CREATE TABLE IF NOT EXISTS data_sources (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, base_url TEXT,
  permission TEXT NOT NULL DEFAULT 'unverified'
    CHECK (permission IN ('official_public','noncommercial_only','licensed','unverified','prohibited')),
  terms_url TEXT, attribution TEXT, verified_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS nhl_teams (
  id INTEGER PRIMARY KEY CHECK (id>0),
  abbreviation VARCHAR(4) NOT NULL, name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nhl_players (
  id INTEGER PRIMARY KEY CHECK (id>0),
  full_name TEXT NOT NULL,
  position VARCHAR(2) CHECK (position IN ('C','LW','RW','D','G')),
  shoots VARCHAR(1) CHECK (shoots IN ('L','R')),
  birth_date DATE
);
-- Allow traded players to play for several teams in the same season.
CREATE TABLE IF NOT EXISTS player_team_seasons (
  season_id INTEGER NOT NULL, player_id INTEGER NOT NULL REFERENCES nhl_players,
  team_id INTEGER NOT NULL REFERENCES nhl_teams,
  first_seen DATE, last_seen DATE,
  PRIMARY KEY (season_id,player_id,team_id),
  CHECK (last_seen IS NULL OR first_seen IS NULL OR last_seen>=first_seen)
);
CREATE TABLE IF NOT EXISTS nhl_games (
  id BIGINT PRIMARY KEY, season_id INTEGER NOT NULL,
  game_type SMALLINT NOT NULL CHECK (game_type IN (1,2,3)),
  starts_at TIMESTAMPTZ NOT NULL, local_game_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('scheduled','live','final','postponed','cancelled')),
  home_team_id INTEGER NOT NULL REFERENCES nhl_teams,
  away_team_id INTEGER NOT NULL REFERENCES nhl_teams,
  home_goals SMALLINT CHECK (home_goals>=0),
  away_goals SMALLINT CHECK (away_goals>=0),
  overtime BOOLEAN, shootout BOOLEAN,
  source_id BIGINT NOT NULL REFERENCES data_sources,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (home_team_id<>away_team_id),
  CHECK (status<>'final' OR (home_goals IS NOT NULL AND away_goals IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS game_date_idx ON nhl_games(local_game_date,starts_at);

-- One row per player-game, source-linked. Do not replace missing components with 0.
CREATE TABLE IF NOT EXISTS skater_game_logs (
  game_id BIGINT NOT NULL REFERENCES nhl_games,
  player_id INTEGER NOT NULL REFERENCES nhl_players,
  team_id INTEGER NOT NULL REFERENCES nhl_teams,
  toi_seconds INTEGER CHECK (toi_seconds>=0),
  even_strength_toi_seconds INTEGER CHECK (even_strength_toi_seconds>=0),
  pp_toi_seconds INTEGER CHECK (pp_toi_seconds>=0),
  sh_toi_seconds INTEGER CHECK (sh_toi_seconds>=0),
  goals SMALLINT CHECK (goals>=0),
  assists SMALLINT CHECK (assists>=0),
  primary_assists SMALLINT CHECK (primary_assists>=0),
  secondary_assists SMALLINT CHECK (secondary_assists>=0),
  sog SMALLINT CHECK (sog>=0),
  shot_attempts SMALLINT CHECK (shot_attempts>=0),
  blocks SMALLINT CHECK (blocks>=0),
  hits SMALLINT CHECK (hits>=0),
  pp_points SMALLINT CHECK (pp_points>=0),
  source_id BIGINT NOT NULL REFERENCES data_sources,
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (game_id,player_id),
  CHECK (toi_seconds IS NULL OR pp_toi_seconds IS NULL OR pp_toi_seconds<=toi_seconds)
);
CREATE INDEX IF NOT EXISTS skater_form_idx ON skater_game_logs(player_id,game_id DESC);

CREATE TABLE IF NOT EXISTS goalie_game_logs (
  game_id BIGINT NOT NULL REFERENCES nhl_games,
  player_id INTEGER NOT NULL REFERENCES nhl_players,
  team_id INTEGER NOT NULL REFERENCES nhl_teams,
  started BOOLEAN, -- not supplied = unknown
  toi_seconds INTEGER CHECK (toi_seconds>=0),
  shots_against SMALLINT CHECK (shots_against>=0),
  saves SMALLINT CHECK (saves>=0),
  goals_against SMALLINT CHECK (goals_against>=0),
  source_id BIGINT NOT NULL REFERENCES data_sources,
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (game_id,player_id)
);
-- Explicit model/rights record for derived expected-goals values.
CREATE TABLE IF NOT EXISTS xg_models (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL, version TEXT NOT NULL,
  source_id BIGINT NOT NULL REFERENCES data_sources,
  permitted_for_public_use BOOLEAN NOT NULL DEFAULT FALSE,
  trained_through DATE, metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (name,version)
);
-- Shooting team MUST be derived carefully for blocked-shot plays.
CREATE TABLE IF NOT EXISTS nhl_play_by_play (
  game_id BIGINT NOT NULL REFERENCES nhl_games,
  event_index INTEGER NOT NULL CHECK (event_index>0),
  period SMALLINT NOT NULL CHECK (period>=1),
  elapsed_seconds INTEGER NOT NULL CHECK (elapsed_seconds>=0),
  event_type TEXT NOT NULL, shooting_team_id INTEGER REFERENCES nhl_teams,
  event_owner_team_id INTEGER REFERENCES nhl_teams,
  shooter_id INTEGER REFERENCES nhl_players,
  goalie_id INTEGER REFERENCES nhl_players,
  home_skaters SMALLINT CHECK (home_skaters BETWEEN 0 AND 6),
  away_skaters SMALLINT CHECK (away_skaters BETWEEN 0 AND 6),
  x_coord NUMERIC(7,3), y_coord NUMERIC(7,3),
  shot_xg NUMERIC(8,7) CHECK (shot_xg BETWEEN 0 AND 1),
  xg_model_id BIGINT REFERENCES xg_models,
  source_id BIGINT NOT NULL REFERENCES data_sources,
  observed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (game_id,event_index),
  CHECK ((shot_xg IS NULL AND xg_model_id IS NULL) OR
         (shot_xg IS NOT NULL AND xg_model_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS pbp_timeline_idx ON nhl_play_by_play(game_id,period,elapsed_seconds);
CREATE INDEX IF NOT EXISTS pbp_shooter_idx ON nhl_play_by_play(shooter_id,game_id);

-- All official shifts use ELAPSED seconds in a period after clock normalization.
CREATE TABLE IF NOT EXISTS player_shifts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES nhl_games,
  player_id INTEGER NOT NULL REFERENCES nhl_players,
  team_id INTEGER NOT NULL REFERENCES nhl_teams,
  period SMALLINT NOT NULL CHECK (period>=1),
  start_second INTEGER NOT NULL CHECK (start_second>=0),
  end_second INTEGER NOT NULL CHECK (end_second>start_second),
  source_id BIGINT NOT NULL REFERENCES data_sources,
  UNIQUE (game_id,player_id,period,start_second,end_second)
);
CREATE INDEX IF NOT EXISTS shifts_interval_idx ON player_shifts(game_id,period,start_second);

-- Stints: intervals with NO skater substitution, and stable score/strength
-- (split again at a score/penalty/faceoff context change if your design requires it).
CREATE TABLE IF NOT EXISTS rapm_stints (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES nhl_games,
  period SMALLINT NOT NULL CHECK (period>=1),
  start_second INTEGER NOT NULL CHECK (start_second>=0),
  end_second INTEGER NOT NULL CHECK (end_second>start_second),
  duration_seconds INTEGER GENERATED ALWAYS AS (end_second-start_second) STORED,
  situation TEXT NOT NULL CHECK (situation IN ('5v5','4v4','3v3','pp','pk','empty_net','other')),
  score_diff_home SMALLINT,
  zone_start TEXT CHECK (zone_start IN ('offensive','defensive','neutral','on_the_fly','unknown')),
  home_rest_days SMALLINT CHECK (home_rest_days>=0),
  away_rest_days SMALLINT CHECK (away_rest_days>=0),
  lineup_verified BOOLEAN NOT NULL DEFAULT FALSE,
  home_shot_attempts INTEGER CHECK (home_shot_attempts>=0),
  away_shot_attempts INTEGER CHECK (away_shot_attempts>=0),
  home_xg NUMERIC(12,7) CHECK (home_xg>=0),
  away_xg NUMERIC(12,7) CHECK (away_xg>=0),
  xg_model_id BIGINT REFERENCES xg_models,
  source_id BIGINT NOT NULL REFERENCES data_sources,
  UNIQUE (game_id,period,start_second,end_second),
  CHECK ((home_xg IS NULL AND away_xg IS NULL AND xg_model_id IS NULL) OR
         (home_xg IS NOT NULL AND away_xg IS NOT NULL AND xg_model_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS rapm_stints_training_idx ON rapm_stints(situation,lineup_verified,game_id);
CREATE TABLE IF NOT EXISTS rapm_stint_players (
  stint_id BIGINT NOT NULL REFERENCES rapm_stints ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES nhl_players,
  team_id INTEGER NOT NULL REFERENCES nhl_teams,
  role TEXT NOT NULL CHECK (role IN ('skater','goalie')),
  PRIMARY KEY (stint_id,player_id)
);
CREATE INDEX IF NOT EXISTS stint_player_idx ON rapm_stint_players(player_id,stint_id);

-- Lineup snapshots: never confuse "expected" and "confirmed".
CREATE TABLE IF NOT EXISTS lineup_reports (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES nhl_games,
  player_id INTEGER NOT NULL REFERENCES nhl_players,
  team_id INTEGER NOT NULL REFERENCES nhl_teams,
  as_of TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed_in','confirmed_out','probable','questionable','unknown')),
  es_line SMALLINT CHECK (es_line BETWEEN 1 AND 4),
  pp_unit SMALLINT CHECK (pp_unit IN (1,2)),
  goalie_status TEXT CHECK (goalie_status IN ('confirmed','expected','backup','unknown')),
  source_id BIGINT NOT NULL REFERENCES data_sources,
  UNIQUE (game_id,player_id,source_id,as_of)
);
CREATE INDEX IF NOT EXISTS latest_lineup_idx ON lineup_reports(game_id,player_id,as_of DESC);

-- Real sportsbook quote HISTORY (not model-derived offers).
CREATE TABLE IF NOT EXISTS sportsbook_quotes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  game_id BIGINT NOT NULL REFERENCES nhl_games,
  sportsbook TEXT NOT NULL,
  market TEXT NOT NULL, period TEXT NOT NULL,
  settlement TEXT NOT NULL,
  player_id INTEGER REFERENCES nhl_players,
  team_id INTEGER REFERENCES nhl_teams,
  side TEXT NOT NULL, line NUMERIC(9,3),
  american_odds INTEGER NOT NULL CHECK (abs(american_odds)>=100),
  seen_at TIMESTAMPTZ NOT NULL,
  source_id BIGINT NOT NULL REFERENCES data_sources,
  external_quote_id TEXT,
  currency CHAR(3) NOT NULL DEFAULT 'CAD',
  CHECK (player_id IS NULL OR team_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS quote_external_unique
  ON sportsbook_quotes(source_id,external_quote_id) WHERE external_quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS quote_history_idx ON sportsbook_quotes(game_id,market,sportsbook,seen_at DESC);

CREATE TABLE IF NOT EXISTS model_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  version TEXT NOT NULL, model_kind TEXT NOT NULL,
  data_cutoff_at TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  calibrated BOOLEAN NOT NULL DEFAULT FALSE,
  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
  validation JSONB
);
CREATE TABLE IF NOT EXISTS pregame_freezes (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slate_date DATE NOT NULL, published_at TIMESTAMPTZ NOT NULL,
  github_release_tag TEXT NOT NULL UNIQUE,
  content_sha256 CHAR(64) NOT NULL,
  source_manifest JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS published_picks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  freeze_id BIGINT NOT NULL REFERENCES pregame_freezes,
  model_run_id BIGINT NOT NULL REFERENCES model_runs,
  game_id BIGINT NOT NULL REFERENCES nhl_games,
  player_id INTEGER REFERENCES nhl_players,
  quote_id BIGINT REFERENCES sportsbook_quotes,
  section TEXT NOT NULL CHECK (section IN ('top10','sgp','cross_game','scorer','other')),
  group_key TEXT, market TEXT NOT NULL,
  side TEXT NOT NULL, line NUMERIC(9,3), selection TEXT NOT NULL,
  research_quality SMALLINT CHECK (research_quality BETWEEN 0 AND 100),
  forecast_probability NUMERIC(8,7) CHECK (forecast_probability BETWEEN 0 AND 1),
  probability_calibrated BOOLEAN NOT NULL DEFAULT FALSE,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  CHECK (NOT probability_calibrated OR forecast_probability IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS picks_freeze_idx ON published_picks(freeze_id,section);
CREATE TABLE IF NOT EXISTS graded_picks (
  pick_id BIGINT PRIMARY KEY REFERENCES published_picks,
  outcome TEXT NOT NULL CHECK (outcome IN ('hit','miss','push','void','pending','ungraded')),
  observed_value NUMERIC(10,3),
  source_id BIGINT REFERENCES data_sources,
  final_verified BOOLEAN NOT NULL DEFAULT FALSE,
  graded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  process_review JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE TABLE IF NOT EXISTS rapm_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  season_id INTEGER NOT NULL, training_cutoff TIMESTAMPTZ NOT NULL,
  strength TEXT NOT NULL DEFAULT '5v5',
  target TEXT NOT NULL CHECK (target IN ('corsi_for60','xgf_per60','goals_for60')),
  model_version TEXT NOT NULL,
  ridge_alpha DOUBLE PRECISION NOT NULL CHECK (ridge_alpha>0),
  cross_validation TEXT NOT NULL DEFAULT 'grouped_by_game',
  trained_stints INTEGER NOT NULL CHECK (trained_stints>=0),
  training_seconds BIGINT NOT NULL CHECK (training_seconds>=0),
  xg_model_id BIGINT REFERENCES xg_models,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (target<>'xgf_per60' OR xg_model_id IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS rapm_coefficients (
  rapm_run_id BIGINT NOT NULL REFERENCES rapm_runs ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES nhl_players,
  team_id INTEGER NOT NULL REFERENCES nhl_teams,
  offensive_per60 DOUBLE PRECISION NOT NULL,
  defensive_against_per60 DOUBLE PRECISION NOT NULL,
  observed_seconds INTEGER NOT NULL CHECK (observed_seconds>=0),
  sample_stints INTEGER NOT NULL CHECK (sample_stints>=0),
  PRIMARY KEY (rapm_run_id,player_id,team_id)
);
CREATE INDEX IF NOT EXISTS rapm_player_idx ON rapm_coefficients(player_id,rapm_run_id);

-- Example: rows for later L5/L10 calculations. Filter by pregame cutoff BEFORE ranking.
CREATE OR REPLACE VIEW player_shot_history AS
SELECT s.player_id,p.full_name,g.starts_at,g.local_game_date,s.game_id,
       s.sog,s.toi_seconds,
       s.sog * 3600.0 / NULLIF(s.toi_seconds,0) AS sog_per60
FROM skater_game_logs s
JOIN nhl_games g ON g.id=s.game_id
JOIN nhl_players p ON p.id=s.player_id
WHERE g.status='final';

COMMIT;

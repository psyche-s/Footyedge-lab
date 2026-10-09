-- Run with: psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/export_nhl_rapm.sql
-- Writes nhl_rapm_stints.csv into the local working directory (psql client).
-- Goalie IDs are intentionally excluded: this first model is 5v5 skater Corsi RAPM.
-- Stints must have independently validated lineups/event attribution BEFORE use.
BEGIN;
CREATE TEMP VIEW sportslab_rapm_training_export AS
SELECT
  s.id AS stint_id,
  g.id AS game_id,
  g.season_id,
  g.local_game_date,
  g.starts_at,
  s.duration_seconds,
  s.score_diff_home,
  s.zone_start,
  s.home_rest_days,
  s.away_rest_days,
  s.home_shot_attempts,
  s.away_shot_attempts,
  jsonb_agg(jsonb_build_object('player_id',p.player_id,'team_id',p.team_id)
      ORDER BY p.player_id) FILTER
        (WHERE p.team_id=g.home_team_id AND p.role='skater') AS home_skaters,
  jsonb_agg(jsonb_build_object('player_id',p.player_id,'team_id',p.team_id)
      ORDER BY p.player_id) FILTER
        (WHERE p.team_id=g.away_team_id AND p.role='skater') AS away_skaters
FROM sportslab.rapm_stints s
JOIN sportslab.nhl_games g ON g.id=s.game_id
JOIN sportslab.rapm_stint_players p ON p.stint_id=s.id
WHERE s.situation='5v5' AND s.lineup_verified=TRUE
  AND g.status='final'
  AND s.home_shot_attempts IS NOT NULL AND s.away_shot_attempts IS NOT NULL
  AND s.duration_seconds>=5
GROUP BY s.id,g.id
HAVING COUNT(*) FILTER(WHERE p.role='skater' AND p.team_id=g.home_team_id)=5
   AND COUNT(*) FILTER(WHERE p.role='skater' AND p.team_id=g.away_team_id)=5;

\copy (SELECT * FROM sportslab_rapm_training_export ORDER BY starts_at,game_id,stint_id) TO 'nhl_rapm_stints.csv' WITH (FORMAT csv,HEADER true)
ROLLBACK;

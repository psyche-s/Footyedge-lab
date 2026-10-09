# SportsLab NHL analytics database and RAPM

This is a **PostgreSQL 15+ schema**, an offline CSV export and a Python **research prototype**. Neither a database, crawler, third-party data license, nor an active site feature is provisioned by committing these files.

## What each table stores

| Domain | Tables | Important safeguard |
| --- | --- | --- |
| Attribution | \`data_sources\`, \`xg_models\` | Official stats and derived/licensed expected-goals values are different observations. No licensed xG automatically inherited. |
| NHL identity | \`nhl_teams\`, \`nhl_players\`, \`player_team_seasons\` | Stable NHL IDs; trades keep separate team-season membership. |
| Historical games | \`nhl_games\`, \`skater_game_logs\`, \`goalie_game_logs\` | UTC timestamp **and** local NHL fixture date; missing values stay NULL. |
| Play-by-play | \`nhl_play_by_play\` | Preserve shot owner, **shooting team**, official event ID, ice-strength, coordinates and optional model-based shot xG. On blocked shots, event-owner may not be the shooting team. |
| Actual ice time | \`player_shifts\`, \`rapm_stints\`, \`rapm_stint_players\` | Player shift interval vs. stable on-ice lineup interval are not interchangeable. Do not train on incomplete stints. |
| Availability | \`lineup_reports\` | Confirmed lineup, expected starter and rumours distinguished by original source timestamp. |
| Market observation | \`sportsbook_quotes\` | Exact book, period, settlement, line, odds and time; store quotes only when independently confirmed from permitted feeds. |
| Backtesting | \`model_runs\`, \`pregame_freezes\`, \`published_picks\`, \`graded_picks\` | Preserve original model and price evidence as of the pregame freeze. Never invent a historical selection after final. |
| Adjusted skater impact | \`rapm_runs\`, \`rapm_coefficients\` | Store version, forward-validation performance, alpha, training cutoff and player-team offensive/defensive coefficients. |

Schema: [\`db/nhl_analytics.sql\`](nhl_analytics.sql)

## Setup (after an owner supplies a real PostgreSQL database)

\`\`\`bash
# Owner-managed server / DB only, not client-facing website JS.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/nhl_analytics.sql
# Must first ingest authorized game, shift, PBP and roster data.
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f db/export_nhl_rapm.sql
python -m pip install numpy pandas scipy scikit-learn
python scripts/train_nhl_rapm.py --csv nhl_rapm_stints.csv \
  --season 20252026 --cutoff 2026-04-01 --out rapm.json
\`\`\`

**Do not** put \`DATABASE_URL\`, credentials or other secrets into GitHub public files or frontend HTML. Provisioning a managed PostgreSQL server (e.g. a free tier subject to limits) is a separate owner decision. Imported data needs retention, backups, provenance and usage terms review.

## What is RAPM?

*Regularized Adjusted Plus-Minus* attempts to isolate a skater's impact from teammates, opponents and game situation.

Raw +/- or on-ice CF% conflates a player's own contribution with the strength of their linemates and opponents. RAPM instead builds a matrix of each **stint** — uninterrupted 5v5 time with a known set of five skaters on each side and a known outcome count — with an **offense** column and **defense** column for each player. Teammates all have their offense column active while their opponents all have their defense column active. Each stint produces two team-centric observations, one for home and one for away.

### Ridge-regression equation

For an attacking team's shots per 60 in stint \`s\`:

\`\`\`text
attempts_for_per60[s] ≈
  league_intercept
  + Σ offensive_contribution[p] for on-ice attacking skaters p
  + Σ defensive_against_contribution[q] for on-ice defending skaters q
  + home/road and score/zone/rest controls
\`\`\`

Coefficients are estimated by minimizing

\`\`\`text
Σ over stints (stint_seconds × (observed_CF60 − predicted_CF60)²)
+ λ × Σ over player coefficients (β²)
\`\`\`

This is **duration-weighted ridge regression**. The L2 penalty \`λ\` limits unstable player effects when teammates always play together and low-minute players have a few lucky events. \`λ\` must be selected through held-out games; do **not** optimize on the same future date being predicted.

- **+2 CF/60 on offense**: when the player's effects are adjusted for those other modeled factors, the team generated ~2 more shot attempts per 60 versus baseline in the training sample; not 2 guaranteed extra attempts tonight.
- **−1.5 CA/60 on defense** (defensive-against coefficient): adjusted opponents generated fewer attempts. **Negative is good** on this specific defense metric.
- RAPM-Corsi/Fenwick is a **possession/volume** factor. RAPM-xG can be more useful for chance quality only when licensed/validated shot xG exists; RAPM-goals is substantially noisier. This is **not** identical to true skill, player goals, shot-over hit probability or causality.

Main methodological reference: [Evolving-Hockey RAPM methodology](https://evolving-hockey.com/glossary/regularized-adjusted-plus-minus/), [their longer technical walkthrough](https://evolving-hockey.com/blog/reviving-regularized-adjusted-plus-minus-for-hockey/).

### Building the stint table correctly

1. Ingest NHL's official game schedule, rosters and official **shift charts**, keeping original player/game IDs and source timestamps.
2. Transform period countdown clocks to a consistent elapsed-clock representation. Build interval boundaries for every substitution, faceoff state transition and manpower/score change relevant to the target model. **A single player shift is NOT the same thing as one complete 10-player on-ice stint.**
3. Identify exactly five skaters per side at 5v5; goalies are excluded from this initial **skater** Corsi model. Filter out any incomplete/ambiguous lineups. Confirm same 5v5 status using on-ice manpower, not just whether a penalty was called.
4. Normalize event-type taxonomy and attribute Corsi shots to the **shooting team**, not blindly to NHL's official event owner for blocked shots. \`Corsi = goals + saved SOG + missed + blocked attempts\`; \`Fenwick = goals + saved SOG + missed\`.
5. Attribute event timestamps to exactly one reconciled stint and count each event only once; avoid goal/shot duplication (goals already count as shot attempts).
6. For each stint calculate observed Corsi For per60 separately for both teams and sample weight = stint duration in seconds.
7. Add home, score differential, zone start, rest, and optional known deployment effects. A 5v5 model cannot quietly learn PP/PK outcomes from the same training rows.
8. Train \`scripts/train_nhl_rapm.py\` from the CSV export; its simple prototype groups two team observations by the **same game** and uses forward-in-time game splits to select ridge alpha. Keep the training date strictly earlier than each prediction's frozen cutoff. Inspect games with unexpectedly large estimates before any production use.
9. Validate: future-game weighted RMSE and year-over-year stability; enough independent games; sample size and minutes per player. Don't present wildly unstable coefficient rankings for tiny samples.
10. Store coefficients with exact run ID and training cutoff. Refit only from newly finalized authorized historical data; never derive retrospective "pregame" values using postgame inputs.

### As-of historical player-shot query

For player \`8478402\`, the full list of pregame observations as of a fixed model cutoff:

\`\`\`sql
SELECT h.local_game_date, h.game_id, h.sog, h.sog_per60
FROM sportslab.player_shot_history AS h
JOIN sportslab.skater_game_logs AS s
  ON s.game_id = h.game_id AND s.player_id = h.player_id
WHERE h.player_id = 8478402
  AND h.starts_at < TIMESTAMPTZ '2026-10-09 16:00:00-04'
  AND s.observed_at <= TIMESTAMPTZ '2026-10-09 16:00:00-04'
ORDER BY h.starts_at DESC
LIMIT 10;
\`\`\`

L5 uses LIMIT 5 with the **same filters**. Calculate hit rate for a *given actual sportsbook line*, not a threshold chosen after viewing outcomes.

### Applying RAPM to SportsLab without overclaiming

- **SOG props:** first evaluate individual shots/60 and projected minutes; use RAPM-Corsi of the player's line and opponent defense to adjust **team shot environment**, then check actual H2H floors, lines, goalie/lineup.
- **Goalscorers/assists:** evaluate shot quality and playmaking opportunity separately. Strong Corsi alone does not confer finishing/assisting ability; PP1 assignments and teammate role must be independently confirmed.
- **Game ML/totals:** RAPM, quality-of-chance and goalie components complement, not replace, calibrated team strength, lineup/rest, season form and exact odds.
- **Fantasy:** a player driving play can matter for points indirectly and for role stability, but fantasy leagues have distinct shots/hits/blocks scoring. Use \`lib/nhl-opportunity.js\` with actual league weight settings rather than using RAPM as fantasy-point values.
- **Don't invent +EV:** SportsLab's \`lib/market-intelligence.js\` computes no-vig, theoretical EV, arb and line movement **only with valid source-specified odds and credible calibrated probability/market baseline**.

### Three cautions before calibrating weights

- **PDO** (5v5 on-ice shooting% + save%) describes past finishing/goaltending variation; a value above 103 or below 97 does **not** justify an automatic fade/buy. High goalie talent, chance quality, team effects and tiny samples mean the expected future value may not be 100 for that specific team.
- **Fatigue adjustments:** the circulated 3%–5% back-to-back reduction is a hypothesis, not an established universal coefficient. Fit rest and schedule factors on historical as-of data; allow different effects for home/away travel, goalie confirmations and matchup.
- **Linear opponent pace multiplier:** \`player_base_shots × (opponent shots allowed / league average)\` is a reasonable *candidate feature*, not an independently validated final SOG projection. Check opponent shot mix, individual TOI, position allowed, team possession and score-state effects; shrink small-sample ratios toward league average and backtest out-of-sample.

## Deployment status

These SQL/Python assets are committed to GitHub. No PostgreSQL instance was created, and they are **not running in the live NHL picks workflow**. To activate RAPM, first obtain real authorized shift/PBP data and provision a database, then train/validate the output and explicitly map it to SportsLab's pregame research pipeline. No UI overhaul is necessary until verified coefficients exist.

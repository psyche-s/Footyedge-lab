# SportsLab NHL 5v5 roll-out — October 9, 2026

**Today:** Kraken at Red Wings, Rangers at Capitals and Penguins at Blue Jackets at 7 PM ET; Ducks at Jets at 8 PM ET. Friday's official-source NHL publication is configured for 4:00 PM Toronto time, three hours before the earliest game.

## Implemented in repository

- NHL official club schedules and gamecenter play-by-play supply **up to three prior completed regular-season games per team**, maximum 24 distinct PBP games for the slate.
- Accept only regulation 5v5 events (situation code 1551). A blocked-shot event is attributed to the **opposite** of the event owner, because the owner is the blocker. Goal events count as one shot attempt.
- Calculate 5v5 **Corsi CF%, Fenwick FF%, attempts, shots on goal for/against per game and observed PDO**, plus a geometry-only inner-slot shot-location proxy. The location proxy is **not** official high-danger chances or expected goals.
- Strictly exclude games dated on or after the slate. Exclude unfinished games, unverified team IDs and missing dates.
- Attach team/opponent possession and historical **TOI L5/L10, shots per 60 and power-play points** to free NHL SOG, goalscorer and assist selections. If PBP fails, keep verified player-game logs rather than invent possession.
- NHL model quality labels prior-season possession samples as limited and allows only restrained quality adjustments once three or more current-season games support a signal. PDO does not automatically generate an over/under or buy-low pick.
- NHL cards have a detailed CF/FF matchup display in new UI code. Until Vercel deploy quota resets, the same summary is placed into the older live card's **Why this pick?** explanation via the published JSON.
- One-minute in-process cache shares the 5v5 research between ranked and scoring requests. Release JSON compacts duplicated team context while retaining player L10 graphs.
- GitHub Actions at 4 PM October 9 uses **current main official free NHL data** rather than the older deployed Vercel response, then archives a pregame freeze.

## Validation and limitations

- 8/8 NHL PBP/collector tests passed with official-shaped mock events; 9/9 existing odds and NHL opportunity tests passed.
- Mock four-game slate (eight teams) returned 10 ranked SOG candidates, 3 SGP research combinations and historical possession context.
- Publisher compaction test stayed below the 110 KB GitHub Release size safeguard and retained L10 game logs.
- Existing production NHL fallback returned all four October 9 games and game-log props.
- **New UI not live:** Vercel rejected an additional build with HTTP 402 daily Hobby deployment limit.
- **Actual RAPM not trained or live:** PostgreSQL schema and offline Python ridge trainer exist, but complete shift-aligned historical stints, a database, validation and calibrated coefficients do not. xG, GSAE, starting goalie, PP1, injuries and sportsbook odds are likewise not inferred from these sources.
- A scheduled 4 PM job is not proof of a published board; verify the timestamp in GitHub Release sportslab-board-nhl and the SportsLab published-board endpoint afterward.

## Code

NHL possession: lib/nhl-possession.js; NHL fallback: lib/free-nhl.js; model: lib/model-quality.js; UI: index.html; serializer: scripts/publish-board.js; schedule: .github/workflows/publish-board.yml; RAPM offline preparation: db/nhl_analytics.sql and scripts/train_nhl_rapm.py.

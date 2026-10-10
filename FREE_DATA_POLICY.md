# SportsLab free-data fallback policy

SportsLab's first job is to publish fully labeled daily Top Player Props, SGP research combinations, a Cross-Game Parlay if enough games qualify, and separate Top Scoring Picks. **Missing verified inputs do not become fabricated odds, injury statuses, or confidence percentages.**

## Source order and operating modes

1. **Primary (optional):** StatsHawk player, lineup, game-log and sportsbook-linked research when available and within account quota. Never assume a provider response represents bet365, DraftKings or FanDuel unless the offer actually identifies that sportsbook, line, market, timestamp and team/player.
2. **Independent public fallback (no signup/key):**
   - **NHL:** `api-web.nhle.com/v1/score/{date}` for upcoming regular-season games; `/roster/{team}/current` to constrain eligible players; `/club-stats/{team}/{season}/2` for team skater usage; `/player/{id}/game-log/{season}/2` for actual recent and prior-season regular-season results. Bench role, power-play line, in/out status and sportsbook prices are not verified from a roster alone.
   - **MLB:** `statsapi.mlb.com/api/v1/schedule?sportId=1&date=...&hydrate=probablePitcher` for matchup and probable starters; `/game/{gamePk}/boxscore` only for real nine-player batting orders; `/people/{id}/stats?stats=gameLog&season=...&group=hitting|pitching` for game logs. Pitcher outs convert baseball IP: 5.2 IP = 17 outs. If a lineup is unconfirmed, HR selections requiring that lineup are withheld.
   - **NBA:** ESPN public NBA regular-season schedule, roster and player game logs. NBA CDN schedule, documented by open-source `swar/nba_api`, serves as an optional scoreboard fallback. Calculate descriptive player points/rebounds/assists/made threes and recent minutes; do not mix preseason or postseason logs with regular-season thresholds. Source access and reuse remain subject to provider terms; no inferred game-day starters, projected minutes, betting lines or odds.
   - **NFL:** ESPN public NFL scoreboard for current matchups; direct nflverse per-season CSV releases `stats_player/stats_player_week_{season}.csv` plus NFL schedule `raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv` for per-game, player/team/position historical stats. If ESPN fails, the public nflverse schedule can supply games with explicit kickoff-time uncertainty. Game-day actives, depth-chart changes, sportsbook odds and injuries are *not* verified by weekly box-score files.
3. **Schedule fallback:** SportsLab games endpoint checks ESPN first, then official NHL, MLB or NBA schedules when ESPN fails. NFL uses ESPN for the main scoreboard with nflverse schedule research independently available.

Public research answers have `fallback: true`, `sources`, `warnings`, exact raw historical logs, and no sportsbook price. The UI clearly labels “Public-data fallback active.” Player graphs use these same cached response values (no additional StatsHawk request). No provider switch should require user input.

## Safe operational guardrails

- Fall back automatically when StatsHawk is absent, runs out of quota, or produces no qualifying picks. Don't retry a 429 aggressively.
- Bound source requests by league; parallel batches limit fan-out and caching reduces repeated work. League data may be delayed, changed, or rate limited without notice.
- Never publish false exact odds, inferred betting lineups or a guessed combined payout.
- Never force 3 SGPs, 10 picks, a cross-game parlay, or scoring picks when the verified sample is insufficient.
- Observed L5/L10 hit rates and evidence rankings are descriptive, **not** calibrated probabilities. Distinguish a model threshold from an actually posted bookmaker line.
- Include source attributions, unavailable/uncertain statuses and sample size. The program should not imply that public endpoints have an official commercial SLA.

## Optional secondary services

**API-Sports** advertises a free tier of 100 requests/day *per API* after signup. It can be configured later as a structured tertiary input (especially injuries or lineups) with a server-side key and rate monitoring; it is *not* currently connected and free-access data availability varies.

**MySportsFeeds** advertises a 14-day free trial and possible discretionary personal-use deals. It is not an enduring guaranteed-free automated fallback.

**sportsipy / Sports-Reference scraping** is not used as an operational dependency. Sports Reference imposes bot rate limits and its HTML structures can change; “local Python” does not remove the service restrictions.

**nflreadr / nflreadpy** are optional for offline analytics. SportsLab uses nflverse's published season CSV directly from the Node backend instead of relying on a Python runtime or the deprecated `nfl_data_py` package.

### References

- NHL web API community documentation: https://github.com/Zmalski/NHL-API-Reference
- MLB StatsAPI endpoint reference: https://github.com/toddrob99/MLB-StatsAPI/wiki/Endpoints
- nflverse/nflreadr data release conventions: https://github.com/nflverse/nflreadr/blob/main/R/load_stats.R
- NFL schedule CSV: https://github.com/nflverse/nfldata/blob/master/data/games.csv
- API-Sports: https://api-sports.io/
- MySportsFeeds: https://www.mysportsfeeds.com/data-feeds
- Sports-Reference bot policy: https://www.sports-reference.com/bot-traffic.html

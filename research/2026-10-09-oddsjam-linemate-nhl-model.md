# SportsLab study — OddsJam, Linemate, Pikkit and NHL analytics
**Research date:** 2026-10-09  
**Scope:** fantasy hockey strategy, player/team betting models, and lawful data engineering. SportsLab remains a free public research website, not a sportsbook. Do not auto-place bets or advertise guaranteed returns.

## Source verification / limitations

- **OddsJam video** https://youtu.be/WBiZCFxS2FY — a separately indexed promotional email identifies it as a tutorial about **arbitrage, positive expected value (+EV), and middle betting**. The playable video/transcript was unavailable through the research interface. Do **not** claim to have watched its precise demonstrations or verified any personally claimed winnings. Source: https://milled.com/oddsjam.com/why-99-of-nfl-bettors-will-lose-again-this-year-Raid0IYdcmw5qzQM
- **OddsJam confidence article** https://oddsjam.com/betting-education/what-is-confidence-in-sports-betting — returned **404** at research time. The article's precise confidence definitions are unknown. Cross-check general odds math against the accessible official OddsJam guides and calculators, not a reconstructed quotation: https://oddsjam.com/betting-education/oddsjam-introduction-guide-and-tips-for-your-sharp-betting-journey and https://oddsjam.com/betting-calculators
- **Linemate sports-betting app**, https://linemate.io and https://apps.apple.com/ca/app/linemate-find-your-next-bet/id1635246793, offers public-facing player prop screens with recent-game data, hit-rate splits, matchup opponent H2H, line/odds, injuries and contextual advanced trends; developer updates in May/June 2026 mention deeper injury/lineup and opponent comparisons. Basic app free with optional purchases. **No published, reusable developer feed or licensing path was verified.** Use for manual cross-checking or request commercial API/partnership permission; never automate login, reverse engineer private endpoints, or redistribute Linemate pages. Beware unrelated hobby hockey site \`linemate.app\`.
- **Pikkit / OddsJam screenshot** appears to show price movements, an arbitrage marketing claim, Pro Center movers, and partner promotions. Those screenshots are *illustrations*, not current SportsLab book quotes or independently audited bettor P&L. Pikkit feeds are not licensed for automatic republishing.
- **MoneyPuck**, https://moneypuck.com/data.htm, provides downloadable NHL public CSV/ZIP datasets with detailed event-level xG, game-by-game player/goalie/line metrics. The owner explicitly permits **noncommercial** use with required credit. **Commercial/other use requires separate permission; unapproved scraping is blocked.** Since SportsLab is a public website with potential optional donations, request permission before public redistribution or serving derived licensed data in automated summaries.
- **Natural Stat Trick** public hockey visuals/CSV can inform validation of five-on-five Corsi, Fenwick, scoring chance and HDCF splits. Public site blocked automated access during research. **No blanket right to scrape or rehost** has been established. Prefer official NHL play-by-play derived metrics or ask for license.
- **NHL EDGE** https://edge.nhl.com — public user-facing NHL tracking views for speed, shot velocity, zone time and shot locations. **No approved public bulk tracking API/redistribution rights were verified.** Treat as manual verification, not a free automated feed.
- **PuckCast guides**, https://puckcast.ai/guides and https://puckcast.ai/advanced-hockey-stats-explained, useful for metric definitions and calibration literacy; do not copy proprietary game picks or claim its 98-feature model belongs to SportsLab.
- **NHL official web endpoints**, \`api-web.nhle.com/v1\`, are presently the best no-key source of structured game logs and play-by-play; retain clear NHL source attribution, modest request rates and usage-terms checks. Community endpoint map: https://github.com/pseudo-r/Public-NHL-API/blob/main/docs/web-api/players.md

## Critical separation: probability, evidence quality, +EV, movements and arb

1. **Observed historical hit rate**: e.g., 9 of 10 games above the specified line. A 90% L10 sample is **not** a demonstrated 90% chance next game; an approximate independent-binomial 95% Wilson interval is ~59.6%–98.2% even before role, era, opponent, season and selection-bias issues. SportsLab must publish the exact numerator and sample denominator.
2. **Research/evidence score**: quality of samples, verification, opponent defense, role, H2H floor, trend stability, injuries and correlation. It is *not* 85–95% predicted win probability.
3. **Calibrated predicted probability**: requires actual pregame dated forecasts compared against subsequent independently graded out-of-sample outcomes, stratified by sport, market, line and sample size. Metrics include Brier score, log loss, observed-versus-predicted calibration and coverage. Until then, the label must say “research strength” or “market proxy”.
4. **Market implied probability**: a two-sided sportsbook -110 / -110 market embeds vig (each side implies ~52.38% before vig removal). A no-vig normalization yields a **market-based** 50% proxy, not necessarily a true probability.
5. **Positive expected value**: after a credible estimated \`p\` and exact currently offered decimal price \`d\`, \`EV ROI = p*d - 1\`. Value is about **price**, not just “how likely” the team is to win. A -400 selection may have a high probability and still be overpriced.
6. **Line movement**: compare **identical** event, book, side, player, market, line, period and settlement at two ordered timestamps. Changes in American-odds magnitudes, screenshots labelled “+136.7% increase,” price boosts or book-feed reordering do **not** mean +136.7 percentage points in winning probability. Prefer change in book-implied probability in **percentage points**, with the origin and time shown. Extreme jumps must be verified against alternate books and line changes.
7. **Theoretical arbitrage**: for *all exhaustive complementary outcomes* at decimal prices \`d1\` and \`d2\`, there is a theoretical positive two-way gross margin only if \`1/d1 + 1/d2 < 1\`. Balanced stakes are proportional to \`1/d1\` and \`1/d2\`. **Operationally it is not guaranteed risk-free**: bets may be rejected, odds move mid-entry, limits differ, void/retirement rules differ, exchange commission/currency changes payout, player availability/settlement differs, and sportsbook accounts can be restricted. Full-game two-way NHL ML is *not* the same market as 60-minute three-way ML.
8. **Middle betting**: two positions with an overlapping interval in which both tickets might win. The overlapping win is contingent, not guaranteed. Requires explicit settlement boundaries and exposure calculation.

**Check against screenshot (not a live quote):** WSH -1.5 +190 and NYR +1.5 -210 imply approximately 34.48% and 67.74%, respectively, total **102.22%**. They are *not* an arbitrage combination even though an odds-movement chart looks eye-catching.

## NHL feature priorities — what each should predict

| Metric | What it really captures | NHL prop impact | Data/readiness |
|---|---|---|---|
| Shots, shot attempts and shots per 60 | Repeatable volume/attempt share | **SOG first**, as independent of shooting conversion as possible | NHL official logs; now in SportsLab |
| TOI L5/L10, PP points & deployment changes | Actual opportunity; extra minutes are valuable | Shots, goals, assists, fantasy | Official logged TOI/PP point values. PP1 still unconfirmed |
| 5v5 Corsi / Fenwick, ideally score-adjusted | Shot-attempt possession and unblocked attempts | Team shot environment; team totals only alongside shot quality | Official NHL PBP after correct shooting team/strength normalization; helper ready |
| Individual expected goals (ixG), danger-zone shots and rebounds | Quality of player's scoring chances | ATGS, points, assists indirectly | Require authorized xG data or a calibrated independent shot model; NOT currently populated |
| xGF/60, xGA/60, HDCF and PK weakness | Team quality at 5v5 / power play | Opponent matchup for SOG and scoring markets | Permission/data qualification needed |
| Starting goalie, saved-above-expected & confirmed lines | Goal suppression & teammate usage | Goal props and game totals, sometimes shooting persistence | Must verify; “probable” ≠ confirmed |
| Corsi/Fenwick vs shooting% and save% (PDO) | Process versus recent conversion/goaltending variance | Avoid chasing 7-goal games without checking chance volume | Data granularity and adequate sample needed |
| H2H last five, opponent position and line matchups | Useful context, heavily role-dependent | Last-mile ranking, not dominant prior | Preserve actual minutes, specific position/line scheme |
| Rest/travel/back-to-back/home change | Playstyle & deployment shifts | Game totals, goalie loads, expected shifts | Official schedules, historically validate sign/magnitude |

**Important correction to circulated advice:** the assertion that CF%, team SH% and goalie SV% together explain **~95% of NHL goal-share variance** is not an established general betting-model finding. On-ice shooting/save percentages relate *mechanically* to goal share, but explaining historical goals is not the same as out-of-sample predicting future outcomes. Do not build weights from this claim.

### Fantasy hockey workflow

- Use an explicit user-selected fantasy league scoring map (goals, assists, SOG, PP points, blocked shots, hits and goalkeeper categories); never guess league-specific rules.
- Rank **opportunity/TOI role before raw points**. Separate skaters with stable minutes from hot finishing on limited minutes, evaluate even-strength combinations and actual PP1/PP2 if verified.
- Keep per-60 shot attempt/expected chance rate, shot volume, zone starts, projected schedule frequency, rest, injuries and opponent matchup separate.
- Missing data is **unavailable**, not zero. A free NHL game-log with no blocked shot or hits field cannot silently calculate an ESPN/Yahoo fantasy scoring projection using those categories.
- Label early-season rolling L10 that crosses prior season versus actual current-season games. Large roles often change between years.
- Add optional fantasy scoring calculator/lineup mode later; it is **not** a replacement for the daily prop picks.

### NHL betting-model workflow

1. Pre-game freeze and source versioning three hours before first league game; mark goalie, PP1 and significant changes separately.
2. Evaluate each prop-market in order: current lineup/role validity → sample quality → volume per time → team attempts/shot quality → opponent position/PK/line matchup → H2H floors → exact alternate line → available book price.
3. For goal scorers require quality of chances (ixG, location and PP role) whenever authorized data exists; SOG hit rate alone does not establish goal probability.
4. Distinguish goals/assists from more repeatable shot/reception volume markets. For individual player 2+ shots, a binomial hit rate may be useful descriptive evidence, but a **projection** needs a stable rate/distribution (Poisson or overdispersed alternatives) tested out-of-sample by sport and role.
5. Evaluate team ML/total using calibrated team strength, goalie confirmation, special teams, shooting vs expected and home/rest effects; a favourite's -400 odds are **not** automatically a good bet.
6. Use multiple distinct price sources only when authorized. Require both sides of a given book for no-vig or several sharp-book pairs for a market proxy. Do not derive EV from an uncalibrated quality score.
7. A multi-leg SGP must not multiply independent hit rates when props share a line, goalie, power play or game script. Quote correlation analysis or label “unverified combination”.
8. Review from frozen picks only. Track total qualified plays, net ROI at **original offered odds**, closing-line value and score calibration; differentiate good process/bad variance from genuine model miss. Reweight only after sufficiently diverse archived samples.

### Coding / data pipeline

- Current pure helpers: \`lib/market-intelligence.js\` computes American↔decimal, implied/no-vig market probabilities, source-gated EV, theoretical 2-way arb with strict market/settlement validation, opening→latest market movement, Wilson bounds and CLV proxy.
- Current pure helpers: \`lib/nhl-opportunity.js\` parses actual logged TOI, last-five versus prior minutes, shots/60, PP points, example **configurable** fantasy scoring, and Corsi/Fenwick from explicitly normalized 5v5 PBP events. It **does not** pretend to produce xG.
- Current fallback integration: \`lib/free-nhl.js\` adds real NHL TOI/shot opportunity fields to player and scorer candidates; \`lib/model-quality.js\` flags 2+ minute recent TOI declines **only after eight same-season games** to avoid crossing the offseason as a trend.
- Interface: NHL prop/scorer cards show L5/L10 TOI, shot rate per60 and PP points with “early season sample” warning. They remain historical observations, not a PP1 lineup confirmation.
- Market module is internal **ready-for-authorized-prices**, not active odds scraping or an arbitrage alert feed. To activate daily live value/arbitrage, source a permitted quote API, establish book coverage in Ontario and freshness SLAs, and validate market IDs, void rules and latency.
- Do **not** add an unauthorized Linemate API, scrape MoneyPuck/Natural Stat Trick, or assert that the 2026 NHL EDGE public visualizer grants programmatic redistribution rights.
- Testing: \`node --test tests/market-and-nhl-opportunity.test.js\`; nine data integrity checks cover +EV, arb/screenshot non-arb, same-market settlement, odds-movement line matching, TOI and 5v5 attempts.

## Implementation stages

1. **Shipped in GitHub (awaiting production check):** safe math modules, verified NHL opportunity indicators, tests and UI detail panels; no licensed third-party content redistribution.
2. **Next permitted data integration:** normalizing NHL official PBP 5v5 team shot-attempt data, goalie-confirmation and power-play-role evidence; do not misread blocked-shot owner attribution.
3. **After external permission:** optional MoneyPuck game/player xG and line CSV ingestion with credit and provenance; or an independently calibrated in-house shot-quality model.
4. **After licensed sportsbook quote feed:** +EV, line shopping, opening/closing line history, arb/middle **alerts** with execution-risk disclaimers, market scope and data freshness.
5. **After a meaningful archived history:** model-specific calibration, reliability plots, CLV, ROI and confidence intervals on actual original picks—not borrowed win-rate marketing claims.

## Source links

- https://oddsjam.com/betting-education/oddsjam-introduction-guide-and-tips-for-your-sharp-betting-journey
- https://oddsjam.com/betting-calculators
- https://milled.com/oddsjam.com/why-99-of-nfl-bettors-will-lose-again-this-year-Raid0IYdcmw5qzQM
- https://apps.apple.com/ca/app/linemate-find-your-next-bet/id1635246793
- https://linemate.io
- https://puckcast.ai/guides
- https://puckcast.ai/advanced-hockey-stats-explained
- https://moneypuck.com/data.htm
- https://www.nhl.com/news/topic/nhl-edge/nhl-edge-site-new-look-has-advanced-statistics-for-everybody
- https://github.com/pseudo-r/Public-NHL-API/blob/main/docs/web-api/players.md

# October 8, 2026 — SportsLab NHL / NFL / MLB model audit

**This is an independent retrospective game study, NOT a grading of SportsLab's pregame predictions.** There is no confirmed frozen October 8 pick archive. A pick or SGP counts as a model hit/miss only if the *exact selection, line and timestamp* were published before that game's start.

Source: ESPN public scoreboard through SportsLab, checked late October 8 ET, plus official NHL recaps and the NFL scoreboard. Two West Coast NHL matches and the MLB game were still in progress at the checkpoint.

## NHL — all ten October 8 games

| Match | Result at checkpoint | Status | Important model finding |
| --- | --- | --- | --- |
| Philadelphia at Ottawa | 1–2 | Final | Low-scoring game; Ottawa's William Eklund exited injured. Player usage is not a fixed constant. |
| Utah at Boston | 1–6 | Final | Utah outshot Boston 37–22. Boston had three power-play goals. Team shots and actual goals can diverge. |
| Dallas at Buffalo | 4–0 | Final | Dallas scored four on 18 shots; Buffalo had 26 shots but no goals. Goaltending and conversion matter. |
| Nashville at Montreal | 5–2 | Final | Two Nashville goals went into an empty net. Totals can change significantly due to late goalie-pull strategy. |
| Minnesota at Tampa Bay | 2–3 | Final | John Carlson scored twice, Kucherov assisted twice; backup Hildeby made 34 saves. Check goalie and defensive scoring role. |
| Vancouver at Carolina | 2–7 | Final | Stankoven 3 goals, Svechnikov 2, Walker 4 assists. Three Carolina power-play goals drove interrelated props. |
| Chicago at NY Islanders | 1–4 | Final | Horvat two goals, including empty-netter; defence had shifted due to injury. Team-line role and goalie pull matter. |
| San Jose at St. Louis | 3–2 | Final/OT | Darnell Nurse scored in OT; Celebrini absent. Full-game ML includes OT but 60-minute markets can settle differently. |
| Colorado at Calgary | 7–3 | In progress | Already ten goals before final. Track back-to-back/rest and goalie environment; no final grade yet. |
| Toronto at Vegas | 3–3 | In progress | Late West Coast game, only through second period at checkpoint. No final grade yet. |

Eight NHL games confirmed final. Of those eight, 3 ended with at least seven combined goals; 5 ended with six or fewer. This single-night count is NOT a statistical prior and is not a recorded betting hit rate.

## NFL — Tampa Bay at Dallas

**Final 24–16 Buccaneers.** Baker Mayfield was out, rookie Jalon Daniels started, and Dallas had a weak run-defense profile. Postgame observations reported by NFL game thread: Bucky Irving 21 carries/165 yards/one rush TD plus one receiving TD; Dak Prescott 316 pass yards on 42 attempts, two interceptions; George Pickens 130 receiving yards. The underdog won despite pregame Dallas being favoured.

**Retrospective process test, not a historical recommendation:** Dallas scored 20, 37, 31, 34 in its prior four games but conceded 28, 20, 34, 30. Tampa Bay's four losses were by 6, 4, 7 and 3. A Dallas -8.5 line would have covered only 1/4 previous Dallas games; Tampa Bay +8.5 would have covered all four Buccaneers games. Replaying the *pregame-only inputs* through the new filter rejects Dallas -8.5 and allows TB +8.5 as a **research candidate**. That rule was tested *after the result* and is not proof of predictive advantage.

**Lesson:** Recent offensive PPG does not mean a large-favourite ML/spread is safe; explicitly check opponent run opportunity, points conceded, quarterback availability, receiver volume and alternative handicap cushion. Passing attempts (volume) and passing touchdowns/interceptions (events) are different props.

## MLB — Cleveland at Chicago

At check: Guardians 9, White Sox 5, bottom of ninth — **still in progress**. ALDS Game Four starters were Parker Messick (LHP) vs Hagen Smith (LHP). Elimination game, possible short starter leash and volatile bullpen use. Separate recent regular-season strikeouts from playoff start workload, handedness matchup, batter strikeout rate, pitcher outs, walk and ER risk. No prop can be graded before final verified pitching box score.

## Completed SportsLab model code changes

1. Data-quality admission in lib/model-quality.js: historical sample floor, average versus *continuous* line, recent cooling, observed opportunity, opponent defensive positional allowance only when independently verified, confirmed injury flags, H2H shot-floor issues, high-variance scoring events, MLB playoff short-leash risk. Quality score is NOT predicted success probability.
2. NHL shot SGP legs no longer safely increase 2+ to 3+ based solely on payout when direct prior H2H had a low floor.
3. Same-game parlay penalties for too many legs sharing a team/shot environment, unverified correlation and insufficient independent samples; never manufacture sportsbook combined payout.
4. Cross-game ML, spread and game-total candidates must have independent pregame team-form support, not just Playbook odds. A retrospective Tampa/Dallas form test accepted the underdog handicap and excluded the large Dallas favourite handicap.
5. Free NHL/NFL/MLB historical logs exclude the target date itself, preventing same-day future knowledge leaking into past picks.
6. Daily 7 AM Toronto freeze stored in a dated GitHub Release only once. Later manual update cannot overwrite that original pregame board.
7. Postgame review scheduled for around 9 AM Toronto the following morning; scripts/review-board.js grades *only original frozen picks* from official NHL, NFL, MLB box scores. Missing player stats are **ungraded** rather than losses. Distinct same-selection props are deduplicated across Top 10 and SGP appearances.
8. Review UI clearly distinguishes archived true picks and grades from independently observed game scores. Market reweighting should not occur before 25+ uniquely graded picks across multiple dates.

## Open limitations

- October 8 cannot become a retrospective published-pick hit-rate record without a real pregame snapshot.
- StatsHawk monthly allowance is exhausted; no-key league fallbacks are required.
- Specific NHL defensive shot allowance, starting goalies, special-teams usage and player game script are not always verified pregame. Missing checks must remain labeled.
- Deployment of these code changes and successful GitHub Actions runs still require validation.
- The 2 incomplete NHL games and MLB ALDS game need a final-score revisit, not assumed results.

## Sources

- NHL game scores: https://sportslab-psyche8.vercel.app/api/games?sport=NHL&date=2026-10-08
- NHL Boston/Utah shots, PPG: https://www.nhl.com/gamecenter/uta-vs-bos/2026/10/08/2026020056
- NHL Carolina/Vancouver: https://www.nhl.com/news/vancouver-canucks-carolina-hurricanes-game-recap-october-8-2026
- NHL Dallas/Buffalo shot report: https://www.nhl.com/scores/htmlreports/20262027/SS020057.HTM
- NHL Philadelphia/Ottawa: https://www.nhl.com/news/philadelphia-flyers-ottawa-senators-game-recap-october-8-2026
- NHL Minnesota/Tampa: https://www.reuters.com/sports/nhl/john-carlson-scores-first-2-goals-with-lightning-win-over-wild--flm-2026-10-09/
- NHL Montreal/Nashville: https://www.reuters.com/sports/nhl/ryan-oreilly-scores-go-ahead-goal-predators-top-canadiens--flm-2026-10-09/
- NHL Chicago/Islanders: https://www.nhl.com/news/chicago-blackhawks-new-york-islanders-game-recap-october-8-2026
- NHL Sharks/Blues: https://www.reuters.com/sports/nhl/sharks-rally-past-blues-darnell-nurses-ot-goal--flm-2026-10-09/
- NFL actual score: https://www.nfl.com/schedules/2026/by-team/dallas-cowboys
- NFL pregame run defence: https://www.nfl.com/news/buccaneers-vs-cowboys-three-must-know-storylines-for-thursday-s-week-5-prime-time-game
- NFL observed final player lines: https://www.reddit.com/r/NFLScoreboards/comments/1x0pdaz/game_thread_tampa_bay_buccaneers_dallas_cowboys/
- MLB official scores: https://www.mlb.com/scores/2026-10-08

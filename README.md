# FootyEdge Lab

Free-only research application for **NHL, NFL, MLB**. Soccer belongs to the separate original FootyEdge project.

## App

Static mobile-first dashboard in `index.html` with sport tabs, Top 3 SGPs, Top 10 Props, Match Analysis, and Model Review. **No fabricated picks, odds, probabilities, or results.** These sections show explicit pending states until independently verified sources are connected.

## Free-data roadmap

- NHL: NHL public game, roster, play-by-play, and shot-event feeds; compute shot attempts, shots on goal, ice time and player usage where available.
- NFL: public game/roster/box-score data; historical play-by-play through publicly available open datasets where permitted; calculate routes/targets only when available and correctly sourced.
- MLB: MLB Stats API for schedules, box scores, probable pitchers, lineups, play-by-play and splits; weather from free public weather sources.
- Odds: **no assumption that free live prop odds or same-game parlay prices exist**. Display verified prices only with provider, captured timestamp, market and line; otherwise mark unavailable. Do not infer SGP odds by multiplying correlated legs.

## Selection rules

1. All selections are date- and league-scoped; avoid stale injury, lineup, goalie and pitcher assumptions.
2. Research last 5/10, season, prior season, H2H, role and opponent allowances, with sample sizes and recency.
3. Compare safer alternate lines and odds, implied probability and model calibration; account for vig, uncertainty and correlated outcomes.
4. Rank at most three eligible SGPs across games and at most ten props per sport; **publish fewer or zero** when evidence or prices are missing.
5. Store exact published snapshots and settlement evidence for postgame audits. Do not rewrite historical predictions after the event.
6. Evaluate both outcome and quality of process, including game-script changes, injuries, late scratches, lineup changes, penalties, variance and safer alternatives.

## Running

Open `index.html` locally or serve the directory with any static server. No keys or paid services required. This is the working UI scaffold, not a live odds or picks product.

## Deployment

Vercel project `footyedge-lab` must be connected to this GitHub repo for automatic deployments. Existing original FootyEdge production and its repository are not part of this deployment.

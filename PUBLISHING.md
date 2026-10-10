# SportsLab — Refreshing and publishing without Vercel builds

SportsLab separates **reading fresh statistics**, **publishing the daily picks board to everyone**, and **deploying new website code**. Stats updates must not create Vercel deployments.

## On the website (once the new code is deployed)

- **Refresh Stats** fetches current NHL/NFL/MLB/NBA research for the selected sport immediately, bypassing the published snapshot. This updates your current screen; **it does not publish changes to everyone** and requires no Vercel build.
- **Publish Picks ↗** opens the authenticated GitHub Actions workflow at [Publish SportsLab Picks](https://github.com/psyche-s/SportsLab/actions/workflows/publish-board.yml). As the repository owner, choose **Run workflow**, choose **all / nhl / nfl / mlb / nba** and **auto** or **free**, and choose **Run workflow** again. The workflow calculates validated daily boards and updates the existing stable public release for each sport. There is no new website build, and no GitHub source-code commit.
- **⋯ → Deploy website code** opens [Retry SportsLab Website Deployment](https://github.com/psyche-s/SportsLab/actions/workflows/redeploy-site.yml). Run this **only when source code/design changes** and **only when Vercel's daily deployment limit has reset**. It pushes a single empty commit to main to request a fresh production build. It still counts toward Vercel's free-plan limit; it does not bypass a billing restriction.

## Automatic publishing

The GitHub Actions workflow also runs on a schedule at approximately **7 AM and 1 PM America/Toronto**. It checks Toronto local time to account for EST/EDT transitions. GitHub scheduled workflows are best effort and can be delayed.

For each sport, the job builds today's ranked and scoring sections. It may use the site's primary research when available or the official/free NHL/MLB/NFL/NBA data sources. The published JSON includes timestamps, source descriptions, model notes and actual historical samples. If verified source data cannot be fetched, the workflow will **not** replace the old released data with a fabricated result. The site will reject yesterday's release when showing today's board.

Persistent snapshots are stored as GitHub Release **notes**, under the fixed tags:

- `sportslab-board-nhl`
- `sportslab-board-nfl`
- `sportslab-board-mlb`
- `sportslab-board-nba`

Each update edits release notes. The website's `/api/stat-board` fetches that public read-only JSON on ordinary visits and verifies sport/date/timestamp; `source=live` deliberately bypasses the publication when the user presses Refresh Stats. The reading endpoint has shared caching to limit GitHub API traffic.

## Source and bookmaker integrity

The public-data fallback contains historical research, *not* verified sportsbook markets. Missing odds, injuries and lineup confirmations are labeled; no made-up prices or certainty percentages are published. If fewer than three valid SGPs or ten valid props qualify, the board shows fewer. Published data is publicly visible in this public GitHub repository.

## Technical checks and owner troubleshooting

- View results and errors at [GitHub Actions](https://github.com/psyche-s/SportsLab/actions/workflows/publish-board.yml).
- Local dry run: `node scripts/publish-board.js --league=nhl --source=free --preview` (requires network).
- `api/stat-board?league=nhl&date=YYYY-MM-DD&view=ranked&source=published` reads the latest owner-published JSON and returns 404 if it is stale/missing.
- `source=live&refresh=123` gets fresh primary/free research without publishing.
- Vercel Hobby permits **12 serverless functions**; the no-key dispatcher was moved from `api/` to `lib/` to keep the app within that limit.
- Both the published-board reader and website controls require **one initial code deployment**. Subsequent releases do not.
- GitHub Actions requires repository Actions enabled and `contents: write` permission (declared in the workflow). Only authorized collaborators can run the manual workflows.

User goal: **Open SportsLab, see today's finished Top SGPs, Top 10 Props, Best Cross-Game Parlay and Top Scoring Picks, refresh on demand, and optionally publish an updated shared board without new deployments.**

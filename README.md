# Options Dashboard — Vercel deployment

This turns the dashboard from "fetches Bybit only when someone has the tab open" into
"a server keeps a running history in the background," which is what makes OI 24h change
possible for every visitor, not just one browser.

## 1. Get the code into a Git repo

Vercel's standard beginner-friendly path is importing a Git repo (not drag-and-drop like
Netlify). The quickest way:

1. Create a new empty repo on GitHub.
2. Upload this whole folder's contents to it (GitHub's web UI lets you drag files in
   directly — no command line needed).

*(If you're comfortable with a terminal, `npx vercel --prod` from inside this folder
deploys it directly without needing Git at all — skip to step 3 if you do that instead.)*

## 2. Import into Vercel

1. Go to vercel.com → **Add New** → **Project** → pick the repo you just created.
2. Leave all settings default (Vercel auto-detects the `api/` folder as serverless
   functions and `public/` as the static site). Click **Deploy**.

## 3. Add the Redis integration (this is what stores the 24h history)

1. In your new Vercel project, go to **Storage** → **Marketplace Database Providers**.
2. Choose **Upstash** → **Redis** → pick the free tier → connect it to this project.
   This automatically adds `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` as
   environment variables — the code already reads these, nothing else to configure.
   *(Note: Vercel's old built-in "KV" product was discontinued in favor of this Upstash
   Marketplace integration — same thing, new name.)*

## 4. Set a secret token (protects the snapshot endpoint from random requests)

1. Go to **Settings → Environment Variables**.
2. Add `CRON_SECRET` = any long random string you make up (e.g. generate one at
   [randomkeygen.com](https://randomkeygen.com)). Save it somewhere — you'll need it in
   step 5.
3. Redeploy once (Settings → Deployments → ⋯ → Redeploy) so the function picks it up.

## 5. Get the snapshot function actually running on a schedule

This is the one part with a real choice to make:

### Option A — Vercel Pro ($20/month), simplest
Change `vercel.json`'s schedule from `"0 0 * * *"` (once a day) to `"0 * * * *"`
(hourly), push/redeploy. Done — Vercel's own cron handles everything natively.

### Option B — stay free, use an outside scheduler
Vercel's free Hobby plan can only run its *own* cron once a day, but the snapshot
endpoint is just a normal URL — any outside scheduler can call it hourly for free:

1. Go to [cron-job.org](https://cron-job.org) (free), create an account.
2. Create a new cron job:
   - URL: `https://<your-project>.vercel.app/api/snapshot?token=<your CRON_SECRET>`
   - Schedule: every hour
3. Leave `vercel.json`'s daily entry as a harmless backup — it still fires once a day
   on top of the hourly external calls, which is fine.

Either way, give it roughly **24 hours** after the first snapshot before "OI Δ (24h)"
starts showing real numbers — until then the dashboard correctly shows "Building
history…" rather than guessing.

## What changed vs. the old single-file version

- The dashboard no longer calls Bybit from your browser — it calls this site's own
  `/api/dashboard-data`, which calls Bybit server-side and merges in the OI-change
  calculation. No CORS/sandbox concerns, works the same everywhere.
- `/api/snapshot` is the only new moving part — it's what the scheduler above calls,
  and it's what builds the history `/api/dashboard-data` reads from.
- Everything else (charts, Max Pain, IV smile, IV vs RV, multi-asset) is unchanged.

## Retention

Snapshots older than 45 days are automatically pruned (see `RETENTION_DAYS` in
`api/snapshot.js`). That's plenty for 24h/48h OI change; if you later want IV Rank
(today's IV vs its trailing 1-year range), raise this to ~400 and expect the Redis
store to grow accordingly — still well within Upstash's free tier at this data volume.

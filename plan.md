# Cloudflare Deployment Plan — HealthySure BD Central Repository

Deploy from GitHub (Cloudflare Workers Builds), with **one shared live dataset** for the whole BD team.

## 1. Architecture (implemented in this repo)

```
Browser ──► /login (emailed 8-digit code via SendGrid → server-side session)
              │
              ▼
   Worker "healthysure-bd"  (src/worker.js)
     ├─ static assets  ← public/  (index.html, app.js, app.css, companies_data.js baseline)
     ├─ GET  /api/sync?since=<rev>  → edits newer than <rev>         (pull)
     ├─ POST /api/companies         → upsert edited/new records       (push)
     ├─ POST /api/feedback          → founder notes
     └─ POST /api/prospeo           → Prospeo proxy (CORS)
              │
              ▼
        D1 database "healthysure-bd"
          company_overrides (latest record per id + rev cursor)
          company_history   (audit trail: who changed what, when)
          feedback, rev_counter
```

### How shared live data works
- `public/companies_data.js` (27,003 companies) stays the **baseline** shipped with each deploy.
- Every edit, new record, import or merge is pushed to D1 as a full-record override (batched, 600 ms debounce).
- Every open browser pulls overrides newer than its last revision every **20 s** and on tab focus, merges them into its local copy (IndexedDB stays as a fast offline cache) and re-renders. A status pill (bottom-left) shows `Live · shared` / `Syncing…` / `Offline`.
- **Conflict policy: last write wins per company.** A record with unsent local edits is never overwritten by an incoming pull.
- Offline edits stay queued (persisted) and are pushed when the connection returns.
- New records use collision-safe ids (the old `length + i + 1` scheme would have clashed between users).
- Every write records the user's email (from the signed-in session) in `company_history`.
- Refreshing the baseline file later is safe: overrides are applied on top of it.

## 2. One-time setup (you do this in Cloudflare/GitHub)

1. **Push this repo to GitHub** (`main`).
2. **Create the D1 database** (needs `npx wrangler login` once):
   ```
   npx wrangler d1 create healthysure-bd
   ```
   Paste the printed `database_id` into `wrangler.jsonc` (replacing `REPLACE_WITH_D1_DATABASE_ID`), commit and push. (The id is not a secret.)
3. **Connect GitHub to Cloudflare**: Dashboard → Workers & Pages → Create → *Import a repository* → pick the repo.
   - Project/Worker name: `healthysure-bd` (must match `name` in `wrangler.jsonc`)
   - Production branch: `main`
   - Build command: *(leave empty)*
   - **Deploy command:** `npm run deploy` (applies D1 migrations, then `wrangler deploy`)
   - Enable *non-production branch builds* if you want preview deploys for PRs (previews share the same D1 database unless you add a separate preview DB, so treat them as live).
4. **Sign-in (emailed 8-digit one-time code via SendGrid)** — no Cloudflare Access needed:
   - Allowed users: `ALLOWED_EMAIL_DOMAINS` (default `bharatsure.com`) and optional `ALLOWED_EMAILS` in `wrangler.jsonc` `vars`. The list is re-checked on every request, so removing someone locks them out immediately.
   - Sender: `EMAIL_FROM` (`noreply@product.bharatsure.com`) must be a verified Single Sender or authenticated domain in SendGrid.
5. **Set two secrets** (Worker → Settings → Variables and Secrets → Add → type *Secret*; they persist across deploys and never touch Git):
   - `SESSION_SECRET` — random string, 32+ characters (keys the hash of sign-in codes).
   - `SENDGRID_API_KEY` — a SendGrid API key limited to *Mail Send*.
   Until both exist the Worker answers 500 "Auth not configured" / "Email not configured" (fails closed). If Cloudflare Access was set up earlier for this hostname, delete that Access application, otherwise people log in twice.
6. *(Optional)* Custom domain: Worker → Settings → Domains & Routes → Add custom domain (zone must be on Cloudflare).

After this, **every push to `main` deploys automatically**.

## 3. Day-to-day workflow
- Code change → PR → merge to `main` → Cloudflare builds and deploys (migrations run first).
- Schema change → add `migrations/0002_*.sql` (never edit `0001`); it is applied on the next deploy.
- Updating the master company list → regenerate `public/companies_data.js`, commit, push. Team edits stay on top.
- Bump the `?v=` query on `app.js`/`app.css` in `public/index.html` when you want browsers to drop cached copies.

## 4. Local development
```
npm install
npm run db:migrate:local      # creates the local D1 (.wrangler/, gitignored)
npm run dev                   # http://localhost:8787  (Worker + assets + local D1)
```
Local runs need a gitignored `.dev.vars` file: either `ALLOW_INSECURE_DEV=true` (skips login entirely) or `SESSION_SECRET=<32+ chars>` plus `DEV_LOG_OTP=true` (codes are printed in the `wrangler dev` log instead of emailed). Never set these in production. Verified locally: static serving, push, pull since-cursor, overwrite, validation errors, feedback, and a real browser round-trip (pulled server edits + new record, pushed a local edit back).

## 5. What changed in the repo
| Change | Detail |
|---|---|
| `public/` | The web app (`index.html`, `app.js`, `app.css`, `companies_data.js`) — the only files served. |
| `src/worker.js` | API routing + session check; `src/auth.js` = emailed-code login. |
| `migrations/` | D1 schema (`0001` data, `0002` sign-in codes, `0003` sessions + failed-attempt log). |
| `wrangler.jsonc`, `package.json` | Cloudflare config and scripts. |
| `legacy/` | Removed (old Windows server and launchers; still in git history). |
| `public/app.js` | Added sync layer; removed fire-and-forget `/api/save_company`; imports/merges now push; "Reset local database" now rebuilds the local copy from baseline + shared edits (it can no longer wipe team data). |

Not deployed (stay in the repo root): `companies.json`, `companies.csv`, screenshots.

## 6. Known limitations / follow-ups
1. **Existing local-only edits are not migrated.** Edits already made in someone's browser before this release exist only on that device. If they matter, add a one-off "push my local changes" tool (diff IndexedDB vs. baseline) before cutover. Ask me and I'll build it.
2. **Security review fixes applied:** Worker fails closed and gates static files (sign-in: 8-digit codes, HMAC-hashed, 10 min, single use, 5 attempts each; code requests limited to 3 per email+IP, 10 per email and 20 per IP per 15 min; failed verifications limited to 20 per IP per 15 min; same response for allowed and disallowed addresses; sessions are stored server-side as hashed random tokens, so logout and allowlist removal take effect immediately; SameSite=Lax HttpOnly Secure cookie; cross-origin POST refused); `escapeJs` in `app.js` now HTML-escapes, `escapeHtml` always escapes, the `setAsLeadContact` handler uses `escapeJs`, the Worker only accepts an allowlisted record schema (`normalizeRecord`, unit-tested via `npm test`) and the client re-normalises `spocs`/`aiIntelligence` on every pull (stored-XSS via company/contact fields shown in outreach buttons). The old `legacy/server.ps1` (path traversal, `CORS *`) was deleted; it remains in git history only. `extract.ps1`, which regenerated `companies_data.js` from the master spreadsheet, is also in history (`git show 065512d:extract.ps1`). The JWT verification path itself can only be tested against a real Access application, so check it after step 5.
3. **Old in-app login screen is cosmetic.** Its password hash/fallback is in client code; the emailed-code login is the real gate. Remove the in-app overlay later.
4. **Last-write-wins** can drop a simultaneous edit to the *same company* by two people (whole-record overwrite). `company_history` keeps every version, so nothing is lost permanently. Field-level merge is possible if this proves a problem.
5. **Polling, not push:** changes appear within ~20 s. WebSockets via Durable Objects is possible if instant updates are needed.
6. **Tailwind Play CDN / unpkg / SheetJS CDN** are loaded at runtime; fine for an internal tool, but compiling and self-hosting them would be more robust.
7. **API keys** (OpenAI/Prospeo/Apollo/SerpAPI) remain per-user in browser localStorage. Moving OpenAI behind the Worker with a secret is a recommended hardening step.
8. **Personal data:** the dataset has individuals' names/emails/phones; keep sign-in restricted and confirm hosting aligns with your data policy (DPDP).
9. **Residual sign-in risk:** access is granted to every address on an allowed domain, so a determined attacker spreading requests over many IPs can still make roughly 50 guesses per 15 minutes at one address (1 in 2 million per day with 8-digit codes) and can annoy a user with code emails. For a smaller team, list people in `ALLOWED_EMAILS` instead of a whole domain.
10. **Cost:** expected within free tiers (D1 reads per poll are tiny since only rows with `rev > cursor` are read). Revisit past 50 Access users.

## 7. Rollback
- Dashboard → Worker → Deployments → roll back to a previous version, or `npx wrangler rollback`.
- D1: `npx wrangler d1 time-travel restore healthysure-bd --timestamp <iso>`; periodic export: `npx wrangler d1 export healthysure-bd --remote --output backup.sql`.
- `company_history` can rebuild any record's earlier version.

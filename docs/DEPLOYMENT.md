# Deployment

The production setup runs **everything on Vercel as a unified single-project application**:

```
 Browser ──HTTPS──▶ Vercel (one domain)
                      ├─ /api/*  ──▶ Serverless API Function (api/index.ts -> Express)
                      │                ├─ Turso (SQLite) hosted libSQL database (TURSO_DATABASE_URL)
                      │                └─ Vercel Blob    PRIVATE store: documents, photos, report files
                      ├─ /*      ──▶ React Client SPA   Static assets (dist/, served via Edge CDN)
                      └─ Cron    ──▶ GET /api/v1/cron/tick (reminders + scheduled reports)
```

| Path | Destination | What runs |
|---|---|---|
| `/` (and non-API paths) | `dist/` | Vite build output, served as static files with client-side SPA fallback to `index.html` |
| `/api/*` | `api/index.ts` | Express 5 API running as a serverless function |

The browser calls `/api/v1` on the same domain, so `HttpOnly; Secure; SameSite=Strict` auth cookies are first-party and no CORS is involved.

---

## 1. Before you start

- [ ] Push the repository to GitHub.
- [ ] **Vercel plan.**
  - On **Hobby**, a cron job may run at most once a day (`30 1 * * *`).
  - On **Pro**, change the schedule to every 15 minutes (`"*/15 * * * *"`) if desired.
- [ ] **SMTP credentials** if you want real email, for example Amazon SES, Brevo, Mailgun or Postmark. Without SMTP, set `EMAIL_TRANSPORT=disabled`.
- [ ] A strong **owner initial password** of 10 or more characters. You change it at first sign-in.

## 2. Create the project and connect storage

1. In Vercel, choose **Add New → Project** and import the GitHub repository:
   - **Framework Preset: Vite** (automatically detected).
   - **Root Directory:** `./` (repository root, default).
   - **Build Command:** `npm run build`.
   - **Output Directory:** `dist`.
   No custom service configurations or workarounds needed! Vercel automatically deploys the frontend and the `api/` serverless functions.

2. **Database (Persistent SQLite via Turso):**
   1. Open **Storage → Marketplace → Turso** and create a database (or use your existing Turso account).
   2. Connect it to the **Production** environment. This sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, which the server reads.
   3. Note: On Vercel, the local container filesystem is read-only and ephemeral. Turso provides true, persistent, low-latency SQLite across all serverless invocations.
   2. Connect it to the **Production** environment. This sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`, which the server reads.
   3. For Preview, connect a **separate** database or none. See [Preview deployments](#preview-deployments).
3. **Files:**
   1. Open **Storage → Blob**, create a store with **Private** access and connect it to the project.
   2. The server stores files only when it can find the store: `BLOB_STORE_ID` (Vercel connects with OIDC) or `BLOB_READ_WRITE_TOKEN`.
   3. Private blobs have no public URL. Every download still goes through the API's permission checks.
4. **Environment variables** (Project → Settings → Environment Variables, Production):

| Variable | Value |
|---|---|
| `JWT_ACCESS_SECRET` | a random secret: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CRON_SECRET` | another random secret of 16 or more characters. Vercel Cron sends it; without it the jobs never run |
| `OWNER_EMAIL`, `OWNER_NAME`, `OWNER_INITIAL_PASSWORD` | the first owner account, created by the first production build |
| `INSTITUTE_NAME` | shown on receipts and reports (editable later in Settings) |
| `EMAIL_TRANSPORT` | `smtp` or `disabled`; production refuses `log` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | your mail provider, when `EMAIL_TRANSPORT=smtp` |

These need nothing on Vercel; the server picks the right value itself:

- `NODE_ENV`: `production` on Vercel.
- `TRUST_PROXY`: `1`, because Vercel's edge is one hop.
- `APP_URL`: your production domain, from `VERCEL_PROJECT_PRODUCTION_URL`. Set it if you use a custom domain, because it is used in email links and certificate verification links.
- `MAX_UPLOAD_MB`: `4`, the most a Vercel Function accepts.
- `STORAGE_DRIVER`: `blob`, once a store is connected.

5. **Deploy.** For a production deployment the server's build:
   1. bundles the API;
   2. applies pending migrations to the Turso database;
   3. inserts missing reference data and the owner account.

   All of it is safe to repeat on every deploy, and a failed migration fails the build, so broken code never goes live.
6. Open `https://<your-domain>/api/v1/health`. It should report `"status":"ok"`.
7. Open the site and sign in with `OWNER_EMAIL` and `OWNER_INITIAL_PASSWORD`. You are asked to choose a new password.

**The server refuses to start in production if any of these is true** (the log names the variable):

- the JWT secret or owner password is a development default;
- `EMAIL_TRANSPORT=log`;
- the database is in-memory, or on Vercel, a local file;
- on Vercel, no Blob store is connected;
- a `CLIENT_URL` is plain `http://`.

`vercel.json` also sets security headers:

- **Content-Security-Policy:** only one inline script is allowed, by its hash. `client/src/test/csp.test.ts` fails if `client/index.html` changes without updating the hash.
- HSTS, `X-Frame-Options: DENY`, nosniff, a referrer policy and a permissions policy.
- Long-term caching for hashed assets.

### Preview deployments

Preview builds **never** migrate the database. That way a branch can't change the production schema. To use previews with data:

1. Connect a second Turso database to the Preview environment.
2. Set `MIGRATE_ON_BUILD=true` for Preview, so preview builds migrate and seed that database.

Preview builds also need the same secrets as production, set for Preview. Cron jobs run on production only.

## 3. After the first deploy

- [ ] Sign in as the owner and change the password (required).
- [ ] **Settings:** institute name, address, GSTIN, code prefixes, lead sources, expense categories, report recipients.
- [ ] **Staff & permissions:** create staff accounts. Grant `reports:financial`, `payments:refund`, `documents:restricted` and the other permissions deliberately.
- [ ] **Reports → Email:** send yourself a report. History shows `sent`, and the email arrives with the attachment.
- [ ] **Reports → Schedules:** add the daily, weekly or monthly reports the owners want.
- [ ] Check **Vercel → Settings → Cron Jobs** lists `/api/v1/cron/tick`, and run it once from there.
- [ ] Set up backups (below) and do one restore drill.

## 4. Scheduled jobs

A long-running server runs two jobs on timers:

- report schedules, every minute;
- fee reminders, every 15 minutes.

On Vercel nothing runs between requests. Instead, Vercel Cron calls `GET /api/v1/cron/tick` with `Authorization: Bearer <CRON_SECRET>`, and the server runs both jobs once.

| Plan | Schedule in `vercel.json` | Effect |
|---|---|---|
| Hobby | `30 1 * * *` (once a day, 07:00 IST) | reminders daily; a scheduled report goes out at the next daily run after it is due |
| Pro | `*/15 * * * *` | reminders and scheduled reports within 15 minutes |

The endpoint answers `500` when a job failed, so failures show in the cron logs.

## 5. Limits on Vercel

- **4.5 MB per request and per response.**
  - Uploads are capped at 4 MB (`MAX_UPLOAD_MB`).
  - A very large export can exceed the response limit. Narrow its filters, or use the emailed report instead.
- **Vercel's per-request time limit** (the project's default function duration). Report generation for a year of data fits easily, but keep it in mind for bulk imports.
- **No files on the function's disk are needed.** The bundle carries the PDF fonts and the migration list (`scripts/build.mjs`).
- **Rate limits are kept per function instance.** Under load Vercel runs several instances, so the sign-in limit is per instance. For a hard limit, add a rate-limit rule in the Vercel Firewall for `/api/v1/auth/login`.
- **Settings** (time zone, prefixes) are cached per instance for up to a minute. After an owner edits Settings, other instances pick the change up within a minute.

## 6. Backups

- **Database:**
  - Turso keeps point-in-time restore history; how far back depends on your Turso plan. Restore from the Turso dashboard or CLI.
  - Also keep your own off-site copy, for example weekly: `turso db shell <database> .dump > institute-YYYYMMDD.sql`.
- **Files:** private blobs are not included in a database backup. Copy the store on a schedule with the Vercel Blob SDK or CLI if documents must survive deleting the store.

**Restore drill** (do it once before relying on a backup):

1. Restore into a **new** Turso database.
2. Point a Preview deployment at it.
3. Check `/api/v1/health` and a known receipt.

`npm run db:backup` still makes verified copies of a **local** database file; it refuses a Turso URL and says so.

## 7. Moving existing local data to Turso

1. Stop the local server, so the file is complete.
2. Create the Turso database from the file, for example `turso db create institute --from-file server/data/institute.db`. See Turso's docs for the current import command.
3. Uploaded files under `server/storage/` are not moved by this. Upload them to the Blob store under the same keys (for example `documents/2026/10/<id>.pdf`) before going live. The database records point at those keys.

## 8. Alternatives

- **A long-running server** (Render, a VPS, Docker):
  - Run `npm ci && npm run build`, then `npm run start:prod --workspace=server`. The database can stay a local file on a persistent disk, files stay in `STORAGE_DIR`, and the jobs run on timers (`JOBS_ENABLED=true`).
  - `render.yaml` describes this setup on Render. To keep the web app on Vercel, remove the `server` service from `vercel.json` and rewrite `/api/(.*)` to your API's URL.
  - Set `TRUST_PROXY` to the number of proxies in front of the API.
- **Postgres:** rewrite `server/src/db/dialect.ts` and the driver, then regenerate migrations. The services and tables stay the same.

## 9. Troubleshooting production

| Symptom | Cause and fix |
|---|---|
| The log shows `Installing dependencies...` and `npm run build` for `@ims/server` only, and no client build | The project is not a Services project, so `vercel.json`'s services were ignored. Set Framework Preset to **Services** and clear Root Directory (§2). |
| Build fails with `Invalid server environment configuration` | The message names the variable. On Vercel this is usually a missing Turso or Blob connection, a missing secret, or `EMAIL_TRANSPORT=log`. |
| Build fails while migrating | The build log shows the SQL error. Nothing went live; fix the problem and redeploy. |
| Health shows `database: down` | `TURSO_DATABASE_URL` or `TURSO_AUTH_TOKEN` is missing or wrong for this environment. |
| Health shows `migrations: degraded` | This deployment's build did not migrate: a Preview without `MIGRATE_ON_BUILD=true`. |
| Uploads fail with `413` | The file is over 4 MB. This is a Vercel Function limit. |
| Reminders or scheduled reports never happen | Check that `CRON_SECRET` is set and that **Settings → Cron Jobs** shows the job. A `401` in its log means the secret differs. |
| Everyone gets "Too many requests" together | `TRUST_PROXY` is too low, so all users share the proxy's IP. Leave it unset on Vercel (it defaults to 1). |
| Report emails show `failed` | Open Reports → History: the provider's error is shown, for example authentication or a sender domain that isn't verified. Fix `SMTP_*`, then use **Retry**. |

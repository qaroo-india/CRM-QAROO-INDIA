# Institute OS

A course-institute management, business intelligence and placement platform. It covers
the full student lifecycle:

- enquiries with source tracking;
- admissions;
- fees, instalments, receipts, refunds and loans;
- batches and trainers, the class schedule, attendance, online exams, study material and certificates;
- technical and non-technical placement, with hiring drives;
- a student portal and a faculty workspace, each with its own navigation;
- staff leave, tasks and an inventory of assets;
- expenses;
- dashboards and reports with PDF/Excel export and scheduled email;
- notifications, documents, bulk import, staff permissions and a full audit trail.

**Stack:** React 19 · Vite 8 · Tailwind CSS 4 · TanStack Query · Recharts · Express 5 ·
SQLite (better-sqlite3) · Drizzle ORM · Zod 4 · TypeScript 7 · Vitest 5 · PDFKit · ExcelJS

> **Status:** all milestones, including the campus and portal additions, are built and
> verified locally (typecheck, tests, production build, live smoke test). It is **not
> deployed**: deployment needs your Vercel and Render accounts. See
> [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Quick start

**Prerequisites:**

- Node.js 22 or newer (24 LTS recommended; see `.nvmrc`), npm 10+, and Git.
- No database server, compiler or cloud account. SQLite runs in-process from prebuilt binaries for Windows, macOS and Linux.

```bash
# 1. Install all three workspaces
npm install

# 2. Create local environment files (development defaults, no secrets)
cp server/.env.example server/.env
cp client/.env.example client/.env

# 3. Create the database and load reference data (lead sources, categories, owner account)
npm run db:migrate
npm run db:seed

# 4. Optional: fill the EMPTY database with clearly labelled demo data
npm run db:demo

# 5. Start the API (port 5000) and the web app (port 5173) together
npm run dev
```

Open **http://localhost:5173** and sign in:

- **Email:** `OWNER_EMAIL` from `server/.env` (default `owner@institute.local`).
- **Password:** `OWNER_INITIAL_PASSWORD` (default `ChangeMe-Owner-2026`, development only).

You must choose a new password at first sign-in.

On Windows PowerShell, use `Copy-Item` instead of `cp`.

### Demo data

`npm run db:demo` loads about 7 months of realistic activity. It runs through the same business rules as the app:

- 170 enquiries, 73 admissions, fee plans and payments, a refund, a bounced cheque and scholarships;
- batches, loans, placements with interviews and offers;
- monthly expenses and a paused report schedule;
- a month of classes and attendance registers, unit tests with graded attempts, study
  material links, certificates at every stage, open placement drives, staff leave, tasks and
  an inventory with requests.

All of it is clearly marked:

- emails end in `@demo.invalid`;
- phones are `90000xxxxx`;
- notes say `[DEMO DATA]`.

It refuses to run in production, or if any admission already exists, so it never mixes
with real records. It prints a temporary password for three demo staff accounts, and one
for a demo **student portal** login and a demo **faculty** login. Everyone must choose their
own password at first sign-in.

A demo database loaded before the campus areas existed can be topped up with
`npm run db:demo:campus`. It refuses unless the database holds the
`[DEMO DATA]` batches and the campus areas are still empty.

---

## What's inside

| Area | Highlights |
|---|---|
| **Leads** | Source/UTM/campaign tracking, Kanban pipeline, follow-up calendar, activity timeline, duplicate warnings, bulk assign, CSV/Excel import, Excel/CSV export |
| **Admissions** | Lead conversion with source attribution kept, fee plans (full, monthly, flexible, financing), idempotent creation |
| **Money** | Integer-paise ledger, receipts and refund vouchers (PDF), reversals, approved discounts/waivers, overdue and as-of balances, loans where approval is never cash |
| **Batches** | Trainers, capacity, assignment queue, transfers with history |
| **Teaching** | Class schedule with weekly repeats and clash checks, attendance registers with percentages, online multiple-choice exams graded on the server, study material (files or links, every open logged), completion certificates with a public verification page |
| **Accounts and portals** | The side navigation follows the login: office team, faculty (their own batches only) or student. Students see their classes, attendance, exams, material, fees and receipts, certificates and placement drives. Faculty and student logins are given from the trainer and student records; students can also activate their own by email. Forgot password by email. Staff profiles with photos. |
| **Workplace** | Leave requests and approval, tasks with daily reminders, inventory of assets and supplies with requests, issue and return |
| **Placement** | Technical and non-technical tracks, readiness, applications, interviews, offers, hiring drives students apply to from the portal. Only joining counts as placed. |
| **Dashboard and reports** | KPIs with comparisons and drill-down, 10+ charts, each with a table view. Daily, weekly, monthly, yearly and custom reports filtered by course, source and counsellor. |
| **Exports and email** | PDF and Excel (live totals, formula-injection safe), email with retry, daily/weekly/monthly schedules, history |
| **Operations** | Notifications and reminders, document center with restricted access, staff permissions, audit history, settings |

---

## Scripts

Run from the repository root.

| Command | What it does |
|---|---|
| `npm run dev` | API (`tsx watch`) and web app (Vite) together |
| `npm test` | Every test suite: shared, server, client |
| `npm run typecheck` | Strict TypeScript check of all workspaces |
| `npm run build` | Production builds: `server/dist` (esbuild) and `client/dist` (Vite) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Insert missing reference data and the owner account. Safe to repeat. |
| `npm run db:demo` | Demo data into an **empty** development database |
| `npm run db:demo:campus` | Add the campus and portal demo to an existing demo database |
| `npm run db:backup` | Verified online snapshot to `server/data/backups/` (keeps 30) |
| `npm run db:generate` | Create a SQL migration from schema changes |
| `npm run db:studio` | Browse the database in a local web UI |
| `npm run setup` | `install` + `db:migrate` + `db:seed` |

Production (server workspace): `npm run start:prod --workspace=server` runs
`migrate → seed → server` from `dist/`. Backups in production use
`npm run db:backup:prod --workspace=server`.

---

## Project structure

```
├── shared/          @ims/shared: money, dates (institute time zone), ids, permissions,
│                    status vocabularies, Zod schemas and response DTOs, used by both sides
├── server/          @ims/server: Express 5 API
│   ├── drizzle/     SQL migrations (34 tables)
│   ├── src/
│   │   ├── config/  validated env, logger
│   │   ├── db/      schema, dialect boundary, migrate / seed / demo / backup CLIs
│   │   ├── middleware/  auth, CSRF, security headers, error envelope
│   │   ├── modules/ auth · users · settings · audit · courses · leads · students ·
│   │   │            admissions · finance · expenses · batches · placements · reports ·
│   │   │            notifications · documents · import · search · health
│   │   ├── services/ ledger (balances), mailer, storage, sequences, audit, clock
│   │   ├── pdf/     receipt and report building blocks (Inter font for ₹)
│   │   └── jobs.ts  scheduled reports and reminder sweep (JOBS_ENABLED)
│   └── tests/       integration tests through HTTP on in-memory SQLite
├── client/          @ims/client: React SPA (features/<domain>, components/ui, charts)
├── docs/            architecture, API, design system, deployment, security
├── vercel.json      web app hosting, /api rewrite, security headers
└── render.yaml      API hosting blueprint (persistent disk, env vars)
```

---

## Testing

```bash
npm test                         # all workspaces
npm test --workspace=server      # API, money, reports, exports, permissions, portals
npm test --workspace=client      # UI states, formatting, CSP hash
```

Server tests use an **in-memory SQLite database** per test file. They never touch
`server/data/`, need no `.env`, and simulate email with an injected transport, so
nothing is sent.

---

## Configuration

Every server variable is validated at startup. A bad value stops the server with a
message naming the variable.

- `server/.env` and `client/.env` are git-ignored. **Never commit them.**
- Anything prefixed `VITE_` is compiled into public JavaScript. Never put secrets there.
- **Email:** `EMAIL_TRANSPORT=log` (the development default) writes to the log and **sends nothing**. The app labels such deliveries "not delivered (dev mode)". Use `smtp` with `SMTP_*` for real email.
- `.npmrc` disables dependency install scripts on purpose; see the comment in that file.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Status page says **API unreachable** | The API isn't running, or stopped on a config error. Check the `npm run dev` terminal: env errors name the exact variable. |
| `Port 5000 is already in use` | Stop the other process, or set `PORT` in `server/.env` **and** `VITE_API_PROXY_TARGET` in `client/.env` to the same new port. |
| Status page says **Setup incomplete** | Run the command shown on the card: `npm run db:migrate` or `npm run db:seed`. |
| `gyp ERR! find VS` during install | Something bypassed `.npmrc` (for example a global `ignore-scripts=false`). better-sqlite3 needs no compiling: run `npm install --ignore-scripts`. |
| `Could not locate the bindings file` | Node's platform or architecture changed after installing. Run `npm ci` again. |
| `SQLITE_BUSY` / database locked | Another process (e.g. `db:studio`) holds a write lock. Close it; the API waits up to 5 s. |
| `ECONNREFUSED ::1:5000` in the Vite terminal | Keep `VITE_API_PROXY_TARGET` as `127.0.0.1`, not `localhost`. |
| Locked out after wrong passwords | The account unlocks after 15 minutes. An owner can reset a staff password from Staff & permissions. |
| `db:demo` refuses to run | It loads only into a database with no admissions. Point `DATABASE_URL` at a fresh file, e.g. `DATABASE_URL=./data/demo.db`. |
| Report emails "not delivered (dev mode)" | Expected with `EMAIL_TRANSPORT=log`. Configure SMTP to send. |

Production problems are covered in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#7-troubleshooting-production).

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md): decisions, data model (34 tables), financial definitions, known limitations
- [API reference](docs/API.md): conventions, error codes, every endpoint with its permission
- [Deployment](docs/DEPLOYMENT.md): Vercel + Render step by step, backups, restore drill
- [Security review](docs/SECURITY.md): controls, how each is verified, residual risks
- [Design system](docs/DESIGN-SYSTEM.md): tokens, verified contrast, charts, components

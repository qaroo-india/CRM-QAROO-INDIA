# Architecture

Institute OS is a modular monolith: one Express API and one React SPA, sharing a
TypeScript package of contracts. It manages the student lifecycle from enquiry to
placement, and computes the institute's financial and operational reports.

> **Status:** all nine milestones are built and tested. §9 has the verification summary;
> [SECURITY.md](SECURITY.md) has the security review; [DEPLOYMENT.md](DEPLOYMENT.md) has
> the production setup.

---

## 1. Decision record

| # | Decision | Chosen | Why | Trade-off accepted |
|---|---|---|---|---|
| D1 | Language | **TypeScript** everywhere | One Zod schema types the form, the request validator and the response. Field renames break the build, not a report. | Slightly more setup. |
| D2 | Database | **SQLite (better-sqlite3) + Drizzle ORM** | The synchronous driver makes multi-row financial writes truly atomic, with no async gap between reading a balance and writing a payment. SQL `GROUP BY`/CTEs suit the reporting engine. Zero install for development. | One writer at a time (ample for one institute). Hosting needs a persistent disk or Turso. See §8. |
| D3 | Money | **Integer minor units** (paise) | `SUM()` over integers is exact. No float drift, no decimal library. | Format at the edges only (`formatMoney`). |
| D4 | Auth | **HttpOnly cookies**: 15-min access JWT + rotating refresh token, CSRF double-submit | Script injection cannot read tokens. Refresh rotation with reuse detection revokes stolen tokens. | Needs same-site deployment (§8) and CSRF handling. |
| D5 | Monorepo | **npm workspaces**: `client`, `server`, `shared` | Contracts and money logic are written once. | `shared` ships as TS source; server bundles it with esbuild. |
| D6 | Dialect containment | Table files import only from `server/src/db/dialect.ts` | Turso is a driver-only swap. Postgres rewrites that one module plus the driver and regenerates migrations. Table and service code stay untouched. | Raw SQL date functions must also live in the dialect module. |
| D7 | Primary keys | **UUIDv7** (app-generated) | Time-ordered keys give B-tree locality and map to Postgres `uuid`. The id is known before insert. | 36-char text keys in SQLite. |
| D8 | Business dates | `TEXT 'YYYY-MM-DD'` in the institute zone | A receipt dated 31 March stays in March regardless of server zone. String order equals date order, so range queries stay indexed. | Instants (audit times) use a separate epoch-ms type. |

### Correction on Postgres portability

Drizzle does **not** share one schema across dialects (`sqliteTable` and `pgTable`
are different builders). D6 contains the difference instead:

- **Turso / libSQL:** driver swap in `db/index.ts` only.
- **Postgres:** rewrite `db/dialect.ts` (~80 lines) and `db/index.ts`, then
  regenerate migrations. Table definitions and services are unchanged.

---

## 2. System overview

```
 Browser (React SPA)                         Express API                      SQLite
┌────────────────────────┐   /api/v1/*   ┌──────────────────────────────┐   ┌───────────┐
│ Pages → feature hooks   │ ────────────▶ │ requestLogger (id, pino)     │   │ WAL mode  │
│ TanStack Query cache    │  same-origin  │ helmet · CORS · rate limit   │   │ FKs ON    │
│ api.ts (fetch wrapper)  │  cookies      │ json/cookie parsing (1 MB)   │──▶│ CHECKs    │
│ Zod-validated responses │ ◀──────────── │ module routers               │   │ busy 5 s  │
└────────────────────────┘  {success,     │ errorHandler → envelope      │   └───────────┘
            ▲                data|error}  └──────────────────────────────┘
            │                                   ▲
            └────── @ims/shared ────────────────┘
               money · ids · constants · Zod contracts
```

**Request lifecycle:**

1. A request id is assigned (or a safe incoming `X-Request-Id` reused) and echoed back.
2. Security headers and CORS are applied.
3. Bodies are parsed, capped at 1 MB.
4. The rate limiter runs.
5. The CSRF check runs on state-changing requests, then `authenticate` re-reads the user (active? token version? password change pending?).
6. The module router runs: authorise (`requirePermission`), validate with the shared Zod schema, call the service, return the envelope.
7. Any thrown error becomes a typed envelope. Unexpected errors are logged with their stack and the client receives a generic 500 plus the request id.

**Layering inside a server module:**

```
modules/finance/
  finance.routes.ts       HTTP: authorise + parse + respond. No business logic.
  payments.service.ts     Business rules. Synchronous db.transaction() for writes.
  hooks.ts                Post-commit extension points (notifications).
services/ledger.ts        Every balance expression (paid, refunded, outstanding as of D, overdue).
tests/payments.test.ts    Integration tests through HTTP against in-memory SQLite.
```

**Modules:**

- `auth`, `users`, `settings`, `audit`, `health`, `search`
- `courses`, `leads`, `students`, `admissions`
- `finance` (fee plans, payments, adjustments, instalments, loans), `expenses`
- `batches` (trainers, batches, assignments, queue), `placements`
- `reports` (dataset, PDF/Excel renderers, jobs, email, schedules)
- `notifications`, `documents`, `import`

Cross-module reactions go through hook registries instead of imports. For example, completing an admission opens a placement profile and closes its batch seat, and new admissions notify the owners.

---

## 3. Data model

34 tables in six domains. All 17 collections in the brief are present (✓), plus the
supporting tables a normalised relational ledger needs. The migrations are in
`server/drizzle/` (`0000_foundation`, `0001_full_domain`).

Conventions apply to every table:

- `id` is a UUIDv7.
- `created_at`/`updated_at` are epoch-ms.
- Money columns end in `_minor`. Business dates are `YYYY-MM-DD`.
- Foreign keys are enforced.
- Financial rows are never hard-deleted.

### 3.1 Identity and configuration

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `users` ✓ ✅ | Every login: office team, faculty and students | `email` unique, CHECK lowercase · `role` CHECK ∈ roles · `account_type` (team / faculty / student; see §6) · `permissions` JSON · `token_version` (revoke all sessions) · `failed_login_count`, `locked_until` · staff profile (`staff_code` unique, designation, department, employment type, joined on, specialisation, bio, photo key) |
| `password_tokens` | Forgot-password and portal activation links | SHA-256 `token_hash` only · `purpose` (reset 30 min, activate 24 h) · `used_at`. At most 3 links per user per hour. |
| `refresh_tokens` | Rotating refresh tokens (M2) | `token_hash` unique · `family_id` (reuse detection revokes the family) · `expires_at`, `revoked_at`, `replaced_by_id` |
| `institute_settings` ✓ ✅ | Singleton config | CHECK `id = 'default'` · timezone, currency, locale · fiscal-year month · code prefixes |
| `sequences` | Gap-free business codes | PK (`name`, `year`) · `value`. Incremented inside the same transaction as the insert, so receipt numbers never collide or skip. |
| `saved_filters` | Per-user saved report filters | `user_id` → users · `scope`, `params` JSON |

### 3.2 CRM

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `lead_sources` | Configurable marketing sources | `name` unique · `is_active` · `sort_order` |
| `leads` ✓ | Enquiries | `lead_code` unique · `phone_normalized` (indexed, for duplicate warnings) · `lead_source_id` **NOT NULL** → lead_sources · `interested_course_id` → courses · `counsellor_id` → users · `status` CHECK · UTM fields · `converted_at`, `student_id` |
| `lead_activities` | Timeline: calls, notes, status moves | `lead_id` → leads · `type` · `from_status`/`to_status` · `actor_id` |

### 3.3 Academics

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `courses` ✓ | Course catalogue | `code` unique · `standard_fee_minor` ≥ 0 · `placement_track` · `is_active` |
| `students` ✓ | One identity per person | `student_code` unique · `phone_normalized` indexed (duplicate warning) · gender, qualification, year of passing, state, PIN, guardian · `status` (active / inactive / graduated / suspended) · `user_id` unique → their portal login |
| `admissions` ✓ | One enrolment; a student can hold many | `admission_number` unique · `student_id`, `course_id` · `lead_id` + **`attributed_source_id` snapshot** (source attribution survives later lead edits) · `list_fee_minor`, `discount_minor`, `agreed_fee_minor` with CHECK `agreed = list − discount` · `status` · `cancelled_on`, `completed_on` (for as-of reporting) |
| `trainers` | Trainer directory | `name` · `is_active` (deactivated, never deleted) · `user_id` unique → their faculty login |
| `batches` ✓ | Course delivery groups | `batch_code` unique · `course_id`, `trainer_id` · `capacity` > 0 · `status` |
| `batch_assignments` ✓ | Admission ↔ batch history | partial UNIQUE (`admission_id`) WHERE `status = 'active'`: **at most one active batch per admission**. Transfers close the row and open a new one. |
| `class_sessions` | The timetable | `batch_id`, `trainer_id` · `starts_at`, `ends_at` · `kind`, `status` (scheduled / completed / cancelled) · location, meeting link. Clashes for a trainer or batch are refused. |
| `attendance_sessions`, `attendance_records` | One register per batch per day | UNIQUE (`batch_id`, `date`) · one record per admission: present / late / on duty / absent / holiday. The roster comes from the assignment history, so a transferred student appears in the right batch on each day. |
| `exams`, `exam_questions`, `exam_options` | Online multiple-choice exams | partial UNIQUE: exactly one correct option per question · questions change only in draft · `total_marks` frozen at publish |
| `exam_attempts`, `exam_answers` | A student's attempt | `deadline_at` = start + duration (capped by the exam window) · `question_order` · score and `percent_bps` (basis points) graded on the server; expired attempts are graded automatically |
| `materials`, `material_access` | Study material per course or batch | a stored file or an http(s) link · `is_published` · soft delete · every open logged |
| `certificates` | Completion certificates | partial UNIQUE: one live certificate per admission · requested → under review → approved → issued / rejected · `reference_number` from the gap-free `CERT` sequence, publicly verifiable |

### 3.4 Finance

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `fee_plans` ✓ | Payment arrangement per admission | `admission_id` · `plan_type` · `status` (active / superseded). Restructuring supersedes the old plan, keeping its history. |
| `instalments` | Schedule rows | `fee_plan_id`, `admission_id` · `sequence` · `due_date` · `amount_minor` > 0. **Paid amount is derived** from allocations, never stored. |
| `fee_adjustments` | Post-admission discounts, waivers, write-offs | `admission_id` · `type` · `amount_minor` · `effective_date` · `approved_by_id`. Makes "outstanding as of date D" computable. |
| `payments` ✓ | Append-only receipts ledger | `receipt_number` unique · `idempotency_key` unique · `amount_minor` > 0 · `direction` (in / refund) · `status` · `reversal_of_id` → payments · `recorded_by_id` |
| `payment_allocations` | Splits a receipt across instalments | `payment_id`, `instalment_id` (nullable for unscheduled) · `amount_minor`. The service asserts Σ allocations = payment amount inside the transaction. |
| `loans` ✓ | Internal facility or external loan | `admission_id` · `finance_type` CHECK · `requested_minor`, `approved_minor` · `status` |
| `loan_disbursements` | Money the lender actually released | `loan_id` · `amount_minor` · `payment_id` → payments. **Cash counts as received only via that linked, succeeded payment.** |
| `expense_categories` | Configurable categories | `name` unique · `is_active` |
| `expenses` ✓ | Outgoings | `expense_code` unique · `amount_minor` > 0 · `approval_status` · `voided_at` + `void_reason` (never deleted) |

### 3.5 Placement

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `job_categories` | Configurable, per track | `track` CHECK · `name` |
| `companies` | Hiring companies | `name` unique (case-insensitive) |
| `placement_profiles` ✓ | Placement readiness per student/admission | `student_id`, `admission_id` · `track` · `stage` CHECK · `eligible_on` (defines the cohort) · `coordinator_id` |
| `placement_applications` ✓ | One application to one job | `profile_id`, `company_id`, `job_category_id` · `applied_on` · `outcome` · `offer_package_minor` · `joined_on` |
| `interviews` | Rounds per application | `application_id` · `round` · `scheduled_at` · `result` |
| `placement_drives`, `placement_drive_batches` | A company's hiring drive, open to chosen batches | `status` (planned / open / closed) · `apply_by` · package · openings. An application to a drive is a normal `placement_applications` row with `drive_id`, UNIQUE per (drive, profile). |

### 3.6 Operations

| Table | Purpose | Key columns / constraints |
|---|---|---|
| `documents` | File metadata. The bytes are in private disk storage (`STORAGE_DIR`), served only through an authorised route. | polymorphic `owner_type`/`owner_id` · `access_level` (loan and identity documents are always restricted) · `deleted_at` (soft delete with a reason) |
| `notifications` ✓ | In-app alerts | `user_id` · `type` · `dedupe_key` **unique**, so the same reminder is never created twice · `read_at` |
| `report_jobs` ✓ | Every export, email and scheduled run | `report_type`, `format`, `params` JSON (including whether money was included) · `status` · `error`. The file is kept at `STORAGE_DIR/reports/<id>`. |
| `report_deliveries` | Email sends and retries | `report_job_id` · `recipients` · `attempts` · `last_error` |
| `report_schedules` | Daily/weekly/monthly automation | `cadence` · `next_run_at` · `is_active` |
| `audit_logs` ✓ | Who changed what | `actor_id` · `action` · `entity_type`/`entity_id` · `before`/`after` JSON · `request_id` |
| `leave_requests` | Staff time off | type, dates, `status` · overlapping requests refused · decided by someone with `leave:approve`, never the requester |
| `tasks` | Staff work list | `assigned_to_id`, `created_by_id` · priority, `status`, `due_date` · optional attachment. A daily reminder for open tasks due or overdue. |
| `inventory_items`, `inventory_requests` | Assets and supplies, and who has what | UNIQUE upper(`asset_tag`) · `quantity_total`, `quantity_available` (a guarded update keeps it ≥ 0) · consumables are handed out, lendable items issued and returned |

### 3.7 Relationship map

```
lead_sources ─1:N─ leads ─0..1:1─ admissions ─N:1─ students
                                       │
        courses ─1:N───────────────────┤
           │                           ├─1:N─ fee_plans ─1:N─ instalments ─┐
           └─1:N─ batches              ├─1:N─ fee_adjustments                │
                    │                  ├─1:N─ payments ─1:N─ payment_allocations
                    └─1:N─ batch_assignments ─N:1─┤        ▲
                                       ├─1:N─ loans ─1:N─ loan_disbursements ─┘ (via payment_id)
                                       └─1:N─ placement_profiles ─1:N─ placement_applications ─1:N─ interviews
                                                                          │
                                                       companies ─1:N─────┘
users: counsellor_id, trainer_id, coordinator_id, recorded_by_id, actor_id (all N:1 → users)
```

---

## 4. Financial and analytical definitions

These definitions are the contract for every dashboard number, report, PDF, Excel
file and email. All of them come from one function, `buildReport()` in
`server/src/modules/reports/reports.service.ts`. `server/tests/reports.test.ts` checks
them against a hand-computed fixture.

All periods are **inclusive** calendar-day ranges `[from, to]` in the institute time
zone. Admissions count by `admission_date`; collections by `payment_date`.

| Metric | Definition |
|---|---|
| **Admissions** | Admissions dated in the period whose status is not `cancelled`. |
| **Agreed fees** | Σ `agreed_fee_minor` of those admissions. |
| **Scheduled** | Σ instalment `amount_minor` due in the period, excluding cancelled or waived instalments. |
| **Gross collections** | Σ `payments.amount_minor` where `status = 'succeeded'`, `direction = 'in'`, dated in the period. |
| **Refunds** | Σ succeeded `direction = 'refund'` payments dated in the period. Reported separately. |
| **Net collections** | Gross collections − refunds. |
| **Reversals** | A reversed receipt (data-entry error) drops out of gross entirely. It is a correction, not a refund, and is listed separately for audit. |
| **Outstanding as of D** | For each admission dated ≤ D and not cancelled on or before D: `agreed_fee − Σ adjustments effective ≤ D − Σ net allocations from payments dated ≤ D`, floored at 0. |
| **Overdue as of D** | Σ over instalments due before D of `max(0, amount − allocations dated ≤ D)`, for admissions not cancelled on or before D. Capped per admission at that admission's outstanding (a later discount cannot make overdue exceed what is owed). |
| **Ageing** | Each admission's outstanding is attributed to its **oldest** unpaid instalments first, by days past due (1–30, 31–60, 61–90, 90+). The remainder is *not yet due*. The buckets always sum to outstanding. |
| **Loan pipeline** | *Requested*, *approved* and *disbursed (as reported)* are tracked separately. **Received** counts only disbursements linked to a succeeded payment. Approval is never cash. |
| **Net cash movement** | Net collections − (recorded or approved, non-voided expenses). Labelled cash movement, **never profit**: accounting accruals are out of scope. Expenses are institute-wide, so expenses and cash flow are **withheld** (null) while a course, source or counsellor filter is on. |
| **Lead conversion (cohort)** | Of leads with an **enquiry date** in the period, the share converted **by the period end**. A past month's rate therefore never drifts as old leads convert later. Source and counsellor performance use this cohort, never "admissions this month ÷ leads this month". |
| **Admissions by source** | Uses `admissions.attributed_source_id`, snapshotted at conversion. Admissions without a traceable lead are reported as *Unattributed*, never guessed. |
| **Placement rate** | Unique students in the eligible cohort (`eligible_on` in period) who reached `joined`, divided by the cohort minus students who are `withdrawn` or `not_seeking`. Several offers to one student count once. An application or interview is never a placement. |
| **Batch queue** | Open (pending-payment or active) admissions with no `active` batch assignment. |
| **Periods** | *Dashboard* periods are rolling (this month = 1st to today) and compare with the same span of the previous period. *Report* types are complete periods around a reference day (the monthly report is the whole month). *Scheduled* reports always send the previous complete day, week or month. "Today" is always computed in the institute time zone. |

---

## 5. API and client routes

Every endpoint, with its permission, is listed in [API.md](API.md).

**Client routes.** The side navigation is built from the signed-in account: its type
(team, faculty or student), then its permissions. Office staff also have a job role:
a **counsellor** sees enquiries, students, admissions and courses first and lands on
Enquiries; **office staff** see fees, instalments, loans and expenses first and land on Fees &
payments; the **owner** (admin) sees everything and lands on the dashboard. The job role
only orders the menu and picks starting permissions; the server enforces the same rules
independently.

```
Team (office)
/                          Executive dashboard          /expenses
/leads                     Enquiries (list, Kanban, follow-up calendar)
/students  /students/:id   Profile with 9 tabs          /placements/technical
/admissions  /admissions/new                            /placements/non-technical  /drives
/payments  /instalments  /loans                         /reports (report, history, schedules)
/batches  /batches/:id     Batches, queue, trainers     /notifications  /documents
/schedule  /attendance  /exams  /exams/:id  /materials  /certificates
/tasks  /leave  /inventory
/courses   /staff  /audit  /settings  /account

Faculty
/                          My teaching (this week's classes, registers to take, tasks, batches)
/batches  /schedule  /attendance  /exams  /materials  /tasks  /leave  /inventory  /account

Student portal
/portal                    Overview                     /portal/fees (receipts)
/portal/classes  /portal/attendance  /portal/exams  /portal/attempts/:id
/portal/materials  /portal/certificates  /portal/placements  /notifications  /account

Public
/login  /forgot-password  /activate  /reset-password  /verify/:reference  /status
```

---

## 6. Security model

Summary only; [SECURITY.md](SECURITY.md) has the full review, with the test that verifies each control.

- **Sign-in and sessions:**
  - Argon2id hashes, login rate limit and account lockout.
  - A forced password change at first sign-in.
  - HttpOnly `SameSite=Strict` cookies: a 15-min access JWT and a rotating refresh token with reuse detection.
  - CSRF double-submit.
  - Every request re-reads the user, so deactivation takes effect at once.
- **Authorisation:**
  - Three account types. Student logins hold no permissions and are stopped by a
    back-office wall in front of every staff router; the portal takes the student from
    the session, never from the request. Faculty logins are scoped to their own batches.
    A student record set to inactive or suspended locks the portal at once.
  - A server-side permission on every route.
  - Exam answers never leave the server; grading happens there.
  - Money redacted from reports without `reports:financial`.
  - Documents scoped to the owning record plus `documents:restricted`.
- **Integrity:**
  - Integer paise and an append-only ledger.
  - Atomic synchronous transactions, CHECK constraints and idempotency keys.
  - An audit trail on every change.
- **Input and output:**
  - Zod validation everywhere and parameterised SQL.
  - An upload allow-list with content sniffing.
  - Formula-injection-safe spreadsheets and CSP on both the API and the app.
  - Body, page, export and import size caps.

---

## 7. Front-end architecture

- **Feature folders** (`src/features/<domain>`) own their pages, hooks and tests. `components/ui` holds the design-system primitives.
- **Server state** lives in TanStack Query only. Context is reserved for app-wide UI state: the theme and the auth session.
- **URL state:** list filters, report filters and tabs live in the query string, so views can be bookmarked and shared, and exports send exactly what is on screen.
- **Charts** (`components/charts/ChartKit.tsx`, Recharts) follow the validated categorical palette:
  - every chart has a table view;
  - legends appear only for 2+ series;
  - bars are at most 24 px wide;
  - refetching dims the old render instead of flashing a skeleton.
- **`lib/api.ts`** unwraps the envelope, validates responses against shared Zod schemas, and normalises every failure into `ApiRequestError`.
- **Forms:** React Hook Form with the *same* Zod schema the server validates against. Server field errors map back onto the form.
- **Tokens:** OKLCH design tokens and Tailwind v4 `@theme`. See [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md).

---

## 8. Deployment topology

```
 Browser ──HTTPS──▶ Vercel (static SPA)
                       │  rewrite /api/*  ──HTTPS──▶  Render web service (Express, 1 instance)
                       │                                  │
                       └─ everything else → index.html     └─ /var/data persistent disk:
                                                              SQLite, documents, report files, backups
```

- **Same-origin through a Vercel rewrite.** The browser only ever talks to the Vercel domain. That keeps auth cookies first-party under `SameSite=Strict`.
- **SQLite needs a persistent disk**, and the service runs as **one instance**. The in-process scheduler (report schedules every minute, reminders every 15 minutes, `JOBS_ENABLED`) must not run twice.
- **Backups:** `npm run db:backup` makes verified online snapshots. Use them together with Litestream continuous replication.

Step-by-step instructions: [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 9. Roadmap and verification

| Milestone | Scope | Status |
|---|---|---|
| 1. Foundation | Workspaces, env validation, SQLite, migrations, seed, health checks, error envelope, security middleware, design tokens, status page | ✅ |
| 2. Auth and shell | Login, roles and permissions, CSRF, sessions, protected routes, sidebar, top bar, command palette, UI library, light/dark | ✅ |
| 3. CRM and admissions | Courses, lead sources, lead pipeline (Kanban, calendar), students, duplicate detection, admissions, conversion | ✅ |
| 4. Money | Fee plans, instalments, idempotent payments, allocations, receipts (PDF), reversals and refunds, adjustments, loans and disbursements, outstanding | ✅ |
| 5. Expenses and batches | Expenses with void and approval, trainers, batches, assignment queue, transfers | ✅ |
| 6. Placement | Profiles, tracks, companies, applications, interviews, offers, joining, analytics | ✅ |
| 7. Intelligence | Dashboard KPIs, charts, filters, drill-down, daily/weekly/monthly/yearly/custom reports | ✅ |
| 8. Exports and automation | PDF and Excel reports, email delivery with failure and retry, schedules, notifications, documents, CSV/Excel import, lead export | ✅ |
| 9. Hardening and deploy | Demo data, security review, backups, Vercel + Render configuration, documentation | ✅ (not deployed: needs your accounts) |
| 10. Campus and portals | Account-based navigation, faculty workspace, student portal, class schedule, attendance, online exams, study material, certificates with public verification, placement drives, leave, tasks, inventory, forgot password and portal activation by email, staff profiles and photos, extra student fields | ✅ (migration `0002_academics_portals`) |

**Verification (run, not assumed):**

- `npm run typecheck`
- `npm test`: shared, server (in-memory SQLite, through HTTP) and client suites
- `npm run build`
- a live smoke test against the demo database: sign in, forced password change, dashboard totals cross-checked, PDF, Excel and receipt exports, email recorded, notifications, CSRF and anonymous refusal
- a visual check of the rendered report PDF
- a clean-copy install and build using the exact Vercel and Render commands

---

## 10. Known limitations

- **Single institute, single branch.** There is no multi-tenant separation. Multiple campuses were deliberately left out.
- **Exams are multiple choice only**, one correct option per question. There is no proctoring, so an online exam is an honour-system test.
- **Staff photos** are back office only; students have no photo in the portal.
- **Student activation and password-reset emails** need SMTP, like every other email. In development the link is written to the server log.
- **Cash, not accounting.** Reports show cash movement; accruals, GST returns and a general ledger are out of scope.
- **Historical cancellations:** the admissions *count* uses each admission's current status. An admission cancelled later also drops out of past periods' counts. Balances, by contrast, are fully as-of the period end.
- **Restructuring history:** a fee plan restructured after date D changes the instalments used for D's ageing. Outstanding itself is unaffected.
- **Email** needs SMTP credentials. In development, `EMAIL_TRANSPORT=log` records deliveries as "not delivered (dev mode)" and sends nothing.
- **In-memory import previews** expire after 30 minutes or on restart.
- **Turso and Postgres** are supported by design (D6) but not implemented.
- **No 2FA, no virus scanning of uploads.** See SECURITY.md.

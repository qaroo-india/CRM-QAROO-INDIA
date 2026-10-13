# API Reference

Base URL: `/api/v1`.

- **Development:** the client calls it on `http://localhost:5173`, and Vite forwards it to the API on port 5000.
- **Production:** it is same-origin through the Vercel rewrite (see [DEPLOYMENT.md](DEPLOYMENT.md)).

Every route listed here exists in `server/src/modules/**/*.routes.ts`. Request and
response shapes are the Zod schemas and DTO types in `shared/src`, which the client
imports, so the two sides cannot drift apart silently.

---

## Conventions

### Response envelope

```jsonc
// success
{ "success": true, "data": { /* resource, or a page (below) */ } }

// failure
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid",
  "fields": [{ "path": "amountMinor", "message": "amount cannot be negative" }],
  "details": { /* optional, e.g. duplicate matches */ },
  "requestId": "01a1253f-9adb-7000-80c1-cafdb697d1fc" } }
```

**Paginated lists** return the page inside `data`:

```json
{ "items": [], "total": 140, "page": 1, "limit": 25, "totalPages": 6 }
```

Some lists add a `summary` object with totals for the whole filtered set, not just the
page. Payments and expenses do this.

`requestId` matches the `X-Request-Id` response header. Use it to find the request in the
server logs.

### Error codes

| HTTP | `code` | When |
|---|---|---|
| 400 | `BAD_REQUEST` | Malformed JSON, bad multipart upload |
| 401 | `UNAUTHORIZED` / `TOKEN_EXPIRED` / `SESSION_EXPIRED` / `SESSION_REVOKED` / `INVALID_CREDENTIALS` | No valid session, or wrong email or password. On an expired token the client refreshes once, then signs out. |
| 403 | `FORBIDDEN` / `CSRF_FAILED` / `PASSWORD_CHANGE_REQUIRED` / `ACCOUNT_DISABLED` | Missing permission, missing or wrong CSRF header, a pending password change, or a deactivated account |
| 404 | `NOT_FOUND` / `ROUTE_NOT_FOUND` | Missing record, or one you may not know exists (restricted documents, others' notifications) |
| 409 | `CONFLICT` and specific codes | Duplicate student (`DUPLICATE_STUDENT`, with matches in `details`), invalid state transition, idempotency key reused with different data, expired import preview, `SCHEDULE_CLASH`, `EXAM_FROZEN`, `ALREADY_SUBMITTED`, `TIME_UP`, `LEAVE_OVERLAP`, `TAG_IN_USE`, `ALREADY_HAS_LOGIN`, `EMAIL_IN_USE`, etc. |
| 413 | `PAYLOAD_TOO_LARGE` / `FILE_TOO_LARGE` | JSON body over 1 MB, or an upload over `MAX_UPLOAD_MB` |
| 422 | `VALIDATION_ERROR` | Field-level validation failed. `fields` lists each one. |
| 422 | `INVALID_DATE_RANGE` | Report range missing an end, reversed, or not a real date |
| 422 | `CONSTRAINT_VIOLATION` | A database rule (CHECK / NOT NULL) rejected the data |
| 422 | Business rules | `EMAIL_REQUIRED`, `NO_ADMISSION`, `STUDENT_NOT_ACTIVE` (portal logins), `NOT_COMPLETED` (certificates), `NOT_ENOUGH_STOCK` (inventory), `INVALID_TOKEN` (expired or used reset link), etc. |
| 429 | `RATE_LIMITED` / `ACCOUNT_LOCKED` | Too many requests (`RateLimit` headers say when to retry), or the account is locked for 15 minutes after 5 wrong passwords |
| 500 | `INTERNAL_ERROR` | A bug. The message is generic in production; quote the `requestId`. |
| 503 | `DATABASE_BUSY` | Lock contention lasted 5 s. Safe to retry reads. |

### Data formats

| Kind | Format | Example |
|---|---|---|
| Money | Integer **minor units** (paise), suffix `Minor` | `"agreedFeeMinor": 12500050` is ₹1,25,000.50 |
| Percentage | Integer **basis points** in inputs, suffix `Bps` | `1250` is 12.50% |
| Ratio in reports | Decimal `0..1`, or `null` when undefined | `"conversionRate": 0.429` |
| Business date | `YYYY-MM-DD` in the institute time zone | `"paymentDate": "2026-10-10"` |
| Instant | ISO 8601 | `"createdAt": "2026-10-10T09:57:56.553Z"` |
| Id | UUIDv7 | `"01a1253f-6eb3-7000-a166-426c3ad20b7e"` |

### Lists

Lists take `?page=1&limit=25&sort=<field>&order=asc|desc&q=<search>`. `limit` is capped at 100.

Multi-value filters are comma-separated, for example `?status=active,completed`.

### Writes

- **Sessions:** HttpOnly cookies. Every `POST`/`PUT`/`PATCH`/`DELETE` must send `X-CSRF-Token` with the value from `GET /auth/csrf`. That route also sets the matching cookie.
- **Bodies:** JSON, except uploads, which are `multipart/form-data` with the file in `file`.
- **Unknown fields** are ignored.
- **Idempotency:** `POST /payments` and `POST /admissions` accept an `Idempotency-Key` header of 8–100 characters, `[A-Za-z0-9_-]`.
  - Replaying a key returns the original record instead of creating another.
  - Reusing a key with a different body returns `409`.
- **No silent deletion of money:**
  - Receipts are reversed, never deleted.
  - Refunds are separate records.
  - Adjustments and expenses are voided with a reason.
  - Documents are soft-deleted with a reason.

### Rate limiting

All of `/api/v1` shares a per-IP flood guard. The default is 600 requests per minute, set by `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`. Keep it well above normal use: an office behind one address shares it.

- `POST /auth/login` has its own, tighter limit: `LOGIN_RATE_LIMIT_MAX`.
- Separately, a single account locks for 15 minutes after 5 failed passwords.
- `GET /health/live` is exempt.

---

## Endpoints

Permission names come from `shared/src/constants/roles.ts`. The owner role holds every
permission. "Signed in" means any active user with a session.

**Account types.** Every login is one of three kinds (`users.account_type`):

- `team`: the office. Everything is gated by permissions, as below.
- `faculty`: a trainer's login, linked to a trainer record. It gets teaching permissions by
  default (batches, schedule, attendance, exams, material) and only ever sees **its own
  batches**: the server scopes every list and refuses other batches with 404/403.
- `student`: a student's portal login, linked to a student record. It holds **no**
  permissions and can reach only `/portal/*`, `/notifications/*`, `/auth/*` and the public
  routes. Every other route is behind a back-office wall that refuses student sessions
  with 403, whatever their permissions. A student whose record is `inactive` or
  `suspended` cannot sign in, and an open session ends on its next request.

"Back office" below means any `team` or `faculty` session.

### Health (public)

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | Readiness: database, migrations, settings. Returns 200 when ok or degraded, 503 when the database is down. |
| GET | `/health/live` | Liveness. Never touches the database. |

### Auth

| Method | Path | Access | Notes |
|---|---|---|---|
| GET | `/auth/csrf` | public | Returns `{ csrfToken }` and sets the CSRF cookie |
| POST | `/auth/login` | public | `{ email, password }`. Sets the access and refresh cookies. |
| POST | `/auth/refresh` | refresh cookie | Rotates the refresh token. Reusing an old one revokes the whole family. |
| POST | `/auth/logout` | signed in | Revokes the refresh token and clears cookies |
| GET | `/auth/me` | signed in | Session user, permissions, institute info |
| POST | `/auth/password` | signed in | `{ currentPassword, newPassword }`. Ends every other session. |
| POST | `/auth/forgot-password` | public | `{ email }`. Always answers `{ sent: true }`, whether or not the email exists. Emails a single-use link valid for 30 minutes (at most 3 per hour per account). |
| POST | `/auth/activate` | public | `{ email }`. A student with an admission claims a portal login with the email on their record. Same answer for every email; the link is valid for 24 hours. |
| POST | `/auth/reset-password` | public | `{ token, newPassword }`. Uses a reset or activation link once and ends every existing session. |

Only a SHA-256 hash of each link token is stored. With `EMAIL_TRANSPORT=log` in development
the link is written to the server log instead of being sent.

### Users and settings

| Method | Path | Permission |
|---|---|---|
| GET | `/users/options` | back office (id and name only, for pickers; never lists students) |
| GET | `/users/me` | back office: your own profile (staff code, designation, department...) |
| GET | `/users/:id/photo`; POST `/users/:id/photo` (multipart `file`: PNG, JPG or WEBP, 2 MB) | back office to view; yourself, or `users:write`, to change |
| POST | `/portal-access/students/:id`, `/portal-access/trainers/:id` | `portal:manage`. `{ temporaryPassword }`: gives (or switches back on) a student portal or faculty login. The record's email is the sign-in name (`422 EMAIL_REQUIRED` without one). Students need an admission (`NO_ADMISSION`) and an active record (`STUDENT_NOT_ACTIVE`). |
| POST | `/portal-access/:userId/revoke` | `portal:manage`. Switches a student or faculty login off and signs it out everywhere. |
| GET | `/users` (`?q&role&active&accountType`), `/users/:id` | `users:read`. Student logins are listed only with `accountType=student`. |
| POST | `/users`; PATCH `/users/:id`; POST `/users/:id/deactivate`, `/users/:id/reactivate`, `/users/:id/reset-password` | `users:write`. Only an owner can grant permissions, and nobody can escalate above their own. Office staff take an optional `jobRole` (`counsellor` \| `office_staff`, or `''` for custom): a new account with no permissions listed starts from that role's set. The job role shapes the menu and landing page only; access is always the permission list. |
| GET | `/settings` | signed in |
| PATCH | `/settings` | `settings:write` |
| GET | `/settings/{lead-sources\|expense-categories\|job-categories}` | signed in (`?includeInactive=true`) |
| POST, PATCH `/:id`, POST `/reorder` | `/settings/{lookup}` | `settings:write`. Lookup items are deactivated, never deleted. |
| GET | `/audit` | `audit:read` (`?entityType&action&actorId&from&to`) |
| GET | `/search?q=` | signed in. Results are filtered by your permissions. |

### Courses, leads, students, admissions

| Method | Path | Permission |
|---|---|---|
| GET | `/courses`, `/courses/:id` | `courses:read` |
| POST | `/courses`; PUT `/courses/:id` | `courses:write` |
| GET | `/leads` (`?status&sourceId&courseId&counsellorId&priority&followUp&from&to&q`), `/leads/:id`, `/leads/board`, `/leads/duplicates?phone&email` | `leads:read` |
| GET | `/leads/export?format=xlsx\|csv` + list filters | `leads:export`. Capped at 10,000 rows; formula-injection safe. |
| POST | `/leads`; PUT `/leads/:id`; POST `/leads/:id/status`, `/leads/:id/activities` | `leads:write` |
| POST | `/leads/assign` | `leads:assign` |
| GET | `/students`, `/students/:id` (profile with timeline), `/students/duplicates` | `students:read` |
| POST | `/students`; PUT `/students/:id` | `students:write`. A duplicate phone or email returns `409 DUPLICATE_STUDENT` unless `allowDuplicate: true`. |
| GET | `/admissions` (`?status&courseId&counsellorId&sourceId&batchStatus&from&to&outstanding=true&studentId`), `/admissions/:id` | `admissions:read` |
| POST | `/admissions` (optional `feePlan`, `Idempotency-Key`); PATCH `/admissions/:id`; POST `/admissions/:id/status` (`activate\|complete\|withdraw\|cancel`) | `admissions:write` |

### Money

| Method | Path | Permission |
|---|---|---|
| GET | `/admissions/:id/finance` | `payments:read` or `feePlans:read` |
| POST | `/admissions/:id/fee-plan`, `/admissions/:id/fee-plan/restructure` | `feePlans:write` |
| POST | `/admissions/:id/adjustments`; POST `/adjustments/:id/void` | `discounts:approve` |
| POST | `/admissions/:id/refunds` | `payments:refund` |
| GET | `/payments` (list + `summary`), `/payments/:id`, `/payments/:id/receipt`, `/payments/:id/receipt.pdf` | `payments:read` |
| POST | `/payments` (`Idempotency-Key`) | `payments:write` |
| POST | `/payments/:id/reverse` | `payments:reverse` |
| GET | `/instalments?view=overdue\|due_soon\|upcoming\|partially_paid\|paid\|all_open` | `feePlans:read` |
| GET | `/loans`, `/loans/summary`, `/loans/:id` | `loans:read` |
| POST | `/loans`; PUT `/loans/:id`; POST `/loans/:id/status` | `loans:write`. Approving or rejecting also needs `loans:approve`. |
| POST | `/loans/:id/disbursements`, `/loans/:id/disbursements/:did/received` | `loans:disburse` |
| GET | `/expenses`, `/expenses/:id` | `expenses:read` |
| POST | `/expenses`; PUT `/expenses/:id`; POST `/expenses/:id/void` | `expenses:write` |
| POST | `/expenses/:id/decision` | `expenses:approve` |

### Batches

| Method | Path | Permission |
|---|---|---|
| GET | `/trainers`, `/batches`, `/batches/:id`, `/batches/queue`, `/batch-assignments` | `batches:read` |
| POST | `/trainers`, `/batches`; PUT `/trainers/:id`, `/batches/:id` | `batches:write` |
| POST | `/batch-assignments`, `/batch-assignments/:id/transfer`, `/admissions/:id/batch-status` | `batches:assign` |

### Teaching: schedule, attendance, exams, material, certificates

Faculty sessions see and change only their own batches in all of these.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/schedule?from&to&batchId&courseId&trainerId&status` | `schedule:read` | Classes in the institute's time zone, with `attendanceTaken` |
| POST | `/schedule` | `schedule:write` | One class, or a weekly repeat `{ repeat: { weekdays, until } }` (max 200). A trainer or batch double-booking returns `409 SCHEDULE_CLASH`. |
| PUT | `/schedule/:id`; POST `/schedule/:id/status` | `schedule:write` | Status `completed` or `cancelled` (`{ reason }`); cancelling notifies the batch's students |
| GET | `/attendance/roster?batchId&date` | `attendance:read` | Students in the batch on that day (assignment history respected), with their running percentage |
| POST | `/attendance` | `attendance:write` | `{ batchId, date, topic?, classSessionId?, records[] }`. One register per batch per day; no future dates. |
| GET | `/attendance/sessions?batchId`, `/attendance/summary?batchId` | `attendance:read` | Percent = (present + late + on duty) / (registers − holidays) |
| GET | `/exams?status&batchId&courseId&q`, `/exams/:id` | `exams:read` | Staff detail includes the correct answers |
| POST | `/exams`; PUT `/exams/:id`; POST `/exams/:id/questions`; PUT, DELETE `/exams/questions/:questionId` | `exams:write` | Questions change only while the exam is a draft (`409 EXAM_FROZEN`) |
| POST | `/exams/:id/status` | `exams:write` | `published` (validates the paper, freezes total marks, notifies students), `closed`, `archived` |
| GET | `/exams/:id/results` | `exams:read` | Every submitted attempt, with score and percentage |
| GET | `/materials?courseId&batchId&kind&q`; GET `/materials/:id/open`, `/materials/:id/opens` | `materials:read` | Opening is logged |
| POST | `/materials` (multipart: optional `file`, or `externalUrl`); PUT, DELETE `/materials/:id` | `materials:write` | PDF, Office, images, ZIP and text. Links must be http(s). Delete is soft. |
| GET | `/certificates?status&q`, `/certificates/:id/file` | `certificates:read` | |
| POST | `/certificates`; POST `/certificates/:id/decision` | `certificates:issue` | Only for completed admissions. `requested → under_review → approved → issued \| rejected`. Issuing assigns a permanent reference and renders the PDF. |
| GET | `/verify/certificates/:reference` | **public**, rate limited | `{ valid, referenceNumber, studentName?, courseName?, issuedOn? }`. Reveals nothing for unknown references. |

### Placement

| Method | Path | Permission |
|---|---|---|
| GET | `/placements/profiles` (`?track&stage&courseId&coordinatorId&studentId&q`), `/placements/profiles/:id`, `/placements/applications`, `/placements/companies`, `/placements/analytics?from&to&track&courseId` | `placements:read` |
| POST | `/placements/profiles`; PUT `/placements/profiles/:id`; POST `/placements/profiles/:id/stage`, `/placements/applications`, `/placements/applications/:id/interviews`, `/placements/interviews/:id/result`, `/placements/companies` | `placements:write` |
| POST | `/placements/applications/:id/outcome` | `placements:write`. Offers and joining also need `placements:offer`. |
| GET | `/drives?status&track&q`, `/drives/:id`, `/drives/:id/applicants` | `placements:read` |
| POST | `/drives`; PUT `/drives/:id`; POST `/drives/:id/applicants` (`{ profileIds }`) | `placements:write`. Opening a drive notifies eligible students in its batches. A drive application is an ordinary placement application, one per student per drive. |

### Workplace: leave, tasks, inventory

Open to every back-office session; the permissions below are only for deciding.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/leave?scope=mine\|team&status&userId&from&to` | back office (`team` needs `leave:approve`) | |
| GET | `/leave/today` | `leave:approve` | Who is away today |
| POST | `/leave`; POST `/leave/:id/cancel` | back office | Overlapping requests return `409 LEAVE_OVERLAP`. Cancel your own pending (or future approved) leave. |
| POST | `/leave/:id/decision` | `leave:approve` | `{ decision: approve\|reject, reviewNote }`. Nobody approves their own leave. |
| GET | `/tasks?scope=mine\|created\|all&status&priority&overdue&q` | back office (`all` needs `tasks:assign`) | |
| POST | `/tasks` (multipart, optional `file`); PUT `/tasks/:id`; POST `/tasks/:id/status`; GET `/tasks/:id/attachment` | back office | Assigning to someone else needs `tasks:assign`. Open tasks due today or overdue raise one reminder per person per day. |
| GET | `/inventory/items?category&status&q&available=true` | `inventory:read`, or anyone with `available=true` | Includes a summary (items, units lent, book value) |
| POST | `/inventory/items`; PUT `/inventory/items/:id` | `inventory:write` | Asset tags are unique (`409 TAG_IN_USE`) |
| GET | `/inventory/requests?scope=mine\|all&status`; POST `/inventory/requests` | back office | |
| POST | `/inventory/requests/:id/decision` | `inventory:approve` for `issue`, `reject`, `return`; the requester for `cancel` | Issuing takes stock and can never go negative (`422 NOT_ENOUGH_STOCK`). Consumables are handed out, not returned. |

### Student portal

Student sessions only. The student always comes from the session, never from the request,
so one student can never read another's data.

| Method | Path | Notes |
|---|---|---|
| GET | `/portal/overview` | Admissions with fees and attendance, upcoming classes, counts |
| GET | `/portal/fees`; GET `/portal/receipts/:id` | Instalments and payments; a receipt PDF for one of **your** payments only |
| GET | `/portal/attendance`, `/portal/classes?from&to` | |
| GET | `/portal/exams`; POST `/portal/exams/:id/start` | Start returns the paper. Starting again while an attempt is open resumes it. |
| GET | `/portal/attempts/:id` | The paper, **without** the correct answers. `409 TIME_UP` once the deadline (start + duration, capped by the exam window, plus 30 s grace) has passed: saved answers are graded then. |
| PUT | `/portal/attempts/:id/answers` | `{ questionId, optionId }`. An option from another question is refused. |
| POST | `/portal/attempts/:id/submit`; GET `/portal/attempts/:id/result`, `/portal/results` | Graded on the server |
| GET | `/portal/materials`; GET `/portal/materials/:id/open` | Published material for your courses and batches |
| GET, POST | `/portal/certificates`; GET `/portal/certificates/:id/file` | Request one for a completed admission; download issued ones |
| GET | `/portal/placements`; POST `/portal/drives/:id/apply` | Your placement profile, open drives you are eligible for, your applications |

### Reports, exports and email

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/reports/dashboard?period&from&to&courseId&leadSourceId&counsellorId` | `reports:read` | `DashboardData`: the period report plus live counts, 12 months, batches |
| GET | `/reports/summary?type=daily\|weekly\|monthly\|yearly\|custom&reference&from&to&…` | `reports:read` | `ReportDataset` |
| GET | `/reports/export?format=pdf\|excel&…same filters` | `reports:export` | File download, recorded as a report job |
| POST | `/reports/email` | `reports:email` | `{ …filters, format, recipients[], subject?, message? }`. Returns the job with its delivery status (a failure is recorded, not thrown). |
| GET | `/reports/email-status` | `reports:read` | `{ transport, delivers }`. `log` means development mode: nothing is sent. |
| GET | `/reports/jobs`, `/reports/jobs/:id` | `reports:export` or `reports:email` | History with deliveries |
| GET | `/reports/jobs/:id/download` | `reports:export` | A file containing money also needs `reports:financial` |
| POST | `/reports/deliveries/:id/retry` | `reports:email` | Up to 5 attempts |
| GET, POST | `/reports/schedules` | `reports:email` | |
| PUT, DELETE | `/reports/schedules/:id` | `reports:email` | Deleting keeps past jobs |
| POST | `/reports/schedules/:id/run` | `reports:email` | Sends the previous complete period now |

Money sections of every report (summary finance, cash trend, payment rows, ageing,
collected columns) are **`null` unless the caller holds `reports:financial`**. The
server decides this; the UI does not just hide them.

Expenses are institute-wide. They are `null` whenever a course, source or counsellor
filter is applied, rather than being shown against the wrong slice.

### Notifications, documents, import

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/notifications?unread=true&type` | signed in | Your own only |
| GET | `/notifications/unread-count` | signed in | `{ unread }` |
| POST | `/notifications/:id/read`, `/notifications/read-all` | signed in | |
| POST | `/notifications/sweep` | owner | Runs the reminder sweep now. Otherwise it runs every 15 min. |
| GET | `/documents?ownerType&ownerId&kind&accessLevel&q`, `/documents/:id`, `/documents/student/:studentId` | `documents:read` | You also need read access to the owning record (`students:read`, `admissions:read`, `loans:read`, `expenses:read` or `placements:read`). Restricted items need `documents:restricted`. Anything you may not see is a 404. |
| GET | `/documents/:id/download` | `documents:read` | Attachment, `nosniff`. Restricted downloads are audited. |
| POST | `/documents` (multipart: `file`, `ownerType`, `ownerId`, `kind`, `title`, `accessLevel`) | `documents:write` | PDF, JPG, PNG, WEBP, DOC(X), XLS(X), CSV, TXT. Contents are checked against the extension. |
| POST | `/documents/:id/delete` | `documents:write` | `{ reason }`. Soft delete; the file is retained. |
| GET | `/import/{leads\|students}/template` | `data:import` | CSV template |
| POST | `/import/{leads\|students}/preview` (multipart `file`, .csv or .xlsx, ≤ 2,000 rows) | `data:import` + `leads:write`/`students:write` | Validates every row and flags duplicates. Writes nothing. |
| POST | `/import/{leads\|students}/commit` | same | `{ token, rows[], allowDuplicates }`. Each preview can be committed once. |

---

## Manual testing

```bash
curl -s http://127.0.0.1:5000/api/v1/health

# Sign in with a cookie jar (bash)
curl -s -c jar -b jar http://127.0.0.1:5000/api/v1/auth/csrf          # note csrfToken
curl -s -c jar -b jar -H "X-CSRF-Token: <token>" -H "Content-Type: application/json" \
     -d '{"email":"owner@institute.local","password":"<your password>"}' \
     http://127.0.0.1:5000/api/v1/auth/login
curl -s -b jar "http://127.0.0.1:5000/api/v1/reports/summary?type=monthly"
curl -s -b jar -o report.pdf "http://127.0.0.1:5000/api/v1/reports/export?format=pdf&type=monthly"
```

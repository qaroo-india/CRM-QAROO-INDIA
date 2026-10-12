# Security review

This is the Milestone 9 review: what protects the application, how each protection is
verified, and the risks that remain. The verification column names the automated
test (in `server/tests`, `client/src`) or the manual check that covers each control.

## Authentication and sessions

| Control | Implementation | Verified by |
|---|---|---|
| Password storage | Argon2id: 19 MiB memory, 2 passes (`@node-rs/argon2`). Never logged or returned. | `auth.test.ts` |
| Password policy | 10–128 characters, at least one letter and one digit. Must differ from the current one. | `passwordSchema` in `shared/src/schemas/auth.ts`, enforced on every password route |
| Brute force | Per-IP limit on `/auth/login`. The account locks for 15 min after 5 failures (`429 ACCOUNT_LOCKED`). | `auth.test.ts` |
| First sign-in | The owner and admin-created users must change their password. Until then, every other route returns `403 PASSWORD_CHANGE_REQUIRED`. | `auth.test.ts`, live smoke test |
| Tokens | 15-min access JWT (HS256, secret ≥ 32 characters) and a 7-day refresh token. Both are `HttpOnly; Secure (prod); SameSite=Strict`. Refresh tokens are stored only as SHA-256 hashes. | `auth.test.ts` |
| Rotation and theft | The refresh token rotates on every use. Replaying an old token revokes its whole family (with a 20 s grace window for parallel tabs). | `auth.test.ts` |
| Revocation | Every request re-reads the user. Deactivation, a password change or bumping `token_version` ends all sessions immediately. | `auth.test.ts` |
| CSRF | Double-submit token (`ims_csrf` cookie plus `X-CSRF-Token` header) on every state-changing request, in addition to SameSite=Strict. | `auth.test.ts`, live smoke test (`403` without the header) |
| Reset and activation links | Single use, 30 min (reset) or 24 h (activate). Only a SHA-256 hash is stored. At most 3 links per account per hour, plus a per-IP limit. The answer is identical whether or not the email exists. Using a link ends every session. | `accounts.test.ts` |
| Student status | A student record set to inactive or suspended blocks sign-in and refresh, and ends an open session on its next request. | `accounts.test.ts` |

## Authorisation

- **Every route declares its permission on the server** (`requirePermission` / `requireAnyPermission` / `requireOwner`). The UI hides controls too, but that is convenience, not the control. [API.md](API.md) lists each route with its permission.
- **No privilege escalation.**
  - A non-owner can grant only permissions they hold.
  - Only an owner can create or promote owners.
  - The last active owner cannot be removed.
- **Field-level money redaction:** without `reports:financial`, every money figure in dashboards, reports, exports and emails is `null` or left out. This is decided on the server. A generated file containing money needs the same permission to download again. (`reports.test.ts`, `exports.test.ts`)
- **Refunds, reversals, discounts and loan decisions** each need their own permission: `payments:refund`, `payments:reverse`, `discounts:approve`, `loans:approve`. Offers and joining need `placements:offer`.
- **Documents:**
  - You need `documents:read` **and** read access to the owning record (a student, loan, expense…).
  - Restricted documents (loan paperwork and identity proofs are always restricted) also need `documents:restricted`.
  - Anything you may not see answers `404`, not `403`, so its existence is not revealed.
  - Restricted downloads are audited. (`exports.test.ts`)
- **Notifications** are private to their recipient. Someone else's id returns 404. (`exports.test.ts`)
- **Account types.** Student logins hold no permissions at all. A back-office wall in front of every staff router refuses them with 403, so a forgotten permission check cannot expose staff data to a student. The portal reads the student id from the session, never from the request, and a receipt or certificate is served only to the student it belongs to. Faculty logins are limited to their own batches in schedule, attendance, exams and material. (`accounts.test.ts`, `campus.test.ts`, live smoke test)
- **Exams:** correct answers are never sent to a student; grading is done on the server from saved answers, and an option from another question is refused as tampering. (`campus.test.ts`)
- **Certificate verification** is public but rate limited, and reveals nothing for an unknown reference.

## Data integrity (financial)

- **Money is integer paise** in the database, the API and the calculations. Instalment splits use largest-remainder allocation, so a schedule always sums exactly. (`money.test.ts`, `payments.test.ts`)
- **Append-only ledger:**
  - Receipts are reversed, never deleted.
  - A refund is its own record.
  - Adjustments and expenses are voided with a reason.
  - Documents are soft-deleted with a reason, and the file is kept.
  - Every financial change writes an audit entry with before/after values, the actor, the IP and the request id.
- **Atomicity:** each write is one synchronous SQLite transaction. Allocations must equal the payment amount, and CHECK constraints in the schema are the last line of defence.
- **Idempotency:** payment and admission creation honour `Idempotency-Key`. Replaying returns the original; reusing a key with different data returns `409`. Writes are never auto-retried by the client.
- **Reports use one definition per figure** (ARCHITECTURE §4). Tests cover:
  - date boundaries and the institute time zone;
  - filters;
  - as-of balances;
  - refunds and reversals;
  - and that no figure is double counted. (`reports.test.ts`)

## Input and output handling

| Risk | Control |
|---|---|
| Injection (SQL) | Drizzle query builder, plus `sql` templates with bound parameters. `sql.raw` is used only for constant fragments written in code. `LIKE` searches escape `%`/`_` with an explicit `ESCAPE`. |
| Invalid input | Every body and query is parsed with the shared Zod schemas. Errors are field-level `422`s. |
| XSS | React escapes output. The API sends `Content-Security-Policy: default-src 'none'`. The SPA's CSP (in `vercel.json`) allows no inline script except the theme snippet, by its hash. Upload types exclude HTML and SVG. |
| Spreadsheet formula injection | Text cells starting with `= + - @ TAB CR` get an apostrophe prefix, in Excel reports, the leads export and the CSV templates. (`exports.test.ts`) |
| Malicious uploads | Allow-list by extension. The first bytes must match the type, so a renamed `.exe` is refused. Size cap `MAX_UPLOAD_MB`. Stored outside any web root under random keys. Served only through an authorised route as `attachment` with `nosniff`. (`exports.test.ts`) |
| Path traversal | Storage keys are generated by the server and resolved strictly inside `STORAGE_DIR`. |
| Header injection | Download filenames are reduced to safe ASCII, plus an RFC 5987 UTF-8 form. |
| Resource exhaustion | 1 MB JSON bodies. Page size ≤ 100. Report row lists ≤ 2,000. Lead export ≤ 10,000. Imports ≤ 2,000 rows. Global and login rate limits. |

## Secrets and configuration

- **No secrets in the repository.** `.env` files are git-ignored; `.env.example` holds placeholders only. Render generates `JWT_ACCESS_SECRET`; the other secrets are entered in the dashboard.
- **Production refuses to start** with:
  - the development JWT secret or owner password;
  - `EMAIL_TRANSPORT=log`;
  - an in-memory database;
  - a non-HTTPS client origin.
- **Logs redact** cookies, authorization headers, tokens and passwords. Report email logs contain recipients and subject, never content. SMTP errors are trimmed and scrubbed of credentials before they are stored.
- **Dependency install scripts are disabled** (`.npmrc`). This is a supply-chain safeguard, and it also avoids a broken native compile of better-sqlite3, which ships prebuilt binaries.

## Residual risks and recommendations

| Risk | Recommendation |
|---|---|
| No second factor | Owner accounts protect every record and all money. Consider adding TOTP for owners. |
| SQLite single-writer, single instance | Ample for one institute. For multiple branches with heavy concurrency, move to Postgres (ARCHITECTURE §1, D6). |
| Rate-limit counters are in memory | They reset on restart and are per instance. This is acceptable with one instance. |
| Uploads are not virus-scanned | Files are never executed or rendered inline, but staff open them on their own computers. Add ClamAV or a scanning service if you accept files from outside parties. |
| Data at rest is not encrypted by the app | It relies on the host's disk encryption (Render volumes are encrypted at rest). Back up to an encrypted bucket. |
| Backups live on the same disk unless copied | Follow [DEPLOYMENT.md](DEPLOYMENT.md) §5: copy off-server or use Litestream, and practise a restore. |
| Import previews are held in memory | They are lost on restart (the user re-uploads). There is no data risk. |
| `npm audit`: 2 moderate (uuid < 11.1.1 via exceljs 4.4.0, GHSA-w5hq-g745-h8pq) | The flaw is in uuid's v3/v5/v6 functions when a buffer argument is passed. exceljs calls only `uuidv4()` with no arguments, so it is not reachable here. Upgrade when exceljs ships uuid ≥ 11.1.1. (An npm `overrides` entry was tried; npm did not apply it to the existing lockfile.) |
| Email deliverability | SPF/DKIM for the `EMAIL_FROM` domain must be configured at the mail provider, or reports may land in spam. |

## How to re-verify

```bash
npm run typecheck && npm test          # all automated checks
npm audit --omit=dev                   # known-vulnerable runtime dependencies
```

Before go-live, check manually on the deployed site:

1. Sign in, and confirm the forced password change.
2. Confirm the cookies are `HttpOnly`, `Secure` and `SameSite=Strict` in the browser devtools.
3. Confirm that a staff user without `reports:financial` sees no money on the dashboard.
4. Confirm the security headers at <https://securityheaders.com>.

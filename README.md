# Property Management Platform — Ethiopia

Backend for a localized property management and rental platform built for the Ethiopian market by Possible Technology in partnership with Ethio Telecom. One shared backend serves three clients:

| Client | Users | Purpose |
|---|---|---|
| **Owner Dashboard** (web + app) | Property owners, property managers | Manage properties and units, track rent, review agreements, handle complaints |
| **Tenant App** (Flutter, Android/iOS) | Tenants | Browse, request to rent, sign agreements, pay rent, submit complaints |
| **Admin Control Dashboard** (web) | Possible Technology admins, Ethio Telecom staff | Observe, approve/suspend and audit the whole platform, including payments |

Requirements are in [`docs/srs/`](docs/srs).

**Stack:** NestJS 10 · Prisma 6 · PostgreSQL 16 · Socket.IO · Docker

## Public demo

The included [Render Blueprint](render.yaml) provisions a managed PostgreSQL database and the NestJS API with seeded demo data. Deploy it to Render using the steps in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); the expected URLs are:

- **API docs:** https://property-management-demo-api.onrender.com/api/docs
- **Health:** https://property-management-demo-api.onrender.com/health

These URLs only work after the blueprint has been applied — if the service name is taken, Render appends a suffix and you should use the URL shown in its dashboard. All demo accounts use the password `Demo@12345` (see [Demo accounts](#demo-accounts)).

---

## Quick start (Docker only)

Everything runs in Docker. You never need Node, npm or Postgres on the host.

```bash
git clone https://github.com/mekdelawitworku6/property-management-demo.git
cd property-management-demo
cp .env.example .env          # optional: defaults work out of the box (mock SMS + mock Telebirr)
docker compose up -d --build
```

| What | Where |
|---|---|
| REST API | http://localhost:4100/api/v1 |
| Swagger docs | http://localhost:4100/api/docs |
| Health check | http://localhost:4100/health |
| Realtime (Socket.IO) | `ws://localhost:4100/realtime`, connect with `auth: { token: <accessToken> }` |
| PostgreSQL | `localhost:5434` (postgres / postgres, db `property_management`) |

On startup the backend applies Prisma migrations. The `seed` service then loads the demo data; re-running it is safe.

### Demo accounts

The password for every account is `Demo@12345`.

| Role | Phone | Email |
|---|---|---|
| Admin (Possible Technology) | +251911000001 | admin@possibletech.et |
| Ethio Telecom (payments) | +251911000002 | payments@ethiotelecom.et |
| Owner | +251911000003 | owner@demo.et |
| Manager (works for the owner) | +251911000004 | manager@demo.et |
| Tenant | +251911000005 | tenant@demo.et |

```bash
curl -X POST http://localhost:4100/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"0911000003","password":"Demo@12345"}'
```

---

## Features by SRS requirement

### Owner (FR-OWN)
- **FR-OWN-01** Owner registration. Owners stay pending until an admin approves them; managers can be added under an owner.
- **FR-OWN-02** Residential, commercial and mixed-use properties, with units (rent, deposit, photos, amenities, terms).
- **FR-OWN-03** Owner dashboard: occupancy, rent collected vs. expected, outstanding rent, active tenants, maintenance status.
- **FR-OWN-04** When a tenant signs, the agreement is saved under the property on the owner dashboard.
- **FR-OWN-05** The owner is notified of new complaints and can reply to or escalate them.
- **FR-OWN-06** Payment history per tenant and per property.

### Tenant (FR-TEN)
- **FR-TEN-01** Browse available units filtered by city, sub-city, price, property/unit type and bedrooms.
- **FR-TEN-02** Request to rent through the app.
- **FR-TEN-03** Digital signing of a bilingual agreement. The signed record can't be changed; the text and signature are hashed and anyone can verify them.
- **FR-TEN-04** Pay rent by **Telebirr** or **bank transfer** (the owner can also log cash payments).
- **FR-TEN-05** Submit complaints and maintenance reports with photos.
- **FR-TEN-06** Track complaint status and the full payment history.

### Admin + Ethio Telecom (FR-ADM)
- **FR-ADM-01** Platform-wide view of all owners, tenants, agreements and payments, plus an admin dashboard.
- **FR-ADM-02** Approve, reject, suspend or unsuspend accounts. Suspension signs the user out immediately; approving a tenant's identity (KYC) is also done here.
- **FR-ADM-03** Resolve disputes the owner and tenant couldn't settle between themselves.
- **FR-ADM-04** Audit log of every transaction, agreement and complaint, with timestamp, who did it, their role and IP address.
- **FR-ADM-05** Rent payments are confirmed through Ethio Telecom's payment layer: the Telebirr callback, manual confirmation by Ethio Telecom staff, and checking a payment's status with Telebirr directly.

### Proposal modules (Section 4.1)
- **Tenant & lease management:** tenant ID details (the ID number is encrypted at rest), emergency contacts, lease creation, renewal, termination and document storage, plus automated reminders before a lease expires.
- **Rent collection:**
  - Invoices and payment schedules are generated automatically. Partial months are charged by day.
  - Overdue rent is tracked and tenants get SMS/Telegram reminders.
  - Outstanding balances are shown per tenant.
  - Owner payouts are calculated automatically, minus the platform fee.
- **Maintenance & work orders:** assign vendors, track status, upload photos, keep a vendor directory. The cost of a completed job is recorded as an expense.
- **Financial reporting:** monthly owner statements (income, expenses, net), payment reports and rent roll, exportable as **Excel and PDF in Amharic or English**.
- **Notifications:** in-app, SMS (Ethio Telecom / Geez SMS gateway) and optional Telegram, each in the recipient's language.

### Non-functional
- **Bilingual:** Amharic/English messages and reports, following each user's language preference.
- **Roles:** access control for the Admin, Ethio Telecom, Owner, Manager and Tenant roles. Owners only see their own properties, and managers only see their owner's.
- **Real-time sync:** Socket.IO keeps the tenant app, owner dashboard and admin dashboard in sync.
- **Offline support:**
  - `GET /sync?since=` returns only what changed since the given time.
  - Payments, complaints and work orders accept a `clientRef` key, so a request queued offline and resent isn't recorded twice.
- **Security:** JWT access tokens and single-use refresh tokens, login rate limiting, encrypted personal data, and payment callbacks checked for signature and amount.

---

## Configuration

All settings are environment variables; `docker compose` reads them from `.env`. See [`.env.example`](.env.example).

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATA_ENCRYPTION_KEY` | dev values | **Change in production** |
| `OWNER_AUTO_APPROVE` / `TENANT_AUTO_APPROVE` | `false` / `true` | Whether new accounts need admin approval |
| `PLATFORM_FEE_PERCENT` | `2` | Fee deducted from Telebirr collections in payouts |
| `INVOICE_ADVANCE_DAYS` | `7` | How many days before a rent period its invoice is issued |
| `RENT_REMINDER_INTERVAL_DAYS` | `3` | How often overdue reminders repeat |
| `LEASE_EXPIRY_REMINDER_DAYS` | `30` | Lease-expiry warning window |
| `COMPLAINT_ESCALATION_DAYS` | `7` | After this many days an unresolved complaint becomes visible to the admin |
| `SMS_MOCK`, `SMS_API_URL`, `SMS_API_KEY` | mock | SMS gateway |
| `TELEGRAM_BOT_TOKEN` | empty | Optional Telegram notifications |
| `TELEBIRR_MOCK`, `TELEBIRR_*` | mock | Telebirr merchant credentials |

In mock mode, Telebirr returns a local checkout URL (`/api/v1/payments/telebirr/mock-checkout/<ref>`); opening it simulates the Ethio Telecom confirmation callback.

### Scheduled jobs (Africa/Addis_Ababa time)

| When | Job |
|---|---|
| Daily 01:00 | Expire ended leases and send lease-expiry reminders |
| Daily 06:00 | Generate rent invoices, mark overdue invoices, send rent-due and overdue reminders |
| 1st of each month | Generate the previous month's owner payouts |

---

## Tests

Each module has a test suite that boots the real application against a real PostgreSQL test database and runs its full workflow.

```bash
docker compose run --rm tools npm run test:e2e
```

| Suite | Covers |
|---|---|
| `auth` | Registration, login, token refresh/logout, OTP password reset, profiles, encrypted ID numbers, role-based access |
| `property` | Properties, units, listing filters, hiding owners until approved, ownership isolation |
| `leasing` | Request → accept → sign, tamper detection, renewal, termination, direct leases, expiry |
| `billing` | Invoices and schedules, Telebirr callback, bank transfer + Ethio Telecom confirmation, cash, overdue reminders, payouts, expenses |
| `maintenance` | Complaints, work orders and vendor cost logging, escalation, admin resolution, complaints unresolved past the time limit |
| `reporting-admin` | Dashboards, statements, Excel/PDF exports, admin oversight, audit log, offline sync, suspension |

Fast unit tests (with the database mocked) are also available: `docker compose run --rm tools npm test`.

---

## Project structure

```
property-management-demo/
├── docker-compose.yml          postgres · backend · seed · tools
├── docker/postgres-init.sql    creates the e2e test database
├── docs/srs/                   requirements documents
└── apps/backend/
    ├── Dockerfile              multi-stage: dev (tools) · builder · runtime
    ├── prisma/                 schema.prisma + migrations
    ├── test/                   module e2e suites + shared fixtures
    └── src/
        ├── common/             guards, decorators, filters, interceptors, i18n, audit, utils
        ├── database/           PrismaService, seeds
        └── modules/
            ├── core-services/  auth, users, notifications, realtime, files, health, sync, scheduler
            ├── property/       properties, units, listings
            ├── leasing/        rental-requests, agreements
            ├── billing/        invoices, payments, payouts, expenses
            ├── maintenance/    complaints, vendors, work-orders
            ├── reporting/      dashboard, reports
            ├── admin/          account approval, suspension, KYC
            └── integrations/   telebirr, sms, telegram
```

### API response format

Successful responses:
```json
{ "statusCode": 200, "success": true, "message": "Retrieved successfully", "data": { }, "timestamp": "..." }
```
List endpoints return `data: { docs, page, limit, total, totalPages }`.

Errors:
```json
{ "statusCode": 400, "success": false, "message": "...", "data": null, "errors": ["..."], "timestamp": "..." }
```

---

## Common commands

```bash
docker compose logs -f backend
docker compose run --rm tools npx prisma migrate dev --name <change>   # after editing schema.prisma
docker compose run --rm seed                                            # re-run demo seed
docker compose down            # stop (keeps data)
docker compose down -v         # full reset including the database
```

See [`AGENTS.md`](AGENTS.md) for contributor conventions.

## Roadmap

- Connect live Telebirr and SMS credentials (the integration code is ready and currently runs in mock mode).
- Subscription billing for owners (commercial model, Section 6).
- Fayda digital ID verification (the data field already exists).
- USSD channel for users without smartphones.

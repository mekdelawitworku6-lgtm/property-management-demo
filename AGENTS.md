# AGENTS.md

## Project
Property Management Platform (Ethiopia) — monorepo (`apps/`, `docs/`). Backend is a NestJS + Prisma app at `apps/backend` (PostgreSQL).
Requirements: `docs/srs/` (Business Proposal & SRS + Property Rental Platform SRS).

## Golden rule: use Docker
Never run npm / npx / nest / prisma commands directly on the host. Build, run, migrate, seed and test everything through Docker.

### Start everything (migrations run automatically, then the seed)
```bash
docker compose up -d --build
docker compose logs -f backend
```
- API: http://localhost:4100/api/v1 — Swagger: http://localhost:4100/api/docs — Health: http://localhost:4100/health
- Postgres: localhost:5434 (postgres/postgres, db `property_management`)
- Realtime: Socket.IO namespace `/realtime`, connect with `auth: { token: <accessToken> }`

### Tests (inside the `tools` container)
```bash
docker compose run --rm tools npm test              # unit tests (every service/util/controller function)
docker compose run --rm tools npm run test:cov      # with coverage
docker compose run --rm tools npm run test:e2e      # full flow against a real test database
```

### Database / Prisma
```bash
docker compose run --rm tools npx prisma migrate dev --name <change>   # after editing prisma/schema.prisma
docker compose run --rm tools npx prisma generate
docker compose run --rm seed                                            # re-run the idempotent seed
docker compose down -v                                                   # full reset incl. DB volume
```

## Demo accounts (seeded, password `Demo@12345`)
| Role | Phone | Email |
|---|---|---|
| Admin (Possible Technology) | +251911000001 | admin@possibletech.et |
| Ethio Telecom (payments) | +251911000002 | payments@ethiotelecom.et |
| Owner | +251911000003 | owner@demo.et |
| Manager (of the owner) | +251911000004 | manager@demo.et |
| Tenant | +251911000005 | tenant@demo.et |

Login: `POST /api/v1/auth/login` with `{ "identifier": "<phone or email>", "password": "Demo@12345" }`.

## Structure (mirrors BMDelivery)
```
apps/backend/
  prisma/schema.prisma, prisma/migrations/
  src/common/        guards, decorators, filters, interceptors, i18n (AM/EN), audit, utils
  src/database/      PrismaService, seeds
  src/modules/
    core-services/   auth, users, notifications, realtime, files, health, sync, scheduler
    property/        properties, units, listings
    leasing/         rental-requests, agreements
    billing/         invoices, payments (Telebirr/bank/cash), payouts, expenses
    maintenance/     complaints, vendors, work-orders
    reporting/       dashboard, reports (Excel/PDF)
    admin/           account approval / suspension / KYC
    integrations/    telebirr, sms, telegram
```

## Conventions
- Controllers return plain data; the global `TransformInterceptor` wraps it in `{ statusCode, success, message, data, timestamp }`.
- Every route requires a JWT unless marked `@Public()`; restrict with `@Roles(...)`.
- Owner-side scoping: use `resolveOwnerId` / `scopeWhere` from `common/utils/owner-scope.util.ts` (managers act for their owner).
- Every transaction, agreement and complaint action is written with `AuditService.log(...)` (FR-ADM-04).
- Each new function gets a unit test next to it (`*.spec.ts`, Prisma mocked via `src/test-utils/mocks.ts`).
- Integrations default to mock mode (`TELEBIRR_MOCK=true`, `SMS_MOCK=true`) so the stack runs without credentials.

## Git workflow
Commit after every meaningful stage with conventional messages (`feat(backend): ...`, `test(backend): ...`). Never commit `.env`.

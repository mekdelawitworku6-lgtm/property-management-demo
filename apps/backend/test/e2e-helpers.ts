/**
 * Shared bootstrap for module-level e2e suites: resets the test database, seeds staff
 * accounts, boots the real Nest app and offers helpers to build common fixtures.
 */
import { execSync } from 'child_process';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) throw new Error('TEST_DATABASE_URL is required (run: docker compose run --rm tools npm run test:e2e)');
process.env.DATABASE_URL = TEST_DB;
process.env.SMS_MOCK = 'true';
process.env.TELEBIRR_MOCK = 'true';
process.env.OWNER_AUTO_APPROVE = 'false';

// Imported after DATABASE_URL points at the test database.
/* eslint-disable @typescript-eslint/no-var-requires */
const { AppModule } = require('../src/app.module');
const { configureApp } = require('../src/main');
const { seed, SEED_PASSWORD } = require('../src/database/seeds/seed');

export const API = '/api/v1';
export const today = () => new Date().toISOString().slice(0, 10);

export interface E2EContext {
  app: INestApplication;
  prisma: PrismaClient;
  http: () => ReturnType<typeof request>;
  tokens: Record<string, string>;
  auth: (who: string) => { Authorization: string };
  login: (identifier: string, password?: string) => Promise<string>;
  close: () => Promise<void>;
}

let phoneCounter = 0;
/** Unique Ethiopian test phone numbers per suite. */
export function nextPhone(): string {
  phoneCounter += 1;
  return `09${String(30000000 + Math.floor(Math.random() * 60000000) + phoneCounter).slice(0, 8)}`;
}

export async function setupE2E(): Promise<E2EContext> {
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    env: { ...process.env, DATABASE_URL: TEST_DB },
    stdio: 'ignore',
  });
  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DB } } });
  const log = console.log;
  console.log = () => undefined;
  await seed(prisma);
  console.log = log;

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true, logger: false });
  configureApp(app);
  await app.init();

  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  const login = async (identifier: string, password = SEED_PASSWORD) => {
    const res = await http().post(`${API}/auth/login`).send({ identifier, password }).expect(200);
    return res.body.data.tokens.accessToken as string;
  };
  tokens.admin = await login('+251911000001');
  tokens.telecom = await login('+251911000002');

  return {
    app,
    prisma,
    http,
    tokens,
    login,
    auth: (who) => ({ Authorization: `Bearer ${tokens[who]}` }),
    close: async () => {
      await app.close();
      await prisma.$disconnect();
    },
  };
}

/** Registers a user via the API and stores its token under `key`. Returns the user id. */
export async function register(ctx: E2EContext, key: string, role: 'OWNER' | 'TENANT', extra: Record<string, unknown> = {}) {
  const res = await ctx.http().post(`${API}/auth/register`).send({
    role, fullName: `${role} ${key}`, phoneNumber: nextPhone(), password: 'Secret1234', ...extra,
  }).expect(201);
  ctx.tokens[key] = res.body.data.tokens.accessToken;
  return res.body.data.user.id as string;
}

/** Approved owner with one property and one vacant unit (rent 10,000 / deposit 20,000). */
export async function createOwnerWithUnit(ctx: E2EContext, key = 'owner') {
  const ownerId = await register(ctx, key, 'OWNER');
  await ctx.http().patch(`${API}/admin/users/${ownerId}/approve`).set(ctx.auth('admin')).expect(200);
  const property = await ctx.http().post(`${API}/properties`).set(ctx.auth(key)).send({
    name: 'Sarbet Residence', type: 'RESIDENTIAL', city: 'Addis Ababa', subCity: 'Kolfe', address: 'Sarbet',
  }).expect(201);
  const unit = await ctx.http().post(`${API}/properties/${property.body.data.id}/units`).set(ctx.auth(key)).send({
    unitNumber: 'B-1', type: 'APARTMENT', bedrooms: 2, rentAmount: 10000, depositAmount: 20000,
  }).expect(201);
  return { ownerId, propertyId: property.body.data.id as string, unitId: unit.body.data.id as string };
}

/** Full request → accept → sign flow. Returns the active agreement id. */
export async function createActiveLease(ctx: E2EContext, ownerKey: string, tenantKey: string, unitId: string) {
  const req = await ctx.http().post(`${API}/rental-requests`).set(ctx.auth(tenantKey))
    .send({ unitId, desiredStartDate: today(), durationMonths: 12 }).expect(201);
  const accepted = await ctx.http().post(`${API}/rental-requests/${req.body.data.id}/accept`).set(ctx.auth(ownerKey)).send({}).expect(201);
  const agreementId = accepted.body.data.agreement.id as string;
  const view = await ctx.http().get(`${API}/agreements/${agreementId}`).set(ctx.auth(tenantKey)).expect(200);
  await ctx.http().post(`${API}/agreements/${agreementId}/sign`).set(ctx.auth(tenantKey))
    .send({ signatureName: 'Tenant', contentHash: view.body.data.contentHash, acceptTerms: true }).expect(201);
  return agreementId;
}

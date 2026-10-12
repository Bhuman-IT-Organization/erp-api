/**
 * The HTTP contract erp-web's `features/branding` was built against, proven in-process with
 * Fastify `inject`: the anonymous `GET /api/v1/branding`, its DTO shape (with the customer's
 * `formats`, plan 03.2-02), the client cache header from `TIMINGS.branding.cacheMaxAgeS`, the
 * `x-request-id` every response carries, and the ADR-0030 route assertion (every route under
 * `/api/v1/` or in `UNPREFIXED_ROUTES`).
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TIMINGS } from '../../../shared/config/timings.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { BRANDING_ROUTES } from '../branding.routes.js';
import { brandingResponseSchema, formatsSchema } from '../dto/branding.dto.js';
import { DEFAULT_FORMATS } from '../model/branding.model.js';
import { COMPANY_UPLOADS_PATH } from '../service/branding.transformer.js';
import { createBrandingTestApp, type BrandingTestApp } from './create-branding-test-app.js';
import { SEED_FORMATS } from './fakes.js';

const BRANDING = `/${API_PREFIX}/${BRANDING_ROUTES.base}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('BrandingController (Fastify inject, no network)', () => {
  let ctx: BrandingTestApp;

  beforeAll(async () => {
    ctx = await createBrandingTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /api/v1/branding answers 200 with the DTO and the public cache header, anonymously', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: BRANDING });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['cache-control']).toBe(
      `public, max-age=${String(TIMINGS.branding.cacheMaxAgeS)}`,
    );
    const body = brandingResponseSchema.parse(JSON.parse(res.payload));
    expect(body).toEqual({
      companyName: 'Cube',
      logoUrl: `${COMPANY_UPLOADS_PATH}/logo.png`,
      logoDarkUrl: `${COMPANY_UPLOADS_PATH}/logo-dark.png`,
      theme: {},
      defaultLocale: 'en',
      formats: SEED_FORMATS,
    });
  });

  it('GET /api/v1/branding answers the formats object (D-33, D-44) anonymously, the cache header unchanged', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: BRANDING });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(
      `public, max-age=${String(TIMINGS.branding.cacheMaxAgeS)}`,
    );
    const body = JSON.parse(res.payload) as { formats?: unknown };
    expect(Object.keys(body.formats ?? {}).sort()).toEqual([
      'currency',
      'dateFormat',
      'decimalPlaces',
      'decimalSeparator',
      'removeDecimalsOnZero',
      'thousandSeparator',
      'timeFormat',
      'timeZone',
    ]);
    expect(formatsSchema.parse(body.formats)).toEqual(SEED_FORMATS);
  });

  it('carries x-request-id on the response: minted when absent, echoed when valid', async () => {
    const minted = await ctx.app.inject({ method: 'GET', url: BRANDING });
    expect(minted.headers['x-request-id']).toMatch(UUID);

    const echoed = await ctx.app.inject({
      method: 'GET',
      url: BRANDING,
      headers: { 'x-request-id': 'web-trace-1' },
    });
    expect(echoed.headers['x-request-id']).toBe('web-trace-1');
    expect(echoed.payload).not.toContain('web-trace-1');
  });

  it('answers the unprefixed path with 404 as a problem (the route lives under the prefix only)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: `/${BRANDING_ROUTES.base}` });
    expect(res.statusCode).toBe(404);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('ADR-0030: every route is under /api/v1/ or one of UNPREFIXED_ROUTES; nothing under /api/auth, /api/attendance or /api/face', () => {
    expect(ctx.routes.length).toBeGreaterThanOrEqual(1);
    const unprefixed: readonly string[] = UNPREFIXED_ROUTES.map((route) => `/${route}`);
    for (const url of ctx.routes) {
      expect(url.startsWith(`/${API_PREFIX}/`) || unprefixed.includes(url)).toBe(true);
      expect(url.startsWith('/api/auth')).toBe(false);
      expect(url.startsWith('/api/attendance')).toBe(false);
      expect(url.startsWith('/api/face')).toBe(false);
    }
    expect(ctx.routes).toContain(BRANDING);
  });
});

describe('BrandingController with no format settings and no default currency', () => {
  let ctx: BrandingTestApp;

  beforeAll(async () => {
    ctx = await createBrandingTestApp();
    // Set before the first request: the service memoises what it reads first.
    ctx.settings.options = [];
    ctx.currencies.base = null;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('answers exactly DEFAULT_FORMATS (the Perfex install defaults)', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: BRANDING });
    expect(res.statusCode).toBe(200);
    const body = brandingResponseSchema.parse(JSON.parse(res.payload));
    expect(body.formats).toEqual(DEFAULT_FORMATS);
    expect(JSON.parse(res.payload)).toMatchObject({ formats: { timeZone: null, currency: null } });
  });
});

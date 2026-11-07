/**
 * The HTTP contract erp-web (plan 01.3-04) and the legacy `erp_sso` module were built against,
 * proven in-process with Fastify `inject`: status codes, problem-details bodies and `ERP-*`
 * codes, the three cookies with their attributes (`erp_refresh` on its narrow path, `erp_csrf`,
 * and `erp_session_present` on `/` — ADR-0032), CSRF on exactly the protected POSTs, refresh
 * rotation and reuse detection, lockout with `Retry-After`, the JWKS `kid`, and ADR-0031's load
 * shedding (breaker open → 503 + `Retry-After` with zero legacy calls, state on `/health`).
 * The ADR-0030 route assertion at the end proves nothing shadows the attendance app's paths.
 */
import 'reflect-metadata';
import { decodeProtectedHeader } from 'jose';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TIMINGS } from '../../../shared/config/timings.js';
import { PROBLEM_CONTENT_TYPE } from '../../../shared/errors/problem-details.filter.js';
import type { HealthReport } from '../../../shared/health/health.types.js';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  SESSION_PRESENT_COOKIE,
  SESSION_PRESENT_COOKIE_PATH,
  SESSION_PRESENT_COOKIE_VALUE,
} from '../auth.routes.js';
import {
  jwksResponseSchema,
  loginResponseSchema,
  meResponseSchema,
  type LoginResponseDto,
} from '../dto/auth.dto.js';
import {
  createAuthTestApp,
  TEST_LEGACY_BASE_URL,
  type AuthTestApp,
} from './create-auth-test-app.js';
import { SEED_EMAILS, SEED_PASSWORDS, SEED_STAFF_IDS } from './fakes.js';

const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const LOGOUT_ALL = '/api/v1/auth/logout-all';
const ME = '/api/v1/auth/me';
const CSRF = '/api/v1/auth/csrf';
const LEGACY_SSO = '/api/v1/auth/legacy-sso';
const JWKS = '/.well-known/jwks.json';
const HEALTH = '/api/v1/health';

interface Problem {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
}

interface Login {
  readonly body: LoginResponseDto;
  readonly refresh: string;
  readonly csrfSecret: string;
}

function cookie(res: LightMyRequestResponse, name: string) {
  return res.cookies.find((c) => c.name === name);
}

function problem(res: LightMyRequestResponse): Problem {
  expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return JSON.parse(res.payload) as Problem;
}

describe('auth controller (in-process)', () => {
  let ctx: AuthTestApp;

  beforeAll(async () => {
    ctx = await createAuthTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function login(email: string, password: string): Promise<Login> {
    const res = await ctx.app.inject({ method: 'POST', url: LOGIN, payload: { email, password } });
    expect(res.statusCode).toBe(200);
    const body = loginResponseSchema.parse(JSON.parse(res.payload));
    const refresh = cookie(res, REFRESH_COOKIE)?.value;
    const csrfSecret = cookie(res, CSRF_COOKIE)?.value;
    if (refresh === undefined || csrfSecret === undefined) throw new Error('cookies missing');
    return { body, refresh, csrfSecret };
  }

  function refresh(session: Login, overrides: { refresh?: string; header?: string } = {}) {
    return ctx.app.inject({
      method: 'POST',
      url: REFRESH,
      cookies: {
        [REFRESH_COOKIE]: overrides.refresh ?? session.refresh,
        [CSRF_COOKIE]: session.csrfSecret,
      },
      headers: { [CSRF_HEADER]: overrides.header ?? session.body.csrfToken },
    });
  }

  it('POST login → 200 loginResponseSchema, erp_refresh, erp_csrf and erp_session_present with the designed attributes', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: LOGIN,
      payload: { email: SEED_EMAILS.active, password: SEED_PASSWORDS.active },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const body = loginResponseSchema.parse(JSON.parse(res.payload));
    expect(body.user.staffId).toBe(SEED_STAFF_IDS.active);
    expect(body.expiresIn).toBe(TIMINGS.auth.accessTokenTtlMs / 1_000);
    expect(res.payload).not.toMatch(/\$2y\$|erp_refresh/);

    const refreshCookie = cookie(res, REFRESH_COOKIE);
    expect(refreshCookie?.httpOnly).toBe(true);
    expect(refreshCookie?.sameSite).toBe('Strict');
    expect(refreshCookie?.path).toBe('/api/v1/auth/refresh');
    expect(refreshCookie?.secure).toBeUndefined();
    expect(refreshCookie?.maxAge).toBe(TIMINGS.auth.refreshTokenTtlMs / 1_000);
    expect(refreshCookie?.value).toMatch(/^10\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);

    const csrfCookie = cookie(res, CSRF_COOKIE);
    expect(csrfCookie?.httpOnly).toBe(true);
    expect(csrfCookie?.sameSite).toBe('Strict');
    expect(csrfCookie?.path).toBe('/api/v1/auth');
    expect(csrfCookie?.secure).toBeUndefined();

    // ADR-0032: the presence flag rides beside them — `Path=/`, `SameSite=Lax`, the same lifetime
    // as `erp_refresh`, value `1`. It carries no secret and authorises nothing.
    const presentCookie = cookie(res, SESSION_PRESENT_COOKIE);
    expect(presentCookie?.httpOnly).toBe(true);
    expect(presentCookie?.sameSite).toBe('Lax');
    expect(presentCookie?.path).toBe(SESSION_PRESENT_COOKIE_PATH);
    expect(presentCookie?.secure).toBeUndefined();
    expect(presentCookie?.maxAge).toBe(TIMINGS.auth.refreshTokenTtlMs / 1_000);
    expect(presentCookie?.value).toBe(SESSION_PRESENT_COOKIE_VALUE);

    expect(ctx.publisher.drain().map((e) => e.name)).toEqual([
      'auth.password.rehashed',
      'auth.login.succeeded',
    ]);
  });

  it('the access token kid is the JWKS kid; JWKS is cacheable and public-only', async () => {
    const session = await login(SEED_EMAILS.admin, SEED_PASSWORDS.admin);
    const res = await ctx.app.inject({ method: 'GET', url: JWKS });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe(
      `public, max-age=${String(TIMINGS.auth.jwksCacheMaxAgeS)}`,
    );
    const jwks = jwksResponseSchema.parse(JSON.parse(res.payload));
    expect(jwks.keys).toHaveLength(1);
    expect(decodeProtectedHeader(session.body.accessToken).kid).toBe(jwks.keys[0]?.kid);
    expect(Object.keys(jwks.keys[0] ?? {}).sort()).toEqual(['alg', 'e', 'kid', 'kty', 'n', 'use']);
  });

  it('wrong password → 401 ERP-AUTH-0001 as problem+json, nothing about the hash', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: LOGIN,
      payload: { email: SEED_EMAILS.active, password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(problem(res)).toMatchObject({ status: 401, code: 'ERP-AUTH-0001' });
    expect(res.payload).not.toMatch(/password|hash/i);
  });

  it('malformed body → 400 ERP-VALIDATION-0001 with issues', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: LOGIN, payload: { email: 'nope' } });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.payload) as Problem & { issues?: unknown[] };
    expect(body.code).toBe('ERP-VALIDATION-0001');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('inactive account → 401 ERP-AUTH-0001 (indistinguishable from a wrong password)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: LOGIN,
      payload: { email: SEED_EMAILS.inactive, password: SEED_PASSWORDS.inactive },
    });
    expect(res.statusCode).toBe(401);
    expect(problem(res).code).toBe('ERP-AUTH-0001');
  });

  it('two-factor account → 403 ERP-AUTH-0007', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: LOGIN,
      payload: { email: SEED_EMAILS.twoFactor, password: SEED_PASSWORDS.twoFactor },
    });
    expect(res.statusCode).toBe(403);
    expect(problem(res).code).toBe('ERP-AUTH-0007');
  });

  // 15 s, not the 5 s default: its five bcrypt logins took 1.9 to 3.7 s under full-suite load and once 5026 ms.
  it('five failures lock the e-mail: 429 ERP-AUTH-0006 with an integer Retry-After', async () => {
    const email = 'locked@example.test';
    let res = await ctx.app.inject({
      method: 'POST',
      url: LOGIN,
      payload: { email, password: 'x' },
    });
    for (let i = 1; i < TIMINGS.auth.lockoutThreshold; i += 1) {
      res = await ctx.app.inject({ method: 'POST', url: LOGIN, payload: { email, password: 'x' } });
    }
    expect(res.statusCode).toBe(429);
    expect(problem(res).code).toBe('ERP-AUTH-0006');
    expect(res.headers['retry-after']).toMatch(/^[1-9]\d*$/);
    expect(Number(res.headers['retry-after'])).toBeLessThanOrEqual(
      TIMINGS.auth.lockoutBaseMs / 1_000,
    );
  }, 15_000);

  it('GET me with a bearer → 200 meResponseSchema with the sorted CLEAN permissions; without → 401 0004', async () => {
    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const ok = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { authorization: `Bearer ${session.body.accessToken}` },
    });
    expect(ok.statusCode).toBe(200);
    // The exact array, not a shape: clean ADR-0033 names only. The seeded rows are the Perfex
    // `invoices.view`, `staff.view`, `roles.view` and the unmapped swapped-order `edit.tasks`,
    // which the enricher drops (T-3.1-20, T-3.1-24) — no Perfex naming crosses to the browser.
    const permissions = meResponseSchema.parse(JSON.parse(ok.payload)).permissions;
    expect(permissions).toEqual(['sales.invoices.view', 'staff.members.view', 'staff.roles.view']);
    expect(permissions).not.toContain('edit.tasks');
    expect(permissions.some((code) => code.includes('_'))).toBe(false);
    const anonymous = await ctx.app.inject({ method: 'GET', url: ME });
    expect(anonymous.statusCode).toBe(401);
    expect(problem(anonymous).code).toBe('ERP-AUTH-0004');
  });

  it('GET me names the modules this deployment switches off: none by default (ADR-0042)', async () => {
    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const ok = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { authorization: `Bearer ${session.body.accessToken}` },
    });
    expect(meResponseSchema.parse(JSON.parse(ok.payload)).disabledModules).toEqual([]);
  });

  it('GET csrf with the secret cookie → 200 { csrfToken }; without it → a new secret cookie', async () => {
    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const res = await ctx.app.inject({
      method: 'GET',
      url: CSRF,
      cookies: { [CSRF_COOKIE]: session.csrfSecret },
    });
    expect(res.statusCode).toBe(200);
    expect(typeof (JSON.parse(res.payload) as { csrfToken: unknown }).csrfToken).toBe('string');
    expect(cookie(res, CSRF_COOKIE)).toBeUndefined();

    const fresh = await ctx.app.inject({ method: 'GET', url: CSRF });
    expect(fresh.statusCode).toBe(200);
    expect(cookie(fresh, CSRF_COOKIE)?.path).toBe('/api/v1/auth');
  });

  it('POST refresh with the cookie but no x-csrf-token → 403 ERP-AUTH-0008 (problem shape)', async () => {
    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const res = await ctx.app.inject({
      method: 'POST',
      url: REFRESH,
      cookies: { [REFRESH_COOKIE]: session.refresh, [CSRF_COOKIE]: session.csrfSecret },
    });
    expect(res.statusCode).toBe(403);
    expect(problem(res)).toMatchObject({ status: 403, code: 'ERP-AUTH-0008' });
  });

  it('POST refresh with a token that does not match the secret cookie → 403 ERP-AUTH-0008', async () => {
    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const res = await refresh(session, { header: 'forged' });
    expect(res.statusCode).toBe(403);
    expect(problem(res).code).toBe('ERP-AUTH-0008');
  });

  it('POST refresh with cookie + header → 200, a NEW erp_refresh and a re-set erp_session_present; replay → 401 0003; old access token → 401 0004', async () => {
    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);

    const rotated = await refresh(session);
    expect(rotated.statusCode).toBe(200);
    const body = loginResponseSchema.parse(JSON.parse(rotated.payload));
    expect(body.accessToken).not.toBe(session.body.accessToken);
    const newRefresh = cookie(rotated, REFRESH_COOKIE);
    expect(newRefresh?.value).toBeDefined();
    expect(newRefresh?.value).not.toBe(session.refresh);
    expect(newRefresh?.path).toBe('/api/v1/auth/refresh');

    // ADR-0032: the presence flag is re-set with a fresh Max-Age so it slides with the token.
    const present = cookie(rotated, SESSION_PRESENT_COOKIE);
    expect(present?.httpOnly).toBe(true);
    expect(present?.sameSite).toBe('Lax');
    expect(present?.path).toBe(SESSION_PRESENT_COOKIE_PATH);
    expect(present?.secure).toBeUndefined();
    expect(present?.maxAge).toBe(TIMINGS.auth.refreshTokenTtlMs / 1_000);
    expect(present?.value).toBe(SESSION_PRESENT_COOKIE_VALUE);

    const replay = await refresh(session);
    expect(replay.statusCode).toBe(401);
    expect(problem(replay).code).toBe('ERP-AUTH-0003');

    const dead = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { authorization: `Bearer ${session.body.accessToken}` },
    });
    expect(dead.statusCode).toBe(401);
    expect(problem(dead).code).toBe('ERP-AUTH-0004');
    expect(await ctx.store.listSessionIds(SEED_STAFF_IDS.active)).not.toContain(
      String(newRefresh?.value.split('.')[1]),
    );
  });

  it('POST refresh without any cookie → 403 0008 (the CSRF hook runs first); with a garbage cookie → 401 0002', async () => {
    const none = await ctx.app.inject({ method: 'POST', url: REFRESH });
    expect(none.statusCode).toBe(403);
    expect(problem(none).code).toBe('ERP-AUTH-0008');

    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const garbage = await refresh(session, { refresh: 'garbage' });
    expect(garbage.statusCode).toBe(401);
    expect(problem(garbage).code).toBe('ERP-AUTH-0002');
  });

  it('POST refresh that ends the session (0002/0003) clears erp_refresh and erp_session_present with their own Path and SameSite; 0008 and 5xx clear neither', async () => {
    // ADR-0037 (WR-09): a refused refresh must not leave the presence flag behind, or proxy.ts keeps
    // admitting a member whose session is gone. Each clearing line carries the attributes the cookie
    // was set with, or the browser would not match it.
    function expectCleared(res: LightMyRequestResponse): void {
      const refreshLine = cookie(res, REFRESH_COOKIE);
      expect(refreshLine?.value).toBe('');
      expect(refreshLine?.path).toBe('/api/v1/auth/refresh');
      expect(refreshLine?.sameSite).toBe('Strict');
      expect(refreshLine?.httpOnly).toBe(true);
      expect(
        refreshLine?.maxAge === 0 ||
          (refreshLine?.expires !== undefined && refreshLine.expires < new Date()),
      ).toBe(true);
      const presentLine = cookie(res, SESSION_PRESENT_COOKIE);
      expect(presentLine?.value).toBe('');
      expect(presentLine?.path).toBe(SESSION_PRESENT_COOKIE_PATH);
      expect(presentLine?.sameSite).toBe('Lax');
      expect(presentLine?.httpOnly).toBe(true);
      expect(
        presentLine?.maxAge === 0 ||
          (presentLine?.expires !== undefined && presentLine.expires < new Date()),
      ).toBe(true);
    }
    function expectUntouched(res: LightMyRequestResponse): void {
      expect(cookie(res, REFRESH_COOKIE)).toBeUndefined();
      expect(cookie(res, SESSION_PRESENT_COOKIE)).toBeUndefined();
    }

    // Reuse: rotate once, then replay the old cookie → 0003, both cleared.
    const reused = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    expect((await refresh(reused)).statusCode).toBe(200);
    const replay = await refresh(reused);
    expect(replay.statusCode).toBe(401);
    expect(problem(replay).code).toBe('ERP-AUTH-0003');
    expectCleared(replay);

    // A dead cookie → 0002, both cleared.
    const deadCookie = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const garbage = await refresh(deadCookie, { refresh: 'garbage' });
    expect(garbage.statusCode).toBe(401);
    expect(problem(garbage).code).toBe('ERP-AUTH-0002');
    expectCleared(garbage);

    // CSRF refusal → 0008 clears neither: a cross-site POST cannot sign anyone out.
    const forged = await ctx.app.inject({ method: 'POST', url: REFRESH });
    expect(forged.statusCode).toBe(403);
    expect(problem(forged).code).toBe('ERP-AUTH-0008');
    expectUntouched(forged);

    // An outage is not a sign-out: a store failure → 500 clears neither.
    const outage = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const spy = vi.spyOn(ctx.store, 'getSession').mockRejectedValueOnce(new Error('store down'));
    const down = await refresh(outage);
    spy.mockRestore();
    expect(down.statusCode).toBe(500);
    expect(problem(down).code).toBe('ERP-INTERNAL-0001');
    expectUntouched(down);
  });

  it('POST logout with bearer + CSRF → 204, erp_refresh and erp_session_present cleared, token and session dead', async () => {
    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const res = await ctx.app.inject({
      method: 'POST',
      url: LOGOUT,
      headers: {
        authorization: `Bearer ${session.body.accessToken}`,
        [CSRF_HEADER]: session.body.csrfToken,
      },
      cookies: { [CSRF_COOKIE]: session.csrfSecret },
    });
    expect(res.statusCode).toBe(204);
    const cleared = cookie(res, REFRESH_COOKIE);
    expect(cleared?.value).toBe('');
    expect(cleared?.path).toBe('/api/v1/auth/refresh');
    expect(
      cleared?.maxAge === 0 || (cleared?.expires !== undefined && cleared.expires < new Date()),
    ).toBe(true);

    // ADR-0032: one helper clears both, so the browser cannot keep a presence flag without a session.
    const clearedPresent = cookie(res, SESSION_PRESENT_COOKIE);
    expect(clearedPresent?.value).toBe('');
    expect(clearedPresent?.path).toBe(SESSION_PRESENT_COOKIE_PATH);
    expect(clearedPresent?.sameSite).toBe('Lax');
    expect(clearedPresent?.httpOnly).toBe(true);
    expect(clearedPresent?.secure).toBeUndefined();
    expect(
      clearedPresent?.maxAge === 0 ||
        (clearedPresent?.expires !== undefined && clearedPresent.expires < new Date()),
    ).toBe(true);

    const dead = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { authorization: `Bearer ${session.body.accessToken}` },
    });
    expect(dead.statusCode).toBe(401);
    const reuse = await refresh(session);
    expect(reuse.statusCode).toBe(401);
    expect(problem(reuse).code).toBe('ERP-AUTH-0002');
  });

  it('POST logout without CSRF → 403 0008 even with a bearer; without a bearer → 401 0004 once CSRF passes', async () => {
    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const noCsrf = await ctx.app.inject({
      method: 'POST',
      url: LOGOUT,
      headers: { authorization: `Bearer ${session.body.accessToken}` },
    });
    expect(noCsrf.statusCode).toBe(403);
    expect(problem(noCsrf).code).toBe('ERP-AUTH-0008');

    const noBearer = await ctx.app.inject({
      method: 'POST',
      url: LOGOUT,
      headers: { [CSRF_HEADER]: session.body.csrfToken },
      cookies: { [CSRF_COOKIE]: session.csrfSecret },
    });
    expect(noBearer.statusCode).toBe(401);
    expect(problem(noBearer).code).toBe('ERP-AUTH-0004');
  });

  it('POST logout-all → 204, erp_refresh and erp_session_present cleared, and every session of the staff member is gone', async () => {
    const a = await login(SEED_EMAILS.admin, SEED_PASSWORDS.admin);
    const b = await login(SEED_EMAILS.admin, SEED_PASSWORDS.admin);
    const res = await ctx.app.inject({
      method: 'POST',
      url: LOGOUT_ALL,
      headers: { authorization: `Bearer ${a.body.accessToken}`, [CSRF_HEADER]: a.body.csrfToken },
      cookies: { [CSRF_COOKIE]: a.csrfSecret },
    });
    expect(res.statusCode).toBe(204);
    expect(await ctx.store.listSessionIds(SEED_STAFF_IDS.admin)).toEqual([]);

    // ADR-0032: logout-all clears the presence flag in the same response as `erp_refresh`.
    expect(cookie(res, REFRESH_COOKIE)?.value).toBe('');
    const clearedPresent = cookie(res, SESSION_PRESENT_COOKIE);
    expect(clearedPresent?.value).toBe('');
    expect(clearedPresent?.path).toBe(SESSION_PRESENT_COOKIE_PATH);
    expect(clearedPresent?.sameSite).toBe('Lax');
    expect(clearedPresent?.httpOnly).toBe(true);
    expect(clearedPresent?.secure).toBeUndefined();
    expect(
      clearedPresent?.maxAge === 0 ||
        (clearedPresent?.expires !== undefined && clearedPresent.expires < new Date()),
    ).toBe(true);

    const other = await ctx.app.inject({
      method: 'GET',
      url: ME,
      headers: { authorization: `Bearer ${b.body.accessToken}` },
    });
    expect(other.statusCode).toBe(401);
  });

  /**
   * ADR-0032 rejects widening `erp_refresh`'s path as a decision, not a note: the refresh
   * credential must never ride on a page request. This case fails the moment someone tries
   * (T-3.1-02) — the presence cookie is what erp-web reads instead.
   */
  it('erp_refresh keeps its narrow path and SameSite=Strict on login and on rotation while erp_session_present stays on /', async () => {
    const fresh = await ctx.app.inject({
      method: 'POST',
      url: LOGIN,
      payload: { email: SEED_EMAILS.active, password: SEED_PASSWORDS.active },
    });
    const freshRefresh = cookie(fresh, REFRESH_COOKIE);
    expect(freshRefresh?.path).toBe('/api/v1/auth/refresh');
    expect(freshRefresh?.sameSite).toBe('Strict');

    const session = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const rotated = await refresh(session);
    expect(rotated.statusCode).toBe(200);
    const rotatedRefresh = cookie(rotated, REFRESH_COOKIE);
    expect(rotatedRefresh?.path).toBe('/api/v1/auth/refresh');
    expect(rotatedRefresh?.sameSite).toBe('Strict');
    expect(rotatedRefresh?.httpOnly).toBe(true);
    expect(cookie(rotated, SESSION_PRESENT_COOKIE)?.path).toBe('/');
  });

  describe('ADR-0031: legacy-sso through the legacy breaker', () => {
    let bearer: string;

    beforeAll(async () => {
      bearer = (await login(SEED_EMAILS.active, SEED_PASSWORDS.active)).body.accessToken;
    });

    it('GET legacy-sso without a bearer → 401 and no legacy call', async () => {
      const before = ctx.legacyFetch.calls.length;
      const res = await ctx.app.inject({ method: 'GET', url: LEGACY_SSO });
      expect(res.statusCode).toBe(401);
      expect(ctx.legacyFetch.calls).toHaveLength(before);
    });

    it('with a bearer and legacy answering 405 + X-Erp-Sso: active → 200 { status: ready }, one GET of /erp_sso/handoff', async () => {
      const before = ctx.legacyFetch.calls.length;
      const res = await ctx.app.inject({
        method: 'GET',
        url: LEGACY_SSO,
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'ready' });
      expect(ctx.legacyFetch.calls).toHaveLength(before + 1);
      expect(ctx.legacyFetch.calls.at(-1)).toEqual({
        url: `${TEST_LEGACY_BASE_URL}/erp_sso/handoff`,
        method: 'GET',
      });
    });

    it('GET /api/v1/health lists checks.breakers.legacy = closed', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: HEALTH });
      expect(res.statusCode).toBe(200);
      const report = JSON.parse(res.payload) as HealthReport;
      expect(report.checks.breakers).toEqual({ legacy: 'closed' });
    });

    it('breaker forced open → 503 ERP-UPSTREAM-0001 + Retry-After with ZERO legacy calls', async () => {
      // Step past the transport's 5 s value cache: the previous `ready` must not answer this call.
      ctx.transport.now = () => Date.now() + TIMINGS.http.legacy.probeCacheMs + 1;
      ctx.breakers.get('legacy').forceOpen();
      const before = ctx.legacyFetch.calls.length;
      const res = await ctx.app.inject({
        method: 'GET',
        url: LEGACY_SSO,
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(res.statusCode).toBe(503);
      expect(problem(res)).toMatchObject({ status: 503, code: 'ERP-UPSTREAM-0001' });
      expect(res.headers['retry-after']).toBe(
        String(Math.ceil(TIMINGS.breaker.halfOpenAfterMs / 1_000)),
      );
      expect(ctx.legacyFetch.calls).toHaveLength(before);
    });

    it('GET /api/v1/health then → 200, status ok, checks.breakers.legacy = open (an open breaker never degrades the api)', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: HEALTH });
      expect(res.statusCode).toBe(200);
      const report = JSON.parse(res.payload) as HealthReport;
      expect(report.status).toBe('ok');
      expect(report.checks.breakers).toEqual({ legacy: 'open' });
    });

    it('forceClose restores closed and the probe reaches legacy again', async () => {
      ctx.breakers.get('legacy').forceClose();
      const before = ctx.legacyFetch.calls.length;
      const res = await ctx.app.inject({
        method: 'GET',
        url: LEGACY_SSO,
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(res.statusCode).toBe(200);
      expect(ctx.legacyFetch.calls).toHaveLength(before + 1);
      const health = JSON.parse(
        (await ctx.app.inject({ method: 'GET', url: HEALTH })).payload,
      ) as HealthReport;
      expect(health.checks.breakers).toEqual({ legacy: 'closed' });
    });

    it('legacy answering 405 without the header → 200 { status: inactive } (uploaded, not activated)', async () => {
      ctx.transport.now = () => Date.now() + 2 * TIMINGS.http.legacy.probeCacheMs + 2;
      ctx.legacyFetch.answer = () => Promise.resolve(new Response(null, { status: 405 }));
      const res = await ctx.app.inject({
        method: 'GET',
        url: LEGACY_SSO,
        headers: { authorization: `Bearer ${bearer}` },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ status: 'inactive' });
    });
  });

  it('ADR-0030: every route is under /api/v1/ or one of the unprefixed pair; nothing under /api/auth, /api/attendance or /api/face', () => {
    expect(ctx.routes.length).toBeGreaterThanOrEqual(10);
    for (const url of ctx.routes) {
      expect(
        url.startsWith('/api/v1/') || url === '/.well-known/jwks.json' || url === '/health',
      ).toBe(true);
      expect(url.startsWith('/api/auth')).toBe(false);
      expect(url.startsWith('/api/attendance')).toBe(false);
      expect(url.startsWith('/api/face')).toBe(false);
    }
    expect(ctx.routes).toContain(LOGIN);
    expect(ctx.routes).toContain(JWKS);
  });
});

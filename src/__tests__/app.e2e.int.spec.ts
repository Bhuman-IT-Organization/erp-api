/**
 * The whole `AppModule` against the local stack (`../erp-infra/env/local/api.host.env`: MySQL on
 * 127.0.0.1:33061, Redis on 127.0.0.1:63791, legacy on 127.0.0.1:8080), bootstrapped exactly as
 * `main.ts` does (cookie/CSRF plugins, compression, prefix, filter), driven with Fastify `inject`.
 *
 * The login group performs a REAL login: the active staff member with the highest `staffid`
 * (never staffid 1) gets a throwaway `$2y$10$` password, logs in through the api (which re-hashes
 * the row to `$2y$12$` and touches `last_login`/`last_ip`), refreshes, replays, logs out; `afterAll`
 * restores the three columns byte for byte and deletes every Redis key the run created by exact
 * name (never a FLUSH). Lockout is exercised on an e-mail no row has. No real password and no hash
 * is printed or committed (T-1.3-47).
 *
 * Recovery if a run dies before the restore:
 *   node ../erp-infra/legacy-local/reset-password.mjs <email> <password>
 */
import 'reflect-metadata';
import { gunzipSync } from 'node:zlib';
import { decodeJwt } from 'jose';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { compare, genSaltSync, hashSync } from 'bcryptjs';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { AppConfig } from '../shared/config/app-config.js';
import { HTTP } from '../shared/config/http.js';
import { TIMINGS } from '../shared/config/timings.js';
import { PrismaService } from '../shared/db/prisma.service.js';
import {
  PROBLEM_CONTENT_TYPE,
  ProblemDetailsFilter,
} from '../shared/errors/problem-details.filter.js';
import type { HealthReport } from '../shared/health/health.types.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../shared/http/api-prefix.js';
import { registerCompression } from '../shared/http/compression.js';
import { registerFastifyPlugins } from '../shared/http/fastify-plugins.js';
import { DOCS_PATH, OPENAPI_PATH, setupApiDocs } from '../shared/http/openapi.js';
import { LoggerService } from '../shared/logger/logger.service.js';
import { BreakerRegistry } from '../shared/resilience/breaker.js';
import { breakerOptions } from '../shared/resilience/resilience.module.js';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  REFRESH_COOKIE,
  SESSION_PRESENT_COOKIE,
} from '../v1/auth/auth.routes.js';
import {
  jwksResponseSchema,
  loginResponseSchema,
  meResponseSchema,
} from '../v1/auth/dto/auth.dto.js';
import { AUTH_HTTP_SECURITY } from '../v1/auth/index.js';
import { DomainEvent } from '../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../shared/events/domain-event.publisher.js';
import { IdentityFacade } from '../v1/identity/index.js';
import { authKeys, AUTH_SESSION_STORE } from '../v1/auth/repository/auth-session.store.js';
import type { RedisAuthSessionStore } from '../v1/auth/repository/redis-auth-session.store.js';
import { PasswordHasher } from '../v1/auth/service/password-hasher.js';

/**
 * `identity.permissions.replaced` as a bare `DomainEvent` — the subscriber reads the NAME, so the
 * wire contract is what is under test and this file does not import another module's `events/`.
 */
class PermissionsReplacedProbeV1 extends DomainEvent<
  'identity.permissions.replaced',
  { staffId: number; at: string }
> {
  readonly name = 'identity.permissions.replaced' as const;
}

/** `identity.member.passwordChanged` as a bare `DomainEvent`, same reason (review CR-01). */
class MemberPasswordChangedProbeV1 extends DomainEvent<
  'identity.member.passwordChanged',
  { staffId: number; at: string }
> {
  readonly name = 'identity.member.passwordChanged' as const;
}

/** `identity.member.accessChanged` as a bare `DomainEvent`, same reason (review CR-02 a). */
class MemberAccessChangedProbeV1 extends DomainEvent<
  'identity.member.accessChanged',
  { staffId: number; at: string }
> {
  readonly name = 'identity.member.accessChanged' as const;
}

const EXPECTED_STAFF_ROWS = 33;
const THROWAWAY_PLAINTEXT = 'app-int-throwaway-plaintext';
const LOCKOUT_EMAIL = 'app-int-lockout@example.invalid';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const ME = '/api/v1/auth/me';
const LEGACY_SSO = '/api/v1/auth/legacy-sso';
const JWKS = '/.well-known/jwks.json';
const OPENAPI = `/${API_PREFIX}/${OPENAPI_PATH}`;
const DOCS = `/${API_PREFIX}/${DOCS_PATH}`;
/** The only entrance of the local stack: Nginx → api container. */
const NGINX_ORIGIN = 'http://localhost:8088';

interface OriginalRow {
  readonly staffid: number;
  readonly email: string;
  readonly password: string;
  readonly last_login: Date | null;
  readonly last_ip: string | null;
}

interface Problem {
  readonly status: number;
  readonly code: string;
}

function cookie(res: LightMyRequestResponse, name: string) {
  return res.cookies.find((c) => c.name === name);
}

function problem(res: LightMyRequestResponse): Problem {
  expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  return JSON.parse(res.payload) as Problem;
}

describe.skipIf(!process.env.DATABASE_URL)('AppModule against the local stack', () => {
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let store: RedisAuthSessionStore;
  let original: OriginalRow;
  /** Redis keys created by this run, deleted by exact name in afterAll. */
  const createdKeys = new Set<string>();
  /** `METHOD url` of every route Fastify registered (the `onRoute` hook, attached before any registration). */
  const routes: string[] = [];

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRoute', (route) => {
        for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
          routes.push(`${method} ${route.url}`);
        }
      });
    await registerFastifyPlugins(app, AUTH_HTTP_SECURITY, { cookieSecure: false });
    await registerCompression(app);
    app.setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED_ROUTES] });
    setupApiDocs(app, moduleRef.get(AppConfig).env.API_DOCS_ENABLED);
    app.useGlobalFilters(new ProblemDetailsFilter(moduleRef.get(LoggerService)));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    prisma = moduleRef.get(PrismaService);
    store = moduleRef.get<RedisAuthSessionStore>(AUTH_SESSION_STORE);
    const row = await prisma.client.tblstaff.findFirst({
      where: { active: 1 },
      orderBy: { staffid: 'desc' },
      select: { staffid: true, email: true, password: true, last_login: true, last_ip: true },
    });
    if (row === null) throw new Error('no active staff row in the mirror');
    expect(row.staffid).not.toBe(1);
    original = row;
    createdKeys.add(authKeys.sessions(row.staffid));
    // NOT the version key: it is a monotonic counter the service owns; deleting it would make an
    // access token issued by a concurrent real session valid again.
    createdKeys.add(authKeys.perm(row.staffid));
    createdKeys.add(authKeys.lockout(row.email.toLowerCase()));
    createdKeys.add(authKeys.lockout(LOCKOUT_EMAIL));
  });

  afterAll(async () => {
    try {
      const { count } = await prisma.client.tblstaff.updateMany({
        where: { staffid: original.staffid },
        data: {
          password: original.password,
          last_login: original.last_login,
          last_ip: original.last_ip,
        },
      });
      expect(count).toBe(1);
      const restored = await prisma.client.tblstaff.findUnique({
        where: { staffid: original.staffid },
        select: { password: true, last_login: true, last_ip: true },
      });
      expect(restored?.password).toBe(original.password);
      expect(restored?.last_ip).toBe(original.last_ip);
      expect(restored?.last_login?.getTime() ?? null).toBe(original.last_login?.getTime() ?? null);
      expect(await prisma.client.tblstaff.count()).toBe(EXPECTED_STAFF_ROWS);
      for (const sid of await store.listSessionIds(original.staffid)) {
        createdKeys.add(authKeys.sess(original.staffid, sid));
      }
      if (createdKeys.size > 0) await store.client.del([...createdKeys]);
    } finally {
      await app.close();
    }
  });

  it('GET /api/v1/health returns 200 with db, redis and the legacy breaker closed', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as HealthReport;
    expect(body.status).toBe('ok');
    expect(body.checks.db).toBe('ok');
    expect(body.checks.redis).toBe('ok');
    // The email adapter (IntegrationsModule) takes its breaker at boot; the api never sends, so it stays closed.
    expect(body.checks.breakers).toEqual({ legacy: 'closed', email: 'closed' });
  });

  it('GET /health returns 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('ADR-0030 route set: every route is under /api/v1/ or in UNPREFIXED_ROUTES; the docs paths sit under the prefix (GET + HEAD), never in UNPREFIXED_ROUTES', () => {
    const unprefixed: readonly string[] = UNPREFIXED_ROUTES.map((route) => `/${route}`);
    expect(routes.length).toBeGreaterThanOrEqual(20);
    for (const entry of routes) {
      const url = entry.slice(entry.indexOf(' ') + 1);
      expect(url.startsWith(`/${API_PREFIX}/`) || unprefixed.includes(url), entry).toBe(true);
    }
    for (const path of [OPENAPI, DOCS]) {
      expect(routes).toContain(`GET ${path}`);
      expect(routes).toContain(`HEAD ${path}`);
      expect(unprefixed).not.toContain(path);
    }
  });

  it('GET /api/v1/openapi.json is the 3.1 document (API_DOCS_ENABLED defaults to true outside production) and /api/v1/docs the UI', async () => {
    expect(moduleRef.get(AppConfig).env.API_DOCS_ENABLED).toBe(true);
    const json = await app.inject({ method: 'GET', url: OPENAPI });
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-type']).toContain('application/json');
    const document = JSON.parse(json.payload) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toBe('3.1.0');
    expect(Object.keys(document.paths)).toContain(LOGIN);
    const ui = await app.inject({ method: 'GET', url: DOCS });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
  });

  it('through Nginx :8088 the document answers 200 application/json, the UI 200 text/html, each compressed once (gzip by the api, Nginx does not recompress)', async () => {
    const json = await fetch(`${NGINX_ORIGIN}${OPENAPI}`, {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toContain('application/json');
    expect((await json.json()) as { openapi: string }).toMatchObject({ openapi: '3.1.0' });
    const ui = await fetch(`${NGINX_ORIGIN}${DOCS}`, { headers: { 'accept-encoding': 'gzip' } });
    expect(ui.status).toBe(200);
    expect(ui.headers.get('content-type')).toContain('text/html');
    expect(await ui.text()).toContain('swagger-ui');
  });

  it('GET /.well-known/jwks.json → 200 with an RSA key and a kid', async () => {
    const res = await app.inject({ method: 'GET', url: JWKS });
    expect(res.statusCode).toBe(200);
    const jwks = jwksResponseSchema.parse(JSON.parse(res.payload));
    expect(jwks.keys[0]?.kty).toBe('RSA');
    expect(jwks.keys[0]?.kid.length).toBeGreaterThan(20);
    expect(res.rawPayload.length).toBeGreaterThanOrEqual(HTTP.compress.thresholdBytes);
  });

  it('JWKS with Accept-Encoding: gzip is gzipped once and inflates to the same document (ADR-0031 §6)', async () => {
    const raw = await app.inject({ method: 'GET', url: JWKS });
    const res = await app.inject({
      method: 'GET',
      url: JWKS,
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(res.rawPayload).toString('utf8'))).toEqual(
      JSON.parse(raw.payload),
    );
  });

  it('GET /api/v1/health with Accept-Encoding: gzip stays raw: below HTTP.compress.thresholdBytes by rule', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.rawPayload.length).toBeLessThan(HTTP.compress.thresholdBytes);
  });

  describe('a real login against the mirror and Redis', () => {
    let accessToken: string;
    let refreshCookie: string;
    let csrfSecret: string;
    let csrfToken: string;
    let permissionRows: number;

    beforeAll(async () => {
      const seeded = await prisma.client.tblstaff.updateMany({
        where: { staffid: original.staffid },
        data: {
          password: hashSync(THROWAWAY_PLAINTEXT, genSaltSync(10).replace(/^\$2b\$/, '$2y$')),
        },
      });
      expect(seeded.count).toBe(1);
      // Since plan 03.1-11 `v1/identity` owns `tblstaff_permissions` (ADR-0034 d.1), so the row
      // count comes through the facade `AuthService` itself now reads.
      permissionRows = (await moduleRef.get(IdentityFacade).permissionsOf(original.staffid)).length;
    });

    it('wrong password → 401 ERP-AUTH-0001', async () => {
      const res = await app.inject({
        method: 'POST',
        url: LOGIN,
        payload: { email: original.email, password: 'not-the-throwaway' },
      });
      expect(res.statusCode).toBe(401);
      expect(problem(res).code).toBe('ERP-AUTH-0001');
    });

    it('POST login → 200, all three cookies, the row re-hashed to $2y$12$, last_login/last_ip touched, Redis keys written', async () => {
      const res = await app.inject({
        method: 'POST',
        url: LOGIN,
        payload: { email: original.email, password: THROWAWAY_PLAINTEXT },
      });
      expect(res.statusCode).toBe(200);
      const body = loginResponseSchema.parse(JSON.parse(res.payload));
      expect(body.user.staffId).toBe(original.staffid);
      accessToken = body.accessToken;
      csrfToken = body.csrfToken;
      const refresh = cookie(res, REFRESH_COOKIE);
      const csrf = cookie(res, CSRF_COOKIE);
      expect(refresh?.httpOnly).toBe(true);
      expect(refresh?.sameSite).toBe('Strict');
      expect(refresh?.path).toBe('/api/v1/auth/refresh');
      expect(csrf?.path).toBe('/api/v1/auth');
      // ADR-0032: the presence flag against a real Redis and MySQL; `/` is what erp-web needs.
      const present = cookie(res, SESSION_PRESENT_COOKIE);
      expect(present?.path).toBe('/');
      expect(present?.sameSite).toBe('Lax');
      expect(present?.value).toBe('1');
      if (refresh === undefined || csrf === undefined) throw new Error('cookies missing');
      refreshCookie = refresh.value;
      csrfSecret = csrf.value;

      const row = await prisma.client.tblstaff.findUnique({
        where: { staffid: original.staffid },
        select: { password: true, last_login: true, last_ip: true },
      });
      expect(row?.password.startsWith(PasswordHasher.TARGET_PREFIX)).toBe(true);
      expect(await compare(THROWAWAY_PLAINTEXT, row?.password ?? '')).toBe(true);
      expect(row?.last_ip).toBe('127.0.0.1');
      expect(row?.last_login).not.toBeNull();

      const sid = String(decodeJwt(accessToken).sid);
      createdKeys.add(authKeys.sess(original.staffid, sid));
      expect(await store.getSession(original.staffid, sid)).not.toBeNull();
      expect(await store.getPermissions(original.staffid)).not.toBeNull();
      expect(await store.getLockout(original.email.toLowerCase())).toBeNull();
    });

    /**
     * The ADR-0034 / brief §7 subscription end to end, against the real Redis: publishing
     * `identity.permissions.replaced` on the in-process bus makes `v1/auth`'s handler drop
     * `auth:perm:{staffId}`, so a permission change applies on the next request rather than the next
     * refresh (threat T-3.1-47). The event is constructed by NAME rather than by importing
     * `v1/identity`'s class, because the name is the contract the subscriber reads (BE-03).
     */
    it('publishing identity.permissions.replaced drops auth:perm:{staffId} in Redis, and the session survives', async () => {
      const key = authKeys.perm(original.staffid);
      expect(await store.client.exists(key)).toBe(1);
      const versionBefore = await store.getVersion(original.staffid);

      await moduleRef
        .get<DomainEventPublisher>(DOMAIN_EVENT_PUBLISHER)
        .publish(new PermissionsReplacedProbeV1({ staffId: original.staffid, at: 'now' }));

      expect(await store.client.exists(key)).toBe(0);
      expect(await store.getPermissions(original.staffid)).toBeNull();
      // Only the snapshot went: the member is still signed in and the token version is untouched.
      expect(await store.getVersion(original.staffid)).toBe(versionBefore);
      const me = await app.inject({
        method: 'GET',
        url: ME,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(me.statusCode).toBe(200);
      // The next read rebuilt the snapshot through identity.facade.permissionsOf.
      expect(await store.client.exists(key)).toBe(1);
    });

    it('GET me with the bearer → 200 with every permission row as a code', async () => {
      const res = await app.inject({
        method: 'GET',
        url: ME,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const me = meResponseSchema.parse(JSON.parse(res.payload));
      expect(me.staffId).toBe(original.staffid);
      expect(me.permissions.length).toBeLessThanOrEqual(permissionRows);
      expect(me.permissions.length).toBe(new Set(me.permissions).size);
    });

    it('POST refresh rotates through Redis; the replayed cookie → 401 0003 and the first access token dies', async () => {
      // The version counter is never reset (a real login or verify-wave0.mjs may have bumped it):
      // assert the increment, not an absolute value, so the suite is order-independent.
      const versionBefore = await store.getVersion(original.staffid);
      const rotated = await app.inject({
        method: 'POST',
        url: REFRESH,
        cookies: { [REFRESH_COOKIE]: refreshCookie, [CSRF_COOKIE]: csrfSecret },
        headers: { [CSRF_HEADER]: csrfToken },
      });
      expect(rotated.statusCode).toBe(200);
      const next = cookie(rotated, REFRESH_COOKIE)?.value;
      expect(next).toBeDefined();
      expect(next).not.toBe(refreshCookie);

      const replay = await app.inject({
        method: 'POST',
        url: REFRESH,
        cookies: { [REFRESH_COOKIE]: refreshCookie, [CSRF_COOKIE]: csrfSecret },
        headers: { [CSRF_HEADER]: csrfToken },
      });
      expect(replay.statusCode).toBe(401);
      expect(problem(replay).code).toBe('ERP-AUTH-0003');
      expect(await store.getVersion(original.staffid)).toBe(versionBefore + 1);

      const dead = await app.inject({
        method: 'GET',
        url: ME,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(dead.statusCode).toBe(401);
      expect(problem(dead).code).toBe('ERP-AUTH-0004');
    });

    it('a fresh login then POST logout → 204, cookie cleared, token revoked in Redis', async () => {
      const login = await app.inject({
        method: 'POST',
        url: LOGIN,
        payload: { email: original.email, password: THROWAWAY_PLAINTEXT },
      });
      expect(login.statusCode).toBe(200);
      const body = loginResponseSchema.parse(JSON.parse(login.payload));
      const claims = decodeJwt(body.accessToken);
      createdKeys.add(authKeys.sess(original.staffid, String(claims.sid)));
      createdKeys.add(authKeys.revoked(String(claims.jti)));
      const secret = cookie(login, CSRF_COOKIE)?.value ?? '';

      const res = await app.inject({
        method: 'POST',
        url: LOGOUT,
        headers: { authorization: `Bearer ${body.accessToken}`, [CSRF_HEADER]: body.csrfToken },
        cookies: { [CSRF_COOKIE]: secret },
      });
      expect(res.statusCode).toBe(204);
      expect(cookie(res, REFRESH_COOKIE)?.value).toBe('');
      expect(cookie(res, SESSION_PRESENT_COOKIE)?.value).toBe('');
      expect(cookie(res, SESSION_PRESENT_COOKIE)?.path).toBe('/');
      expect(await store.isRevoked(String(claims.jti))).toBe(true);
      expect(await store.getSession(original.staffid, String(claims.sid))).toBeNull();
    });

    it('five failures on an unknown e-mail → 429 ERP-AUTH-0006 with Retry-After, keyed in Redis', async () => {
      let res: LightMyRequestResponse | undefined;
      for (let i = 0; i < TIMINGS.auth.lockoutThreshold; i += 1) {
        res = await app.inject({
          method: 'POST',
          url: LOGIN,
          payload: { email: LOCKOUT_EMAIL, password: 'x' },
        });
      }
      expect(res?.statusCode).toBe(429);
      expect(res?.headers['retry-after']).toMatch(/^[1-9]\d*$/);
      expect((await store.getLockout(LOCKOUT_EMAIL))?.failures).toBe(TIMINGS.auth.lockoutThreshold);
    });

    it('legacy breaker forced open → legacy-sso 503 ERP-UPSTREAM-0001 + Retry-After; health open but ok; closed again', async () => {
      const login = await app.inject({
        method: 'POST',
        url: LOGIN,
        payload: { email: original.email, password: THROWAWAY_PLAINTEXT },
      });
      const body = loginResponseSchema.parse(JSON.parse(login.payload));
      createdKeys.add(authKeys.sess(original.staffid, String(decodeJwt(body.accessToken).sid)));
      const breaker = moduleRef.get(BreakerRegistry).get('legacy');
      breaker.forceOpen();
      try {
        const res = await app.inject({
          method: 'GET',
          url: LEGACY_SSO,
          headers: { authorization: `Bearer ${body.accessToken}` },
        });
        expect(res.statusCode).toBe(503);
        expect(problem(res).code).toBe('ERP-UPSTREAM-0001');
        const { halfOpenAfterMs } = breakerOptions(moduleRef.get(AppConfig).env);
        expect(res.headers['retry-after']).toBe(String(Math.ceil(halfOpenAfterMs / 1_000)));
        const health = JSON.parse(
          (await app.inject({ method: 'GET', url: '/api/v1/health' })).payload,
        ) as HealthReport;
        expect(health.status).toBe('ok');
        expect(health.checks.breakers).toEqual({ legacy: 'open', email: 'closed' });
      } finally {
        breaker.forceClose();
      }
      const health = JSON.parse(
        (await app.inject({ method: 'GET', url: '/api/v1/health' })).payload,
      ) as HealthReport;
      expect(health.checks.breakers).toEqual({ legacy: 'closed', email: 'closed' });

      // With the breaker closed the probe reaches the legacy container at LEGACY_BASE_URL.
      const live = await app.inject({
        method: 'GET',
        url: LEGACY_SSO,
        headers: { authorization: `Bearer ${body.accessToken}` },
      });
      expect(live.statusCode).toBe(200);
      expect(['ready', 'inactive']).toContain(
        (JSON.parse(live.payload) as { status: string }).status,
      );
    });

    /** A fresh login whose keys are registered for the exact-name delete in afterAll. */
    async function freshSession(): Promise<{
      accessToken: string;
      refresh: string;
      secret: string;
      csrf: string;
      sid: string;
    }> {
      const login = await app.inject({
        method: 'POST',
        url: LOGIN,
        payload: { email: original.email, password: THROWAWAY_PLAINTEXT },
      });
      expect(login.statusCode).toBe(200);
      const body = loginResponseSchema.parse(JSON.parse(login.payload));
      const claims = decodeJwt(body.accessToken);
      const sid = String(claims.sid);
      createdKeys.add(authKeys.sess(original.staffid, sid));
      createdKeys.add(authKeys.revoked(String(claims.jti)));
      return {
        accessToken: body.accessToken,
        refresh: cookie(login, REFRESH_COOKIE)?.value ?? '',
        secret: cookie(login, CSRF_COOKIE)?.value ?? '',
        csrf: body.csrfToken,
        sid,
      };
    }

    // The last two cases end EVERY session of the member, the group's shared one included, so they
    // sit after every case that uses it.

    /**
     * Review CR-01 of Phase 3.1, against the real Redis: an administrator-set password
     * (`identity.member.passwordChanged`) must kill the refresh cookie too, not only the access
     * token. `refresh` never compares a token version, so only deleting the session does it.
     */
    it('publishing identity.member.passwordChanged kills a refresh cookie and an access token issued before it (CR-01)', async () => {
      const before = await freshSession();

      await moduleRef
        .get<DomainEventPublisher>(DOMAIN_EVENT_PUBLISHER)
        .publish(new MemberPasswordChangedProbeV1({ staffId: original.staffid, at: 'now' }));

      const refresh = await app.inject({
        method: 'POST',
        url: REFRESH,
        cookies: { [REFRESH_COOKIE]: before.refresh, [CSRF_COOKIE]: before.secret },
        headers: { [CSRF_HEADER]: before.csrf },
      });
      expect(refresh.statusCode).toBe(401);
      expect(problem(refresh).code).toBe('ERP-AUTH-0002');
      const me = await app.inject({
        method: 'GET',
        url: ME,
        headers: { authorization: `Bearer ${before.accessToken}` },
      });
      expect(me.statusCode).toBe(401);
      expect(problem(me).code).toBe('ERP-AUTH-0004');
      expect(await store.getSession(original.staffid, before.sid)).toBeNull();
    });

    /**
     * Review CR-02(a) of Phase 3.1, against the real Redis: an admin-flag or role change
     * (`identity.member.accessChanged`) ends the member's sessions and drops `auth:perm`, because
     * `admin` and the role are baked into both the access token and the snapshot.
     */
    it('publishing identity.member.accessChanged kills an access token and a refresh cookie issued before it and drops auth:perm (CR-02 a)', async () => {
      const before = await freshSession();
      const key = authKeys.perm(original.staffid);
      expect(await store.client.exists(key)).toBe(1);

      await moduleRef
        .get<DomainEventPublisher>(DOMAIN_EVENT_PUBLISHER)
        .publish(new MemberAccessChangedProbeV1({ staffId: original.staffid, at: 'now' }));

      const me = await app.inject({
        method: 'GET',
        url: ME,
        headers: { authorization: `Bearer ${before.accessToken}` },
      });
      expect(me.statusCode).toBe(401);
      expect(problem(me).code).toBe('ERP-AUTH-0004');
      const refresh = await app.inject({
        method: 'POST',
        url: REFRESH,
        cookies: { [REFRESH_COOKIE]: before.refresh, [CSRF_COOKIE]: before.secret },
        headers: { [CSRF_HEADER]: before.csrf },
      });
      expect(refresh.statusCode).toBe(401);
      expect(problem(refresh).code).toBe('ERP-AUTH-0002');
      expect(await store.client.exists(key)).toBe(0);
      expect(await store.getSession(original.staffid, before.sid)).toBeNull();
    });
  });
});

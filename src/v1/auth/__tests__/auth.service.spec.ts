/**
 * AuthService with the real rule layers (validator, enricher, transformer, hasher, issuer, lockout
 * policy), the real transport over a fake fetch and a real BreakerRegistry, the in-memory session
 * store and the fake repository. The clock is injectable, so lockout expiry is tested without
 * waiting; the RSA key is generated per run and never written anywhere.
 */
import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../../shared/config/app-config.js';
import { ModuleSwitch } from '../../../shared/config/modules.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { UpstreamUnavailableError } from '../../../shared/errors/upstream-unavailable.error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { IdentityFacade } from '../../identity/index.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { BreakerRegistry } from '../../../shared/resilience/breaker.js';
import type { StaffLoginFailedV1, StaffPasswordRehashedV1 } from '../events/published.js';
import { authKeys } from '../repository/auth-session.store.js';
import { InMemoryAuthSessionStore } from '../repository/in-memory-auth-session.store.js';
import type { AuthRepository } from '../repository/auth.repository.js';
import { AuthEnricher } from '../service/auth.enricher.js';
import { AuthService, type LoginResult } from '../service/auth.service.js';
import { AuthTransformer } from '../service/auth.transformer.js';
import { AuthTransport, LEGACY_SSO_ACTIVE_HEADER } from '../service/auth.transport.js';
import { AuthValidator } from '../service/auth.validator.js';
import { PasswordHasher } from '../service/password-hasher.js';
import { TokenIssuer } from '../service/token-issuer.js';
import {
  FakeAuthRepository,
  FakeIdentityFacade,
  SEED_EMAILS,
  SEED_PASSWORDS,
  SEED_STAFF_IDS,
} from './fakes.js';

const NOW = 1_700_000_000_000;
const IP = '10.0.0.7';
const USER_AGENT = 'vitest/1.0';
const CSRF = 'csrf-token-under-test';
const MIN_FIRST_LOCK_S = TIMINGS.auth.lockoutBaseMs / 1_000;

class QuietLogger extends LoggerService {
  readonly warnings: string[] = [];
  override warn(message: string): void {
    this.warnings.push(message);
  }
}

async function failure(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError');
  return error;
}

describe('AuthService', () => {
  let pemBase64: string;
  let issuer: TokenIssuer;
  let clock: number;
  let repo: FakeAuthRepository;
  let store: InMemoryAuthSessionStore;
  let publisher: RecordingDomainEventPublisher;
  let breakers: BreakerRegistry;
  let transport: AuthTransport;
  let logger: QuietLogger;
  let legacyCalls: number;
  let identity: FakeIdentityFacade;
  let service: AuthService;

  beforeAll(async () => {
    const { privateKey } = await generateKeyPair('RS256', {
      modulusLength: 2048,
      extractable: true,
    });
    pemBase64 = Buffer.from(await exportPKCS8(privateKey), 'utf8').toString('base64');
    issuer = await TokenIssuer.create({
      privateKeyPemBase64: pemBase64,
      issuer: 'erp-api',
      audience: 'erp-web',
      accessTtlMs: TIMINGS.auth.accessTokenTtlMs,
    });
  });

  beforeEach(async () => {
    clock = NOW;
    repo = new FakeAuthRepository();
    identity = new FakeIdentityFacade(repo);
    store = new InMemoryAuthSessionStore(() => clock);
    publisher = new RecordingDomainEventPublisher();
    logger = new QuietLogger();
    breakers = new BreakerRegistry(TIMINGS.breaker, logger);
    const config = { env: { LEGACY_BASE_URL: 'http://legacy.test' } } as unknown as AppConfig;
    transport = new AuthTransport(publisher, breakers, config, logger);
    legacyCalls = 0;
    transport.fetchImpl = () => {
      legacyCalls += 1;
      return Promise.resolve(
        new Response(null, { status: 405, headers: { [LEGACY_SSO_ACTIVE_HEADER]: 'active' } }),
      );
    };
    transport.retryDeps = { sleep: () => Promise.resolve(), random: () => 0 };
    service = new AuthService(
      new AuthValidator(),
      repo as unknown as AuthRepository,
      new AuthEnricher(logger),
      new AuthTransformer(),
      transport,
      new PasswordHasher(),
      issuer,
      store,
      logger,
      identity as unknown as IdentityFacade,
      new ModuleSwitch({ env: { MODULES_DISABLED: [] } } as unknown as AppConfig),
    );
    service.now = () => clock;
    await service.onModuleInit();
  });

  afterEach(() => {
    breakers.onModuleDestroy();
  });

  function login(email: string, password: string): Promise<LoginResult> {
    return service.login({ body: { email, password }, ip: IP, userAgent: USER_AGENT }, CSRF);
  }

  async function userOf(accessToken: string): Promise<AuthenticatedUser> {
    const user = await service.verifyAccessToken(accessToken);
    if (user === null) throw new Error('token did not verify');
    return user;
  }

  function eventNames(): string[] {
    return publisher.drain().map((e) => e.name);
  }

  it('describe() names the module and version', () => {
    expect(service.describe()).toEqual({ module: 'auth', version: 1 });
  });

  it('happy path: access token claims, re-hash to $2y$12$, touch, session keys, two events', async () => {
    const { response, refreshToken } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);

    expect(response.tokenType).toBe('Bearer');
    expect(response.expiresIn).toBe(TIMINGS.auth.accessTokenTtlMs / 1_000);
    expect(response.csrfToken).toBe(CSRF);
    expect(response.user).toEqual({
      staffId: SEED_STAFF_IDS.active,
      email: SEED_EMAILS.active,
      firstName: 'Seed',
      lastName: 'User',
      isAdmin: false,
      locale: null,
    });
    expect(JSON.stringify(response)).not.toMatch(/\$2y\$|refresh/);

    const claims = await issuer.verify(response.accessToken);
    expect(claims?.sub).toBe(String(SEED_STAFF_IDS.active));
    expect(claims?.ver).toBe(0);
    expect(claims?.admin).toBe(false);
    expect(claims?.roles).toEqual([2]);
    expect(typeof claims?.sid).toBe('string');
    expect(typeof claims?.jti).toBe('string');
    expect(
      refreshToken.startsWith(`${String(SEED_STAFF_IDS.active)}.${String(claims?.sid)}.`),
    ).toBe(true);

    const row = repo.rows.get(SEED_STAFF_IDS.active);
    expect(row?.passwordHash.startsWith(PasswordHasher.TARGET_PREFIX)).toBe(true);
    expect(repo.touches).toEqual([{ staffId: SEED_STAFF_IDS.active, ip: IP, at: new Date(NOW) }]);

    const keys = store.keys();
    expect(keys).toContain(authKeys.sess(SEED_STAFF_IDS.active, String(claims?.sid)));
    expect(keys).toContain(authKeys.sessions(SEED_STAFF_IDS.active));
    expect(keys).toContain(authKeys.perm(SEED_STAFF_IDS.active));
    expect(keys).not.toContain(authKeys.lockout(SEED_EMAILS.active));
    const session = await store.getSession(SEED_STAFF_IDS.active, String(claims?.sid));
    expect(session?.family).toBe(claims?.sid);
    expect(session?.device).toBe(USER_AGENT);
    expect(session?.ip).toBe(IP);
    expect(session?.refreshHash).toMatch(/^[0-9a-f]{64}$/);

    const events = publisher.drain();
    expect(events.map((e) => e.name)).toEqual(['auth.password.rehashed', 'auth.login.succeeded']);
    const rehashed = events[0] as StaffPasswordRehashedV1;
    expect(rehashed.payload).toEqual({
      staffId: SEED_STAFF_IDS.active,
      fromLabel: '$2y$10$',
      toLabel: '$2y$12$',
      at: new Date(NOW).toISOString(),
    });
    expect(JSON.stringify(events)).not.toMatch(/\$2y\$1[02]\$[./A-Za-z0-9]{53}/);
  });

  it('a second login does not re-hash again', async () => {
    await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    publisher.drain();
    await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    expect(eventNames()).toEqual(['auth.login.succeeded']);
  });

  it('a re-hash whose row moved underneath is logged, never thrown (count 0)', async () => {
    const row = repo.rows.get(SEED_STAFF_IDS.active);
    if (row === undefined) throw new Error('seed missing');
    repo.rehashPassword = () => Promise.resolve(0);
    await expect(login(SEED_EMAILS.active, SEED_PASSWORDS.active)).resolves.toBeDefined();
    expect(logger.warnings).toContain('rehash skipped: row changed underneath');
    expect(eventNames()).toEqual(['auth.login.succeeded']);
  });

  it('the e-mail is trimmed and lowercased before lookup and lockout', async () => {
    await expect(login('  Active@Example.TEST ', SEED_PASSWORDS.active)).resolves.toBeDefined();
  });

  it('malformed body → ERP-VALIDATION-0001', async () => {
    const error = await failure(
      service.login({ body: { email: 'nope', password: '' }, ip: IP, userAgent: '' }, CSRF),
    );
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(publisher.count).toBe(0);
  });

  it('unknown e-mail → ERP-AUTH-0001 and auth.login.failed with staffId null', async () => {
    const error = await failure(login('nobody@example.test', 'whatever'));
    expect(error.code).toBe('ERP-AUTH-0001');
    const [event] = publisher.drain() as StaffLoginFailedV1[];
    expect(event?.name).toBe('auth.login.failed');
    expect(event?.payload).toEqual({
      staffId: null,
      reason: 'invalid_credentials',
      at: new Date(NOW).toISOString(),
    });
    expect(await store.getLockout('nobody@example.test')).toEqual({
      failures: 1,
      lockedUntil: null,
    });
  });

  it('wrong password → ERP-AUTH-0001 with the staff id in the event, no session', async () => {
    const error = await failure(login(SEED_EMAILS.active, 'wrong'));
    expect(error.code).toBe('ERP-AUTH-0001');
    const [event] = publisher.drain() as StaffLoginFailedV1[];
    expect(event?.payload.staffId).toBe(SEED_STAFF_IDS.active);
    expect(event?.payload.reason).toBe('invalid_credentials');
    expect(store.keys()).toEqual([authKeys.lockout(SEED_EMAILS.active)]);
  });

  it('the 5th failure locks (0006 + retryAfterS), the correct password is refused while locked, and the lock expires', async () => {
    const { lockoutThreshold } = TIMINGS.auth;
    for (let i = 1; i < lockoutThreshold; i += 1) {
      expect((await failure(login(SEED_EMAILS.active, 'wrong'))).code).toBe('ERP-AUTH-0001');
    }
    const fifth = await failure(login(SEED_EMAILS.active, 'wrong'));
    expect(fifth.code).toBe('ERP-AUTH-0006');
    expect(fifth.extras?.retryAfterS).toBeGreaterThanOrEqual(MIN_FIRST_LOCK_S);

    publisher.drain();
    const sixth = await failure(login(SEED_EMAILS.active, SEED_PASSWORDS.active));
    expect(sixth.code).toBe('ERP-AUTH-0006');
    expect(sixth.extras?.retryAfterS).toBeGreaterThanOrEqual(1);
    const [locked] = publisher.drain() as StaffLoginFailedV1[];
    expect(locked?.payload.reason).toBe('locked');
    // A locked attempt is not a verify: the counter does not move.
    expect((await store.getLockout(SEED_EMAILS.active))?.failures).toBe(lockoutThreshold);

    clock = NOW + TIMINGS.auth.lockoutBaseMs + 1;
    await expect(login(SEED_EMAILS.active, SEED_PASSWORDS.active)).resolves.toBeDefined();
    expect(await store.getLockout(SEED_EMAILS.active)).toBeNull();
  });

  it('inactive account → generic 0001 (the repository answers active rows only, so staffId is null)', async () => {
    const error = await failure(login(SEED_EMAILS.inactive, SEED_PASSWORDS.inactive));
    expect(error.code).toBe('ERP-AUTH-0001');
    const [event] = publisher.drain() as StaffLoginFailedV1[];
    expect(event?.payload).toMatchObject({ staffId: null, reason: 'invalid_credentials' });
  });

  it('an inactive row a wider repository returns is still refused with 0001 and reason inactive', async () => {
    repo.findStaffByEmail = (email) =>
      Promise.resolve([...repo.rows.values()].find((r) => r.email === email) ?? null);
    const error = await failure(login(SEED_EMAILS.inactive, SEED_PASSWORDS.inactive));
    expect(error.code).toBe('ERP-AUTH-0001');
    const [event] = publisher.drain() as StaffLoginFailedV1[];
    expect(event?.payload).toMatchObject({ staffId: SEED_STAFF_IDS.inactive, reason: 'inactive' });
    expect(store.keys()).toEqual([]);
  });

  it('two-factor account → ERP-AUTH-0007 with reason two_factor, no lockout increment', async () => {
    const error = await failure(login(SEED_EMAILS.twoFactor, SEED_PASSWORDS.twoFactor));
    expect(error.code).toBe('ERP-AUTH-0007');
    const [event] = publisher.drain() as StaffLoginFailedV1[];
    expect(event?.payload).toMatchObject({
      staffId: SEED_STAFF_IDS.twoFactor,
      reason: 'two_factor',
    });
    expect(await store.getLockout(SEED_EMAILS.twoFactor)).toBeNull();
  });

  it('refresh rotates: new access token, new refresh token, same sid and family', async () => {
    const first = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    clock += 1_000;
    const second = await service.refresh(first.refreshToken, CSRF);
    expect(second.response.accessToken).not.toBe(first.response.accessToken);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    const firstSid = decodeJwt(first.response.accessToken).sid;
    expect(decodeJwt(second.response.accessToken).sid).toBe(firstSid);
    const session = await store.getSession(SEED_STAFF_IDS.active, String(firstSid));
    expect(session?.family).toBe(firstSid);
    expect(session?.lastSeenAt).toBe(new Date(clock).toISOString());
    expect(await service.verifyAccessToken(second.response.accessToken)).not.toBeNull();
  });

  it('refresh rebuilds the snapshot: two refreshes cause two repository reads (ADR-0033 d.6)', async () => {
    const first = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const reads = vi.spyOn(identity, 'permissionsOf');
    clock += 1_000;
    const second = await service.refresh(first.refreshToken, CSRF);
    expect(reads).toHaveBeenCalledTimes(1);
    clock += 1_000;
    await service.refresh(second.refreshToken, CSRF);
    expect(reads).toHaveBeenCalledTimes(2);
    reads.mockRestore();
  });

  it('me serves from the cached snapshot: no refresh, no repository read', async () => {
    const { response } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const reads = vi.spyOn(identity, 'permissionsOf');
    const user = await userOf(response.accessToken);
    await service.me(user);
    await service.me(user);
    expect(reads).not.toHaveBeenCalled();
    reads.mockRestore();
  });

  it('a permission revoked between two refreshes is gone from the second snapshot', async () => {
    const first = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    clock += 1_000;
    const second = await service.refresh(first.refreshToken, CSRF);
    expect((await store.getPermissions(SEED_STAFF_IDS.active))?.codes).toContain(
      'staff.members.view',
    );

    repo.permissions.set(SEED_STAFF_IDS.active, [{ feature: 'invoices', capability: 'view' }]);
    clock += 1_000;
    await service.refresh(second.refreshToken, CSRF);

    const after = await store.getPermissions(SEED_STAFF_IDS.active);
    expect(after?.codes).toEqual(['sales.invoices.view']);
    expect(after?.codes).not.toContain('staff.members.view');
    expect(await service.hasPermission(SEED_STAFF_IDS.active, 'staff.members.view')).toBe(false);
  });

  it('replaying a rotated refresh token → 0003, family revoked, version bumped, earlier access token dead', async () => {
    const first = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const firstSid = String(decodeJwt(first.response.accessToken).sid);
    await service.refresh(first.refreshToken, CSRF);

    const error = await failure(service.refresh(first.refreshToken, CSRF));
    expect(error.code).toBe('ERP-AUTH-0003');
    expect(await store.getSession(SEED_STAFF_IDS.active, firstSid)).toBeNull();
    expect(await store.listSessionIds(SEED_STAFF_IDS.active)).toEqual([]);
    expect(await store.getVersion(SEED_STAFF_IDS.active)).toBe(1);
    expect(await service.verifyAccessToken(first.response.accessToken)).toBeNull();
    expect(logger.warnings).toContain('refresh reuse detected');
  });

  it('refresh with a missing, garbage or unknown token → 0002', async () => {
    expect((await failure(service.refresh(undefined, CSRF))).code).toBe('ERP-AUTH-0002');
    expect((await failure(service.refresh('garbage', CSRF))).code).toBe('ERP-AUTH-0002');
    expect((await failure(service.refresh('10.no-such-sid.secret', CSRF))).code).toBe(
      'ERP-AUTH-0002',
    );
    expect((await failure(service.refresh('x.y.z', CSRF))).code).toBe('ERP-AUTH-0002');
  });

  it('refresh for a staff member who became inactive → 0002 and the session is deleted', async () => {
    const first = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const sid = String(decodeJwt(first.response.accessToken).sid);
    const row = repo.rows.get(SEED_STAFF_IDS.active);
    if (row === undefined) throw new Error('seed missing');
    repo.rows.set(SEED_STAFF_IDS.active, { ...row, active: false });
    expect((await failure(service.refresh(first.refreshToken, CSRF))).code).toBe('ERP-AUTH-0002');
    expect(await store.getSession(SEED_STAFF_IDS.active, sid)).toBeNull();
  });

  it('logout revokes the jti and deletes the session; the refresh token no longer works', async () => {
    const { response, refreshToken } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const user = await userOf(response.accessToken);
    await service.logout(user);
    expect(await service.verifyAccessToken(response.accessToken)).toBeNull();
    expect(await store.isRevoked(user.jti)).toBe(true);
    expect(await store.getSession(user.staffId, user.sessionId)).toBeNull();
    expect((await failure(service.refresh(refreshToken, CSRF))).code).toBe('ERP-AUTH-0002');
  });

  it("logoutAll deletes every session and bumps the version so another device's token dies too", async () => {
    const a = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const b = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    expect(await store.listSessionIds(SEED_STAFF_IDS.active)).toHaveLength(2);
    await service.logoutAll(await userOf(a.response.accessToken));
    expect(await store.listSessionIds(SEED_STAFF_IDS.active)).toEqual([]);
    expect(await store.getVersion(SEED_STAFF_IDS.active)).toBe(1);
    expect(await service.verifyAccessToken(b.response.accessToken)).toBeNull();
  });

  it('verifyAccessToken → AuthenticatedUser, and null for garbage or a token of another key', async () => {
    const { response } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const user = await userOf(response.accessToken);
    expect(user).toMatchObject({
      staffId: SEED_STAFF_IDS.active,
      isAdmin: false,
      roleId: 2,
      tokenVersion: 0,
    });
    expect(user.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1_000));
    expect(await service.verifyAccessToken('not.a.jwt')).toBeNull();
    const other = await TokenIssuer.create({
      privateKeyPemBase64: Buffer.from(
        await exportPKCS8(
          (await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })).privateKey,
        ),
      ).toString('base64'),
      issuer: 'erp-api',
      audience: 'erp-web',
      accessTtlMs: 60_000,
    });
    const { token } = await other.sign({
      sub: '10',
      sid: 's',
      jti: 'j',
      ver: 0,
      admin: false,
      roles: [],
    });
    expect(await service.verifyAccessToken(token)).toBeNull();
  });

  it('the version cache serves a bump from another process only after versionCacheMs', async () => {
    const { response } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    await store.bumpVersion(SEED_STAFF_IDS.active); // not through the service: cache still warm
    expect(await service.verifyAccessToken(response.accessToken)).not.toBeNull();
    clock += TIMINGS.auth.versionCacheMs;
    expect(await service.verifyAccessToken(response.accessToken)).toBeNull();
  });

  it('hasPermission reads the snapshot in clean names; admin bypasses; unknown staff is false', async () => {
    await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    expect(await service.hasPermission(SEED_STAFF_IDS.active, 'sales.invoices.view')).toBe(true);
    expect(await service.hasPermission(SEED_STAFF_IDS.active, 'staff.members.view')).toBe(true);
    // The Perfex code is gone: the snapshot carries clean names only (ADR-0033 d.2).
    expect(await service.hasPermission(SEED_STAFF_IDS.active, 'invoices.view')).toBe(false);
    // The unmapped swapped-order row was dropped, never passed through (T-3.1-20).
    expect(await service.hasPermission(SEED_STAFF_IDS.active, 'edit.tasks')).toBe(false);
    expect(await service.hasPermission(SEED_STAFF_IDS.active, 'sales.invoices.delete')).toBe(false);
    // Admin without a login: the snapshot is rebuilt from the rows on demand.
    expect(await service.hasPermission(SEED_STAFF_IDS.admin, 'anything.at.all')).toBe(true);
    expect(await service.hasPermission(999_999, 'invoices.view')).toBe(false);
  });

  it('me returns the sorted clean permissions and never a hash', async () => {
    const { response } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const me = await service.me(await userOf(response.accessToken));
    expect(me).toEqual({
      staffId: SEED_STAFF_IDS.active,
      email: SEED_EMAILS.active,
      firstName: 'Seed',
      lastName: 'User',
      isAdmin: false,
      roleId: 2,
      permissions: ['sales.invoices.view', 'staff.members.view', 'staff.roles.view'],
      locale: null,
      disabledModules: [],
    });
    expect(JSON.stringify(me)).not.toMatch(/\$2y\$/);
  });

  it('me for a staff row that vanished → 0004', async () => {
    const { response } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const user = await userOf(response.accessToken);
    repo.rows.delete(SEED_STAFF_IDS.active);
    expect((await failure(service.me(user))).code).toBe('ERP-AUTH-0004');
  });

  it('legacySso → { status: "ready" } and nothing else when legacy answers 405 + X-Erp-Sso: active', async () => {
    await expect(service.legacySso()).resolves.toEqual({ status: 'ready' });
    expect(legacyCalls).toBe(1);
  });

  it("legacySso rethrows the transport's UpstreamUnavailableError unchanged when the legacy breaker is open", async () => {
    breakers.get('legacy').forceOpen();
    const error = await service.legacySso().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(UpstreamUnavailableError);
    expect((error as UpstreamUnavailableError).code).toBe('ERP-UPSTREAM-0001');
    expect(legacyCalls).toBe(0);
  });

  /**
   * ADR-0034 decision 1: `v1/identity` owns `tblstaff_permissions`, so the snapshot is built from the
   * rows the facade hands over — `AuthRepository.listPermissions` no longer exists.
   */
  it('builds the permission snapshot from the identity facade, not from its own repository', async () => {
    const reads = vi.spyOn(identity, 'permissionsOf');
    const { response } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    expect(reads).toHaveBeenCalledWith(SEED_STAFF_IDS.active);
    expect((await store.getPermissions(SEED_STAFF_IDS.active))?.codes).toContain(
      'staff.members.view',
    );
    // The rows crossed the boundary in Perfex's format and the enricher translated them.
    expect(reads.mock.results[0]?.type).toBe('return');
    expect(JSON.stringify(response)).not.toContain('staff.view');
    reads.mockRestore();
  });

  /**
   * The two halves of what `events/handlers/identity-access.handler.ts` calls (brief §7). The handler's
   * own wiring is `identity-access.handler.spec.ts`; these are the effects on the session state.
   */
  it('endSessionsOf bumps the token version, so every token issued before it is refused', async () => {
    const { response } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    expect(await service.verifyAccessToken(response.accessToken)).not.toBeNull();
    const before = await store.getVersion(SEED_STAFF_IDS.active);
    await service.endSessionsOf(SEED_STAFF_IDS.active);
    expect(await store.getVersion(SEED_STAFF_IDS.active)).toBe(before + 1);
    expect(await service.verifyAccessToken(response.accessToken)).toBeNull();
  });

  // CR-01 of the 03.1 review: the version bump kills access tokens, but `refresh` never compares a
  // version — only deleting the session kills the refresh cookie.
  it('endSessionsOf deletes every session, so a refresh token issued before it is refused ERP-AUTH-0002 (CR-01)', async () => {
    const first = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    expect(await store.listSessionIds(SEED_STAFF_IDS.active)).not.toEqual([]);
    await service.endSessionsOf(SEED_STAFF_IDS.active);
    clock += 1_000;
    expect((await failure(service.refresh(first.refreshToken, CSRF))).code).toBe('ERP-AUTH-0002');
    expect(await store.listSessionIds(SEED_STAFF_IDS.active)).toEqual([]);
  });

  it('dropPermissionSnapshot drops auth:perm and leaves the token version and the session alone', async () => {
    const { response } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    expect(await store.getPermissions(SEED_STAFF_IDS.active)).not.toBeNull();
    const version = await store.getVersion(SEED_STAFF_IDS.active);

    await service.dropPermissionSnapshot(SEED_STAFF_IDS.active);

    expect(await store.getPermissions(SEED_STAFF_IDS.active)).toBeNull();
    expect(await store.getVersion(SEED_STAFF_IDS.active)).toBe(version);
    // The member is still signed in — what they may do changed, not who they are.
    expect(await service.verifyAccessToken(response.accessToken)).not.toBeNull();
  });

  it('after dropPermissionSnapshot the next read rebuilds the snapshot from the facade', async () => {
    const { response } = await login(SEED_EMAILS.active, SEED_PASSWORDS.active);
    const user = await userOf(response.accessToken);
    await service.dropPermissionSnapshot(SEED_STAFF_IDS.active);
    repo.permissions.set(SEED_STAFF_IDS.active, [{ feature: 'invoices', capability: 'view' }]);
    const reads = vi.spyOn(identity, 'permissionsOf');

    expect((await service.me(user)).permissions).toEqual(['sales.invoices.view']);

    expect(reads).toHaveBeenCalledTimes(1);
    expect(await service.hasPermission(SEED_STAFF_IDS.active, 'staff.members.view')).toBe(false);
    reads.mockRestore();
  });
});

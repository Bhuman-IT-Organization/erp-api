/**
 * Use-case orchestrator of the auth module: login, refresh with rotation and reuse detection, logout and logout-all, `me`, the
 * verifier functions the guards call through the facade, and the legacy `erp_sso` readiness read
 * through the transport. Every step is a call into a rule layer (validator, hasher, issuer,
 * enricher, transformer), the repository or the session store; nothing here touches Prisma,
 * Redis, `fetch` or a breaker directly.
 *
 * Failures are `AppError`s the shared filter maps to problem details; the controller never
 * catches. No hash, refresh token or password reaches a log line or an event payload.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { ModuleSwitch } from '../../../shared/config/modules.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  legacySsoResponseSchema,
  type LegacySsoResponseDto,
  type LoginResponseDto,
  type MeResponseDto,
} from '../dto/auth.dto.js';
import {
  StaffLoginFailedV1,
  StaffLoginSucceededV1,
  StaffPasswordRehashedV1,
  type LoginFailureReason,
} from '../events/published.js';
import { IdentityFacade } from '../../identity/index.js';
import type {
  IssuedTokens,
  Lockout,
  PermissionSnapshot,
  Session,
  StaffIdentity,
} from '../model/auth.model.js';
import { AUTH_SESSION_STORE, type AuthSessionStore } from '../repository/auth-session.store.js';
import { AuthRepository } from '../repository/auth.repository.js';
import { AuthEnricher } from './auth.enricher.js';
import { AuthTransformer } from './auth.transformer.js';
import { AuthTransport } from './auth.transport.js';
import { AuthValidator } from './auth.validator.js';
import { isLocked, nextLockout, retryAfterS } from './lockout-policy.js';
import { PasswordHasher } from './password-hasher.js';
import { TokenIssuer } from './token-issuer.js';

export interface LoginInput {
  readonly body: unknown;
  readonly ip: string;
  readonly userAgent: string;
}

export interface LoginResult {
  readonly response: LoginResponseDto;
  /** `${staffId}.${sid}.${secret}` — the controller sets it as the `erp_refresh` cookie; never in a body or log. */
  readonly refreshToken: string;
}

export interface AuthDescription {
  readonly module: 'auth';
  readonly version: 1;
}

const MS_PER_SECOND = 1_000;
const REFRESH_SECRET_BYTES = 32;
const DUMMY_SECRET_BYTES = 16;
const DEVICE_MAX_LENGTH = 200;
const BCRYPT_LABEL_LENGTH = 7;
const REFRESH_TOKEN_PARTS = 3;

let dummyHashPromise: Promise<string> | null = null;

interface VersionCacheEntry {
  readonly value: number;
  readonly until: number;
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Constant-time equality of two hex digests; unequal lengths are a mismatch, never a throw. */
function hashesMatch(presentedHex: string, storedHex: string): boolean {
  const presented = Buffer.from(presentedHex, 'hex');
  const stored = Buffer.from(storedHex, 'hex');
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

interface ParsedRefreshToken {
  readonly staffId: number;
  readonly sid: string;
  readonly secret: string;
}

function parseRefreshToken(token: string | undefined): ParsedRefreshToken | null {
  if (token === undefined) return null;
  const parts = token.split('.');
  if (parts.length !== REFRESH_TOKEN_PARTS) return null;
  const [staffIdText, sid, secret] = parts;
  if (staffIdText === undefined || sid === undefined || secret === undefined) return null;
  if (!/^\d+$/.test(staffIdText) || sid === '' || secret === '') return null;
  return { staffId: Number.parseInt(staffIdText, 10), sid, secret };
}

@Injectable()
export class AuthService implements OnModuleInit {
  /** Constructor-assigned (not DI) so a spec can advance the clock; the issuer keeps its own clock for `iat`/`exp`. */
  now: () => number = Date.now;

  private dummyHash: string | null = null;
  /** The L1 cache tier; `@Cacheable` and the key builder arrive with the first module that needs a cache tier; `bumpVersion` in this process also drops the entry. */
  private readonly versionCache = new Map<number, VersionCacheEntry>();

  constructor(
    private readonly validator: AuthValidator,
    private readonly repository: AuthRepository,
    private readonly enricher: AuthEnricher,
    private readonly transformer: AuthTransformer,
    private readonly transport: AuthTransport,
    private readonly hasher: PasswordHasher,
    private readonly issuer: TokenIssuer,
    @Inject(AUTH_SESSION_STORE) private readonly store: AuthSessionStore,
    private readonly logger: LoggerService,
    private readonly identity: IdentityFacade,
    private readonly modules: ModuleSwitch,
  ) {}

  /** Pre-computes the `$2y$12$` hash of a random secret used to equalise timing for unknown e-mails (T-1.3-50). */
  async onModuleInit(): Promise<void> {
    await this.ensureDummyHash();
  }

  describe(): AuthDescription {
    return { module: 'auth', version: 1 };
  }

  /**
   * Never wrap this sequence in a retry (`shared/resilience/retry.ts`, ADR-0031 §2): a retried
   * verify double-counts auth:lockout; the only resilient call of this module is
   * transport.probeLegacySso().
   *
   * Sequence (diagram 1): parse → lockout check → find ACTIVE staff → verify (dummy hash when
   * unknown) → refusal check → re-hash once → touch last_login/last_ip → permission snapshot →
   * session → access token → clear lockout → `auth.login.succeeded`.
   */
  async login(input: LoginInput, csrfToken: string): Promise<LoginResult> {
    const { email, password } = this.validator.parseLoginRequest(input.body);
    const now = this.now();
    const at = new Date(now);

    const lockout = await this.store.getLockout(email);
    if (lockout !== null && isLocked(lockout, now)) {
      await this.publishFailed(null, 'locked', at);
      throw new AppError('ERP-AUTH-0006', undefined, { retryAfterS: retryAfterS(lockout, now) });
    }

    const staff = await this.repository.findStaffByEmail(email);
    if (staff === null) {
      // Same bcrypt cost as a real row so an unknown e-mail is not distinguishable by timing.
      await this.hasher.verify(password, await this.ensureDummyHash());
      throw await this.recordFailure(email, null, lockout, now);
    }

    const verified = await this.hasher.verify(password, staff.passwordHash);
    if (!verified) throw await this.recordFailure(email, staff.staffId, lockout, now);

    // The repository answers active rows only (plan 07), so `inactive` is unreachable here today;
    // the check stays so a repository that widens the lookup cannot let a refused account through.
    const refusal = this.validator.refusalReason(staff);
    if (refusal !== null) {
      await this.publishFailed(staff.staffId, refusal, at);
      this.validator.assertCanLogin(staff);
    }

    await this.rehashIfNeeded(staff, password, at);
    await this.repository.touchLogin(staff.staffId, input.ip, at);
    await this.rebuildPermissions(staff, at);

    const sid = randomUUID();
    const secret = randomBytes(REFRESH_SECRET_BYTES).toString('base64url');
    const session: Session = {
      sid,
      family: sid,
      refreshHash: sha256Hex(secret),
      device: input.userAgent.slice(0, DEVICE_MAX_LENGTH),
      ip: input.ip,
      createdAt: at.toISOString(),
      lastSeenAt: at.toISOString(),
      expiresAt: new Date(now + TIMINGS.auth.refreshTokenTtlMs).toISOString(),
    };
    await this.store.createSession(staff.staffId, session, TIMINGS.auth.refreshTokenTtlMs);
    const tokens = await this.issueTokens(staff, sid, secret);
    await this.store.clearLockout(email);
    await this.transport.publish(
      new StaffLoginSucceededV1({ staffId: staff.staffId, sessionId: sid, at: at.toISOString() }),
    );
    return {
      response: this.transformer.toLoginResponse(tokens, staff, csrfToken),
      refreshToken: tokens.refreshToken,
    };
  }

  /**
   * Diagram 2: rotation keeps `sid` and `family`, replaces the stored hash, slides the TTL. A
   * presented token whose session exists but whose hash no longer matches is a replay of a
   * rotated token: the whole family is revoked and the version bumped (ERP-AUTH-0003).
   *
   * The permission snapshot is **rebuilt** here, never reused (ADR-0033 decision 6): a refresh
   * re-reads `tblstaff_permissions`, so a permission revoked in Perfex stops working in Node
   * within one access-token lifetime (`TIMINGS.auth.accessTokenTtlMs`, 15 minutes) instead of
   * surviving in a snapshot cached for the refresh TTL.
   */
  async refresh(refreshToken: string | undefined, csrfToken: string): Promise<LoginResult> {
    const parsed = parseRefreshToken(refreshToken);
    if (parsed === null) throw new AppError('ERP-AUTH-0002');
    const { staffId, sid, secret } = parsed;

    const session = await this.store.getSession(staffId, sid);
    if (session === null) throw new AppError('ERP-AUTH-0002');

    if (!hashesMatch(sha256Hex(secret), session.refreshHash)) {
      await this.store.revokeFamily(staffId, session.family);
      await this.bumpVersion(staffId);
      this.logger.warn('refresh reuse detected', { staffId, sid });
      throw new AppError('ERP-AUTH-0003');
    }

    const staff = await this.repository.findStaffById(staffId);
    if (staff?.active !== true) {
      await this.store.deleteSession(staffId, sid);
      throw new AppError('ERP-AUTH-0002');
    }

    const now = this.now();
    const nextSecret = randomBytes(REFRESH_SECRET_BYTES).toString('base64url');
    await this.store.rotateSession(
      staffId,
      sid,
      {
        refreshHash: sha256Hex(nextSecret),
        lastSeenAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TIMINGS.auth.refreshTokenTtlMs).toISOString(),
      },
      TIMINGS.auth.refreshTokenTtlMs,
    );
    await this.rebuildPermissions(staff, new Date(now));
    const tokens = await this.issueTokens(staff, sid, nextSecret);
    return {
      response: this.transformer.toLoginResponse(tokens, staff, csrfToken),
      refreshToken: tokens.refreshToken,
    };
  }

  /** Diagram 3: the session goes, the presented access token is revoked for its remaining life. */
  async logout(user: AuthenticatedUser): Promise<void> {
    await this.store.deleteSession(user.staffId, user.sessionId);
    await this.revokeAccessToken(user);
  }

  /** Every session of the staff member, plus a version bump so every outstanding access token dies. */
  async logoutAll(user: AuthenticatedUser): Promise<void> {
    await this.store.deleteAllSessions(user.staffId);
    await this.bumpVersion(user.staffId);
    await this.revokeAccessToken(user);
  }

  async me(user: AuthenticatedUser): Promise<MeResponseDto> {
    const staff = await this.repository.findStaffById(user.staffId);
    if (staff === null) throw new AppError('ERP-AUTH-0004');
    return this.transformer.toMeResponse(
      staff,
      await this.snapshotFor(staff),
      this.modules.disabled(),
    );
  }

  /**
   * Diagram 4 (the guard's path): signature and claims by `kid`, then the revoked-`jti` key, then
   * the token version through a 5 s L1 cache. `null` on any failure; the guard maps it to 0004.
   */
  async verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    const claims = await this.issuer.verify(token);
    if (claims === null) return null;
    if (await this.store.isRevoked(claims.jti)) return null;
    const staffId = Number.parseInt(claims.sub, 10);
    if (Number.isNaN(staffId)) return null;
    if (claims.ver !== (await this.currentVersion(staffId))) return null;
    return {
      staffId,
      sessionId: claims.sid,
      jti: claims.jti,
      isAdmin: claims.admin,
      roleId: claims.roles[0] ?? null,
      tokenVersion: claims.ver,
      expiresAt: claims.exp,
    };
  }

  /** From the `auth:perm:{staffId}` snapshot (rebuilt from the rows when it expired); admin implies true. */
  async hasPermission(staffId: number, code: string): Promise<boolean> {
    let snapshot = await this.store.getPermissions(staffId);
    if (snapshot === null) {
      const staff = await this.repository.findStaffById(staffId);
      if (staff === null) return false;
      snapshot = await this.rebuildPermissions(staff, new Date(this.now()));
    }
    return snapshot.isAdmin || snapshot.codes.includes(code);
  }

  /**
   * Readiness of the legacy `erp_sso` module through the transport's `legacy` breaker. No catch:
   * `UpstreamUnavailableError` (breaker open) reaches the filter as 503 + `Retry-After`. Only
   * `status` crosses the wire — the schema strips the transport's diagnostic `detail`, which the
   * transport already logs.
   */
  async legacySso(): Promise<LegacySsoResponseDto> {
    return legacySsoResponseSchema.parse(await this.transport.probeLegacySso());
  }

  // --- internals --------------------------------------------------------------------------------

  private async ensureDummyHash(): Promise<string> {
    if (this.dummyHash !== null) return this.dummyHash;
    dummyHashPromise ??= this.hasher.hash(randomBytes(DUMMY_SECRET_BYTES).toString('hex'));
    this.dummyHash = await dummyHashPromise;
    return this.dummyHash;
  }

  /** Counts the failure, publishes `auth.login.failed`, and returns the error to throw (0001, or 0006 once locked). */
  private async recordFailure(
    email: string,
    staffId: number | null,
    previous: Lockout | null,
    now: number,
  ): Promise<AppError> {
    const next = nextLockout(previous, now);
    await this.store.setLockout(email, next, TIMINGS.auth.lockoutWindowMs);
    await this.publishFailed(staffId, 'invalid_credentials', new Date(now));
    if (isLocked(next, now)) {
      return new AppError('ERP-AUTH-0006', undefined, { retryAfterS: retryAfterS(next, now) });
    }
    return new AppError('ERP-AUTH-0001');
  }

  private publishFailed(
    staffId: number | null,
    reason: LoginFailureReason,
    at: Date,
  ): Promise<void> {
    return this.transport.publish(
      new StaffLoginFailedV1({ staffId, reason, at: at.toISOString() }),
    );
  }

  /** Re-hashes a non-`$2y$12$` row once; a `0` count means the row moved underneath (Perfex/LDAP) — logged, never thrown. */
  private async rehashIfNeeded(staff: StaffIdentity, password: string, at: Date): Promise<void> {
    if (!this.hasher.needsRehash(staff.passwordHash)) return;
    const changed = await this.repository.rehashPassword(
      staff.staffId,
      staff.passwordHash,
      await this.hasher.hash(password),
    );
    if (changed === 1) {
      await this.transport.publish(
        new StaffPasswordRehashedV1({
          staffId: staff.staffId,
          fromLabel: staff.passwordHash.slice(0, BCRYPT_LABEL_LENGTH),
          toLabel: PasswordHasher.TARGET_PREFIX,
          at: at.toISOString(),
        }),
      );
      return;
    }
    this.logger.warn('rehash skipped: row changed underneath', { staffId: staff.staffId });
  }

  /**
   * The member's permission snapshot, rebuilt from the rows `v1/identity` owns. ADR-0034 decision 1
   * makes `v1/identity` the only module that may name `tblstaff_permissions`, so this reads the rows
   * through `identity.facade.permissionsOf` — the one synchronous cross-module call brief §7
   * justifies, because a login must answer with the member's current permissions in the same
   * request. The rows arrive in Perfex's own `feature`/`capability` format and `AuthEnricher` is
   * still the single translation point into clean ADR-0033 names (ADR-0033 decision 2).
   */
  private async rebuildPermissions(staff: StaffIdentity, at: Date): Promise<PermissionSnapshot> {
    const rows = await this.identity.permissionsOf(staff.staffId);
    const snapshot = this.enricher.buildPermissionSnapshot(staff, rows, at);
    await this.store.setPermissions(staff.staffId, snapshot, TIMINGS.auth.refreshTokenTtlMs);
    return snapshot;
  }

  private async snapshotFor(staff: StaffIdentity): Promise<PermissionSnapshot> {
    return (
      (await this.store.getPermissions(staff.staffId)) ??
      this.rebuildPermissions(staff, new Date(this.now()))
    );
  }

  private async issueTokens(
    staff: StaffIdentity,
    sid: string,
    secret: string,
  ): Promise<IssuedTokens> {
    const ver = await this.currentVersion(staff.staffId);
    const jti = randomUUID();
    const { token } = await this.issuer.sign({
      sub: String(staff.staffId),
      sid,
      jti,
      ver,
      admin: staff.isAdmin,
      roles: staff.roleId === null ? [] : [staff.roleId],
    });
    return {
      accessToken: token,
      expiresIn: Math.floor(TIMINGS.auth.accessTokenTtlMs / MS_PER_SECOND),
      refreshToken: `${String(staff.staffId)}.${sid}.${secret}`,
      jti,
      sid,
    };
  }

  private async revokeAccessToken(user: AuthenticatedUser): Promise<void> {
    const remainingMs = user.expiresAt * MS_PER_SECOND - this.now();
    if (remainingMs > 0) await this.store.revokeJti(user.jti, remainingMs);
  }

  private async currentVersion(staffId: number): Promise<number> {
    const now = this.now();
    const cached = this.versionCache.get(staffId);
    if (cached !== undefined && cached.until > now) return cached.value;
    const value = await this.store.getVersion(staffId);
    this.versionCache.set(staffId, { value, until: now + TIMINGS.auth.versionCacheMs });
    return value;
  }

  /**
   * `identity.member.passwordChanged`, `identity.member.deactivated` and
   * `identity.member.accessChanged`, through `events/handlers/identity-access.handler.ts`: the
   * member's existing sessions end at once, in the `logoutAll`
   * order. Every `auth:sess:*` of the member is **deleted**, so a refresh cookie issued before this
   * moment answers `ERP-AUTH-0002` — `refresh` never compares a token version, so the bump alone left
   * a stolen cookie alive for its whole sliding TTL (review CR-01 of Phase 3.1). Then the token
   * version is **bumped**, so every access token issued before it fails verification. The same
   * private `bumpVersion` the password-change and logout-all paths use.
   */
  async endSessionsOf(staffId: number): Promise<void> {
    await this.store.deleteAllSessions(staffId);
    await this.bumpVersion(staffId);
  }

  /**
   * `identity.permissions.replaced`, through the same handler: the ADR-0033 snapshot is a copy of
   * rows `v1/identity` owns, so a replacement drops `auth:perm:{staffId}` and the next request
   * rebuilds it. The token stays valid — the member's *identity* did not change, only what they may
   * do (ADR-0033 decision 6; the refresh rebuild is the backstop if this never arrives).
   */
  async dropPermissionSnapshot(staffId: number): Promise<void> {
    await this.store.deletePermissions(staffId);
  }

  private async bumpVersion(staffId: number): Promise<void> {
    await this.store.bumpVersion(staffId);
    this.versionCache.delete(staffId);
  }
}

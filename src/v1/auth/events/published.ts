/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes, ids not entities,
 * versioned. Published through the `DOMAIN_EVENT_PUBLISHER` port; delivered in-process today and
 * through the transactional outbox once the first
 * cross-module subscriber or job exists.
 *
 * Payloads never carry the e-mail, the password, a hash or a token (T-1.3-31):
 * `StaffPasswordRehashedV1` carries the 7-character bcrypt labels (`$2y$10$`), not hashes.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface StaffLoginSucceededPayload {
  readonly staffId: number;
  readonly sessionId: string;
  /** ISO timestamp. */
  readonly at: string;
}

export class StaffLoginSucceededV1 extends DomainEvent<
  'auth.login.succeeded',
  StaffLoginSucceededPayload
> {
  static readonly NAME = 'auth.login.succeeded' as const;
  readonly name = StaffLoginSucceededV1.NAME;
}

export type LoginFailureReason = 'invalid_credentials' | 'inactive' | 'two_factor' | 'locked';

export interface StaffLoginFailedPayload {
  /** `null` when the e-mail matched no staff row (the caller still receives the generic 401). */
  readonly staffId: number | null;
  readonly reason: LoginFailureReason;
  readonly at: string;
}

export class StaffLoginFailedV1 extends DomainEvent<'auth.login.failed', StaffLoginFailedPayload> {
  static readonly NAME = 'auth.login.failed' as const;
  readonly name = StaffLoginFailedV1.NAME;
}

export interface StaffPasswordRehashedPayload {
  readonly staffId: number;
  /** The stored hash's label, e.g. `$2a$08$` or `$2y$10$` — never the hash. */
  readonly fromLabel: string;
  readonly toLabel: '$2y$12$';
  readonly at: string;
}

export class StaffPasswordRehashedV1 extends DomainEvent<
  'auth.password.rehashed',
  StaffPasswordRehashedPayload
> {
  static readonly NAME = 'auth.password.rehashed' as const;
  readonly name = StaffPasswordRehashedV1.NAME;
}

export const AUTH_PUBLISHED_EVENTS = [
  StaffLoginSucceededV1.NAME,
  StaffLoginFailedV1.NAME,
  StaffPasswordRehashedV1.NAME,
] as const;

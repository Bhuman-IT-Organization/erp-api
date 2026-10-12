/**
 * The mail module's Redis state behind a port (BE-17 "Instead", ADR-0049 decision 8): the time the
 * worker found the SMTP server unreachable (the api's status page reads it, because the api's own
 * `email` breaker never fires, RESEARCH C3) and the per-member test-send counter (D-10).
 * `RedisMailStateStore` is the runtime adapter; `__tests__/fakes.ts` holds `InMemoryMailStateStore`,
 * and both pass `mailStateStoreContract`.
 */

export const MAIL_STATE_STORE = Symbol('MAIL_STATE_STORE');

/** The only place these key strings are spelled; Redis db 0 (a status flag and a counter are not sessions, BE-12). */
export const mailKeys = Object.freeze({
  serverUnreachableSince: (): string => 'mail:server:unreachableSince',
  testCount: (staffId: number): string => `mail:test:${String(staffId)}`,
});

export interface MailStateStore {
  /** `SET key <ISO> NX PX TIMINGS.mail.serverStateTtlMs`: the first time wins until cleared. */
  markServerUnreachable(at: Date): Promise<void>;
  /** `DEL`: a send succeeded. */
  clearServerUnreachable(): Promise<void>;
  serverUnreachableSince(): Promise<Date | null>;
  /** `INCR`; the first count opens a `TIMINGS.mail.testWindowMs` window; `retryAfterMs` is its remainder (>= 0). */
  countTest(staffId: number): Promise<{ readonly count: number; readonly retryAfterMs: number }>;
}

/**
 * The timeout helper (ADR-0031 §1): every outbound `fetch` carries `timeoutSignal(TIMINGS.…)`.
 * The timeout is ours — the breaker runs with `timeout: false` and no HTTP client library adds
 * a second one (§6), so one call has exactly one deadline.
 */

/** `AbortSignal.timeout(ms)`, combined with `parent` via `AbortSignal.any` when given. */
export function timeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return parent === undefined ? timeout : AbortSignal.any([parent, timeout]);
}

/** True for the `TimeoutError` fetch throws on `AbortSignal.timeout`, and for a plain `AbortError`. */
export function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

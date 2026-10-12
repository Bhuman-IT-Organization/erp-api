/**
 * ADR-0031 §3. One breaker per EXTERNAL SYSTEM, not per call. Only a module's `transport` layer
 * may call `registry.get(name).execute(...)`; services and repositories never do.
 *
 * opossum supplies the state machine only: `timeout: false` (the timeout is `timeoutSignal`, §1),
 * no fall-back function, no library retry (retry is `withRetry`, §2). `errorFilter` keeps a 4xx or an
 * `AppError` from counting: only transient errors (network, timeout, 5xx) trip the circuit. Open
 * circuit → `UpstreamUnavailableError` (503 + Retry-After, §7); opossum's own error never escapes.
 * In-memory per replica — replicas trip independently.
 */
import type { OnModuleDestroy } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { UpstreamUnavailableError } from '../errors/upstream-unavailable.error.js';
import type { LoggerService } from '../logger/logger.service.js';
import { isTransientError } from './transient-error.js';

export const BREAKER_NAMES = ['legacy', 'sap', 'email', 'sms', 'payment'] as const;
export type BreakerName = (typeof BREAKER_NAMES)[number];
export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  /** Calls in the rolling window before the failure ratio is judged (opossum `volumeThreshold`). */
  readonly volumeThreshold: number;
  /** Failure percentage that opens the circuit (opossum `errorThresholdPercentage`). */
  readonly errorThresholdPercentage: number;
  /** The rolling window (opossum `rollingCountTimeout`). */
  readonly rollingWindowMs: number;
  /** Time open before one trial call is allowed (opossum `resetTimeout`). */
  readonly halfOpenAfterMs: number;
}

const MS_PER_SECOND = 1_000;
const OPEN_CODE = 'EOPENBREAKER';

type Action = (
  fn: (signal: AbortSignal | undefined) => Promise<unknown>,
  signal: AbortSignal | undefined,
) => Promise<unknown>;

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export class Breaker {
  private readonly circuit: CircuitBreaker<Parameters<Action>>;
  private readonly retryAfterS: number;

  constructor(
    readonly name: BreakerName,
    options: BreakerOptions,
    logger: LoggerService,
  ) {
    this.retryAfterS = Math.ceil(options.halfOpenAfterMs / MS_PER_SECOND);
    const action: Action = (fn, signal) => fn(signal);
    this.circuit = new CircuitBreaker(action, {
      name,
      timeout: false, // the deadline is timeoutSignal's; opossum's 10 s default would stack on it
      errorFilter: (error: unknown) => !isTransientError(error), // true = rethrow, do not count
      volumeThreshold: options.volumeThreshold,
      errorThresholdPercentage: options.errorThresholdPercentage,
      rollingCountTimeout: options.rollingWindowMs,
      resetTimeout: options.halfOpenAfterMs,
    });
    const transition = (to: BreakerState) => () => {
      logger.warn('breaker state', { name, to });
    };
    this.circuit.on('open', transition('open'));
    this.circuit.on('halfOpen', transition('half-open'));
    this.circuit.on('close', transition('closed'));
  }

  /** From opossum's mutually exclusive `halfOpen` / `opened` / `closed` getters. */
  get state(): BreakerState {
    if (this.circuit.halfOpen) return 'half-open';
    return this.circuit.opened ? 'open' : 'closed';
  }

  /** Runs `fn` through the circuit. Open → throws `UpstreamUnavailableError` WITHOUT calling `fn`. */
  async execute<T>(
    fn: (signal: AbortSignal | undefined) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    try {
      return (await this.circuit.fire(fn, signal)) as T;
    } catch (error) {
      if (codeOf(error) === OPEN_CODE) {
        throw new UpstreamUnavailableError(this.name, this.retryAfterS);
      }
      throw error;
    }
  }

  /** Ops and test hook: opens the circuit now (opossum `open()`); the reset timer still applies. */
  forceOpen(): void {
    this.circuit.open();
  }

  /** Ops and test hook: closes the circuit now (opossum `close()`). */
  forceClose(): void {
    this.circuit.close();
  }

  /** Clears opossum's rolling-window interval and reset timer; the breaker is unusable after. */
  shutdown(): void {
    this.circuit.shutdown();
  }
}

/** One `Breaker` per external system, created on first use; `states()` feeds `/health`. */
export class BreakerRegistry implements OnModuleDestroy {
  private readonly breakers = new Map<BreakerName, Breaker>();

  constructor(
    private readonly options: BreakerOptions,
    private readonly logger: LoggerService,
  ) {}

  get(name: BreakerName): Breaker {
    let breaker = this.breakers.get(name);
    if (breaker === undefined) {
      breaker = new Breaker(name, this.options, this.logger);
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  /** State word per created breaker — no counts, no messages (T-1.3-65). */
  states(): Readonly<Record<string, BreakerState>> {
    return Object.fromEntries([...this.breakers.values()].map((b) => [b.name, b.state]));
  }

  onModuleDestroy(): void {
    for (const breaker of this.breakers.values()) breaker.shutdown();
    this.breakers.clear();
  }
}

/**
 * Transport: the module's outbound seam (BE-03, BE-08): domain events through the publisher port,
 * and the departments module through its facade (D-55), the only file of this module that reaches
 * another module for a read; and the only file where `fetch`, a breaker or `shared/resilience/*`
 * may appear (ADR-0031 §3, BE-18; the architecture block in `eslint.config.mjs` rejects them
 * anywhere else). Services and repositories call this class, never a vendor.
 *
 * The departments facade is an in-process call, so no breaker and no retry: the member form's
 * picker (`listForPicker`, `{ departmentId, name }` by name then id) and the check of a member's
 * new department ids (`existingIds`). Identity names no departments table.
 *
 * This module makes no outbound HTTP call. When one does, the shape is exactly this: retry OUTSIDE
 * the breaker so every attempt is counted by the circuit, the timeout on the request itself, every
 * number from `TIMINGS` / `RETRY_POLICIES` (`v1/auth`'s `service/auth.transport.ts#probeLegacySso`
 * is the built example):
 *
 * ```ts
 * import { RETRY_POLICIES } from '../../../shared/config/retry-policies.js';
 * import { TIMINGS } from '../../../shared/config/timings.js';
 * import { BreakerRegistry, type Breaker } from '../../../shared/resilience/breaker.js';
 * import { withRetry } from '../../../shared/resilience/retry.js';
 * import { timeoutSignal } from '../../../shared/resilience/timeout.js';
 *
 * private readonly vendor: Breaker; // = breakers.get('<name from BREAKER_NAMES>') in the constructor
 *
 * const response = await withRetry(RETRY_POLICIES.vendorHttp, () =>
 *   this.vendor.execute((signal) =>
 *     fetch(url, { signal: timeoutSignal(TIMINGS.http.vendor.timeoutMs, signal) }),
 *   ),
 * );
 * ```
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { DepartmentsFacade, type DepartmentName } from '../../departments/index.js';

@Injectable()
export class IdentityTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    private readonly departments: DepartmentsFacade,
  ) {}

  /** Forwards a domain event to the port (ADR-0029); the outbox rebinds the token when the first cross-module subscriber or job exists. */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }

  /** The member form's department picker: every department `{ departmentId, name }` by name then id (D-55). */
  listDepartments(): Promise<readonly DepartmentName[]> {
    return this.departments.listForPicker();
  }

  /** Which of `ids` are departments today (D-55); `[]` answers an empty set with no read. */
  knownDepartmentIds(ids: readonly number[]): Promise<ReadonlySet<number>> {
    return this.departments.existingIds(ids);
  }
}

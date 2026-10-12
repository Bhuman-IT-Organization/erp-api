/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `DepartmentName { departmentId, name }`
 * and a set of ids, never the wire DTO, a usage count or a mailbox column, and replacing it with an
 * HTTP or queue adapter is what makes extraction to a service atomic.
 *
 * Two registrations (D-51, D-49; the Currencies D-41-inverted precedent) and two reads (D-55); none
 * asserts the administrator flag, because a module-to-module call has no actor: the caller
 * authorises. Identity registers its staff-member counter and the staff directory from its own
 * `onModuleInit`, and reads the picker and checks a member's department ids through the two reads;
 * departments never imports identity, so no cycle is possible.
 */
import { Injectable } from '@nestjs/common';
import type { DepartmentName } from '../model/departments.model.js';
import type {
  DepartmentStaffDirectory,
  DepartmentUsageCounter,
} from '../service/department-links.registry.js';
import { DepartmentsService, type DepartmentsDescription } from '../service/departments.service.js';

/** What other modules may call: the description, the two registrations and the two reads. */
@Injectable()
export class DepartmentsFacade {
  constructor(private readonly service: DepartmentsService) {}

  describe(): DepartmentsDescription {
    return this.service.describe();
  }

  /**
   * Registers one of the calling module's read-only usage counters (D-51). Call it from your
   * module's `onModuleInit`, so it is registered before any request. Throws on a malformed counter
   * or a key already registered, so a bad registration fails at boot. The counter answers one
   * non-negative integer for a department id, never ids or names, and never writes; its answer is
   * shown under its key in each department's `registeredUsage` on the list and record reads, and a
   * counter that fails fails that read closed.
   */
  registerUsage(counter: DepartmentUsageCounter): void {
    this.service.registerUsage(counter);
  }

  /**
   * Registers the staff directory (D-49): the manager picker's active members and the stored
   * managers' names. One per process; a second throws at boot. Identity registers it.
   */
  registerStaffDirectory(directory: DepartmentStaffDirectory): void {
    this.service.registerStaffDirectory(directory);
  }

  /**
   * Every department, the name then the id ascending, as `{ departmentId, name }`; refused loudly
   * (`ERP-INTERNAL-0001`) above `DEPARTMENTS_FACADE_MAX_ROWS`, never truncated (identity's picker).
   */
  listForPicker(): Promise<readonly DepartmentName[]> {
    return this.service.listForPicker();
  }

  /** Which of `ids` are departments today; `[]` answers an empty set with no read (D-55). */
  existingIds(ids: readonly number[]): Promise<ReadonlySet<number>> {
    return this.service.existingIds(ids);
  }
}

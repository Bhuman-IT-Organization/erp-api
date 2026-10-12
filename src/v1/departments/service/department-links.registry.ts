/**
 * What other modules register with departments (D-51, D-49; the Currencies D-41-inverted precedent,
 * `CurrencyUsageRegistry`): the usage counters the list and record reads show, and the ONE staff directory the
 * manager picker and the manager's name read. A module that keeps its own rows naming a department
 * registers a read-only counter through `DepartmentsFacade.registerUsage`, and identity registers
 * the staff directory through `DepartmentsFacade.registerStaffDirectory`, each from its own
 * `onModuleInit`, so departments asks them without importing them: departments imports no other v1
 * module, and the module that registers may import `DepartmentsModule` with no cycle. Identity's
 * staff-member count (`tblstaff_departments`) and its staff directory are the first.
 *
 * A malformed or duplicate counter, or a second directory, throws at registration, so a bad
 * registration fails at boot, not in front of an administrator. A counter answers one number: no
 * id, no name, nothing written.
 */
import { Injectable } from '@nestjs/common';

/** One module's read-only count of its own rows naming a department. */
export interface DepartmentUsageCounter {
  /** The `registeredUsage` key on the wire, `/^[a-z][A-Za-z0-9]*$/`, at most 40 characters. */
  readonly key: string;
  /** The registering module's folder name, `/^[a-z][a-z0-9-]*$/`. */
  readonly module: string;
  /**
   * The counted thing's singular, plain lower-case words (`staff member`). Validated at registration
   * and kept in the registration contract; no read answers it today (the delete detail that named
   * it is gone with the delete route).
   */
  readonly noun: string;
  /** How many of the module's rows name the department: a non-negative integer, nothing else. */
  count(departmentId: number): Promise<number>;
}

/**
 * The staff directory (D-49): who may be a department's manager, and the names of the stored ones.
 * Identity registers it, wrapping `IdentityFacade.listActiveMembers` and `namesOf`.
 */
export interface DepartmentStaffDirectory {
  /** The active members, as the manager picker lists them; the manager check reads it too. */
  listActive(): Promise<readonly { readonly staffId: number; readonly name: string }[]>;
  /** `staffId -> name` for each id the directory knows; an unknown id is absent. */
  namesOf(staffIds: readonly number[]): Promise<ReadonlyMap<number, string>>;
}

/** A counter key: camelCase, starting with a lower-case letter. */
const KEY = /^[a-z][A-Za-z0-9]*$/;
/** The longest key. */
const KEY_MAX = 40;
/** A module folder name. */
const MODULE = /^[a-z][a-z0-9-]*$/;
/** A noun: lower-case words separated by single spaces. */
const NOUN = /^[a-z]+(?: [a-z]+)*$/;
/** The longest noun. */
const NOUN_MAX = 60;

/** What is wrong with `counter`, or null when nothing is. */
function problemOf(counter: DepartmentUsageCounter): string | null {
  if (!KEY.test(counter.key) || counter.key.length > KEY_MAX) {
    return `key must match ${KEY.source} and be at most ${String(KEY_MAX)} characters`;
  }
  if (!MODULE.test(counter.module)) {
    return `module ${JSON.stringify(counter.module)} must match ${MODULE.source}`;
  }
  if (!NOUN.test(counter.noun) || counter.noun.length > NOUN_MAX) {
    return `noun must be plain lower-case words, at most ${String(NOUN_MAX)} characters`;
  }
  return typeof counter.count === 'function' ? null : 'count must be a function';
}

/** Whether `directory` has the two functions a directory answers. */
function isDirectory(directory: DepartmentStaffDirectory): boolean {
  return typeof directory.listActive === 'function' && typeof directory.namesOf === 'function';
}

@Injectable()
export class DepartmentLinksRegistry {
  private readonly registered = new Map<string, DepartmentUsageCounter>();
  private directory: DepartmentStaffDirectory | null = null;

  /** Throws on a malformed counter or a key already registered. */
  register(counter: DepartmentUsageCounter): void {
    const problem = problemOf(counter);
    if (problem !== null) throw new Error(`department usage ${counter.key}: ${problem}`);
    if (this.registered.has(counter.key)) {
      throw new Error(`department usage ${counter.key} is already registered`);
    }
    this.registered.set(counter.key, counter);
  }

  /** Every registered counter, sorted by key (code point). */
  counters(): readonly DepartmentUsageCounter[] {
    return [...this.registered.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }

  /** Throws on a malformed directory or when one is already registered (there is one). */
  setStaffDirectory(directory: DepartmentStaffDirectory): void {
    if (!isDirectory(directory)) {
      throw new Error('department staff directory: listActive and namesOf must be functions');
    }
    if (this.directory !== null) {
      throw new Error('department staff directory is already registered');
    }
    this.directory = directory;
  }

  /** The registered directory, or `null` before identity registers it. */
  staffDirectory(): DepartmentStaffDirectory | null {
    return this.directory;
  }
}

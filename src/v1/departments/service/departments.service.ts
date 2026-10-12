/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer), the repository or the links registry; nothing here touches a database client,
 * `fetch` or a breaker directly, and the controller receives the DTO from here: it never imports
 * the transformer (BE-08). Failures are `AppError`s the shared filter maps to problem details.
 *
 * Read only: `tbldepartments` is Perfex's table and Perfex's `admin/departments` screen is its only
 * writer, so this module has no create, update or delete, publishes no event and writes no log line.
 *
 * Administrators only (D-06, D-45, BE-25). Every use case a handler calls asserts the administrator
 * flag as its FIRST statement, before the input is parsed, a row is read, a registered counter is
 * asked or the staff directory is called, so a refused caller learns nothing: `PermissionGuard`
 * admits a handler that declares no code, and this assertion is the only gate (T-4.1-189). Perfex's
 * own screen was administrator-only too (`Departments.php:16`). The facade paths (`registerUsage`,
 * `registerStaffDirectory`, `listForPicker`, `existingIds`) assert nothing: a module-to-module call
 * has no actor, and the caller authorises.
 *
 * Perfex's Departments list, reproduced (D-50, D-29), with hr_profile's manager and parent (D-49):
 * the reads answer each department with what uses it (the register's counts, D-51), what other
 * modules registered (`registeredUsage`: identity's staff count) and the names of its manager (the
 * staff directory identity registers) and of its parent. No read carries a ticket-mailbox column
 * (D-47).
 *
 * The registered counters and the directory (the Currencies D-41-inverted precedent): every counter
 * `DepartmentLinksRegistry` holds is asked for each id in one `Promise.all`; a counter that rejects
 * or answers anything but a non-negative integer fails the read closed. A path that needs the
 * directory while none is registered fails closed too (`ERP-INTERNAL-0001`): a manager is never
 * shown as unknown because identity has not registered yet.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { DEPARTMENTS_EXPORT_COLUMNS, DEPARTMENTS_EXPORT_FILE_STEM } from '../departments.routes.js';
import type {
  DepartmentsListResponseDto,
  DepartmentsManagersResponseDto,
  DepartmentsOptionsResponseDto,
  DepartmentsResponseDto,
} from '../dto/departments.dto.js';
import type { DepartmentName, DepartmentRow } from '../model/departments.model.js';
import { DepartmentsRepository } from '../repository/departments.repository.js';
import {
  DepartmentLinksRegistry,
  type DepartmentStaffDirectory,
  type DepartmentUsageCounter,
} from './department-links.registry.js';
import {
  DEPARTMENTS_EXPORT_CELLS,
  DepartmentsTransformer,
  NO_DEPARTMENT_USAGE,
  NO_NAMES,
  toDepartmentName,
  toExportRow,
  toManagersResponse,
  toOptionsResponse,
  toResponse,
  type DepartmentNames,
  type RegisteredCount,
} from './departments.transformer.js';
import { DepartmentsValidator } from './departments.validator.js';

export interface DepartmentsDescription {
  readonly module: 'departments';
  readonly version: 1;
}

/** One counter asked about one id: the pair the registered read runs. */
interface CounterQuestion {
  readonly id: number;
  readonly counter: DepartmentUsageCounter;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'departments are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/** Every counter asked about one id (named, so the caller's `flatMap` holds no nested callback). */
function questionsFor(
  id: number,
  counters: readonly DepartmentUsageCounter[],
): readonly CounterQuestion[] {
  return counters.map((counter) => ({ id, counter }));
}

/** A counter's answer, refused unless it is a non-negative integer (fail closed). */
async function countOf(question: CounterQuestion): Promise<number> {
  const answer: unknown = await question.counter.count(question.id);
  if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0) {
    throw new Error(
      `department usage ${question.counter.key} answered something other than a count`,
    );
  }
  return answer;
}

/**
 * The distinct non-null ids of one column of the rows.
 *
 * @complexity O(n) over the rows
 */
function idsOf(
  rows: readonly DepartmentRow[],
  pick: (row: DepartmentRow) => number | null,
): number[] {
  const ids = new Set<number>();
  for (const row of rows) {
    const id = pick(row);
    if (id !== null) ids.add(id);
  }
  return [...ids];
}

@Injectable()
export class DepartmentsService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `new Date()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: DepartmentsValidator,
    private readonly repository: DepartmentsRepository,
    private readonly transformer: DepartmentsTransformer,
    private readonly registry: DepartmentLinksRegistry,
  ) {}

  describe(): DepartmentsDescription {
    return { module: 'departments', version: 1 };
  }

  /**
   * `GET /api/v1/departments?limit&cursor&q&sort`: one keyset page (the name ascending by default);
   * the page's register counts, the registered counters, the managers' names and the parents' names
   * read in one `Promise.all`.
   */
  async list(actor: AuthenticatedUser, input: unknown): Promise<DepartmentsListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const ids = page.items.map((row) => row.id);
    const [usage, registered, names] = await Promise.all([
      this.repository.usageByDepartment(ids),
      this.registeredFor(ids),
      this.namesFor(page.items),
    ]);
    return this.transformer.toListResponse(page.items, usage, registered, names, page);
  }

  /**
   * `GET /api/v1/departments/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (ADR-0043). No row selection: a `key` is a 400. The
   * cells are the id, the name and the calendar id; no count is read.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: DEPARTMENTS_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: DEPARTMENTS_EXPORT_FILE_STEM,
      cells: DEPARTMENTS_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        return { items: page.items.map(toExportRow), nextCursor: page.nextCursor };
      },
      now: this.now(),
    });
  }

  /**
   * `GET /api/v1/departments/managers` (D-49, the manager picker): the staff directory's active
   * members as `{ id, name }`, in its order; no directory registered fails closed (500).
   */
  async managers(actor: AuthenticatedUser): Promise<DepartmentsManagersResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    return toManagersResponse(await this.directory().listActive());
  }

  /**
   * `GET /api/v1/departments/options` (the parent picker): every department by name then id with
   * its parent; refused (`ERP-INTERNAL-0001`) above the maximum, never truncated.
   */
  async options(actor: AuthenticatedUser): Promise<DepartmentsOptionsResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    return toOptionsResponse(await this.repository.findAll());
  }

  /** `GET /api/v1/departments/:id`: the department with every count; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<DepartmentsResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.record(row);
  }

  /** The facade's registration (D-51): throws on a malformed or duplicate counter. */
  registerUsage(counter: DepartmentUsageCounter): void {
    this.registry.register(counter);
  }

  /** The facade's registration (D-49): throws on a malformed directory or a second one. */
  registerStaffDirectory(directory: DepartmentStaffDirectory): void {
    this.registry.setStaffDirectory(directory);
  }

  /** The facade's picker (D-55): every department by name then id; refused above the maximum. */
  async listForPicker(): Promise<readonly DepartmentName[]> {
    return (await this.repository.findAll()).map(toDepartmentName);
  }

  /** The facade's check (D-55): which of `ids` are departments; `[]` reads nothing. */
  async existingIds(ids: readonly number[]): Promise<ReadonlySet<number>> {
    if (ids.length === 0) return new Set();
    return new Set((await this.repository.findByIds(ids)).map((row) => row.id));
  }

  /** The registered staff directory; none registered fails closed (`ERP-INTERNAL-0001`). */
  private directory(): DepartmentStaffDirectory {
    const directory = this.registry.staffDirectory();
    if (directory === null) {
      throw new AppError('ERP-INTERNAL-0001', 'the staff directory is not registered');
    }
    return directory;
  }

  /**
   * Every registered counter's answer for each id, in key order, in one `Promise.all`; a rejecting
   * counter or a malformed answer rejects (fail closed).
   *
   * @complexity O(i * c) calls over the ids and the counters
   */
  private async registeredFor(
    ids: readonly number[],
  ): Promise<ReadonlyMap<number, readonly RegisteredCount[]>> {
    const questions = ids.flatMap((id) => questionsFor(id, this.registry.counters()));
    const answers = await Promise.all(questions.map(countOf));
    const byId = new Map<number, RegisteredCount[]>(ids.map((id) => [id, []]));
    questions.forEach((question, index) => {
      byId.get(question.id)?.push({
        key: question.counter.key,
        noun: question.counter.noun,
        count: answers[index] ?? 0,
      });
    });
    return byId;
  }

  /**
   * The managers' names (the staff directory) and the parents' names (the table) of `rows`, in one
   * `Promise.all`; a name is `null` when the id is unknown. With no manager on the rows the directory
   * is not asked; with managers and no directory the read fails closed.
   *
   * @complexity O(n) over the rows
   */
  private async namesFor(
    rows: readonly DepartmentRow[],
  ): Promise<ReadonlyMap<number, DepartmentNames>> {
    const managerIds = idsOf(rows, (row) => row.managerId);
    const parentIds = idsOf(rows, (row) => row.parentId);
    const [managers, parents] = await Promise.all([
      this.managerNames(managerIds),
      this.repository.findByIds(parentIds),
    ]);
    const parentNames = new Map(parents.map((parent) => [parent.id, parent.name]));
    return new Map(
      rows.map((row) => [
        row.id,
        {
          managerName: row.managerId === null ? null : (managers.get(row.managerId) ?? null),
          parentName: row.parentId === null ? null : (parentNames.get(row.parentId) ?? null),
        },
      ]),
    );
  }

  /** The directory's names of `staffIds`; `[]` asks nothing; no directory fails closed. */
  private async managerNames(staffIds: readonly number[]): Promise<ReadonlyMap<number, string>> {
    if (staffIds.length === 0) return new Map();
    return this.directory().namesOf(staffIds);
  }

  /** D-06: the administrator flag, never a permission code; `ERP-AUTH-0005` (never identity's code). */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }

  /** One record with every count and its names. */
  private async record(row: DepartmentRow): Promise<DepartmentsResponseDto> {
    const [usage, registered, names] = await Promise.all([
      this.repository.usageByDepartment([row.id]),
      this.registeredFor([row.id]),
      this.namesFor([row]),
    ]);
    return toResponse(
      row,
      usage.get(row.id) ?? NO_DEPARTMENT_USAGE,
      registered.get(row.id) ?? [],
      names.get(row.id) ?? NO_NAMES,
    );
  }
}

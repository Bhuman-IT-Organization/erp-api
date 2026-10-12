/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer), the repository or the transport; nothing here touches a database client, `fetch`
 * or a breaker directly, and the controller receives the DTO from here: it never imports the
 * transformer (BE-08). Failures are `AppError`s the shared filter maps to problem details.
 *
 * Administrators only (D-06, BE-25). Every use case a handler calls asserts the administrator flag
 * as its FIRST statement, before the input is parsed or a row is read, so a refused caller learns
 * nothing: `PermissionGuard` admits a handler that declares no code, and this assertion is the only
 * gate (T-4.1-01; `__tests__/route-gates.spec.ts` reads it from each method's source).
 *
 * Every change publishes its event through the transport AFTER the write, then writes one `log`
 * line with the id only (D-08; BE-10 merges `requestId` and `staffId` from the request context, so
 * the line says who changed what). Node writes nothing to Perfex's activity log (D-18), and neither the
 * event nor the line carries the name or the description (T-4.1-22).
 *
 * Descriptions are stored in Perfex's `nl2br` form (`toStoredDescription`) and answered in its read
 * form by the transformer.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import {
  parseExportOptions,
  runExport,
  type ExportCell,
  type ExportFile,
} from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type {
  ExpenseCategoriesListResponseDto,
  ExpenseCategoriesResponseDto,
  UpdateExpenseCategoriesBody,
} from '../dto/expense-categories.dto.js';
import {
  ExpenseCategoriesCreatedV1,
  ExpenseCategoriesDeletedV1,
  ExpenseCategoriesUpdatedV1,
} from '../events/published.js';
import {
  EXPENSE_CATEGORIES_EXPORT_COLUMNS,
  EXPENSE_CATEGORIES_EXPORT_FILE_STEM,
} from '../expense-categories.routes.js';
import type {
  ExpenseCategory,
  ExpenseCategoryUsage,
  NewExpenseCategory,
} from '../model/expense-categories.model.js';
import { ExpenseCategoriesRepository } from '../repository/expense-categories.repository.js';
import {
  ExpenseCategoriesTransformer,
  toStoredDescription,
} from './expense-categories.transformer.js';
import { ExpenseCategoriesTransport } from './expense-categories.transport.js';
import { ExpenseCategoriesValidator } from './expense-categories.validator.js';

export interface ExpenseCategoriesDescription {
  readonly module: 'expense-categories';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'expense categories are managed by administrators only';

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/**
 * Each export column's cell over the response DTO (the description in its read form), keyed by the
 * column name, so the column list in `expense-categories.routes.ts` and what is written under it
 * cannot drift (`satisfies`); the usage counts are not a column and are never read.
 */
const EXPENSE_CATEGORIES_EXPORT_CELLS = {
  id: { value: (dto) => dto.id },
  name: { value: (dto) => dto.name },
  description: { value: (dto) => dto.description },
} as const satisfies Record<
  (typeof EXPENSE_CATEGORIES_EXPORT_COLUMNS)[number],
  ExportCell<ExpenseCategoriesResponseDto>
>;

/** The stored form of a checked patch: only the fields it carries, the description through `nl2br`. */
function toStoredPatch(patch: UpdateExpenseCategoriesBody): Partial<NewExpenseCategory> {
  return {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.description === undefined
      ? {}
      : { description: toStoredDescription(patch.description) }),
  };
}

/**
 * The in-use refusal (D-07, D-15), or `null` when nothing uses the category. A usage answer that
 * does not name the id fails closed: an unknown count never lets a delete through.
 */
function inUse(usage: ExpenseCategoryUsage | undefined): AppError | null {
  if (usage === undefined) {
    return new AppError('ERP-EXPENSECATEGORIES-0001', 'its use could not be counted');
  }
  const { expenses, accountingMappings, pettyCashAdvances } = usage;
  if (expenses + accountingMappings + pettyCashAdvances === 0) return null;
  return new AppError(
    'ERP-EXPENSECATEGORIES-0001',
    `used by ${String(expenses)} expense(s), ${String(accountingMappings)} accounting mapping(s) and ${String(pettyCashAdvances)} petty cash advance(s)`,
  );
}

@Injectable()
export class ExpenseCategoriesService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `Date.now()`. */
  now: () => number = () => Date.now();

  constructor(
    private readonly validator: ExpenseCategoriesValidator,
    private readonly repository: ExpenseCategoriesRepository,
    private readonly transformer: ExpenseCategoriesTransformer,
    private readonly transport: ExpenseCategoriesTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): ExpenseCategoriesDescription {
    return { module: 'expense-categories', version: 1 };
  }

  /**
   * `GET /api/v1/expense-categories?limit&cursor&q&sort`: one keyset page, its pager meta, and each
   * row's usage counts, read once for the page.
   */
  async list(actor: AuthenticatedUser, input: unknown): Promise<ExpenseCategoriesListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const usage = await this.repository.usageByCategory(page.items.map((row) => row.id));
    return this.transformer.toListResponse(page.items, usage, page);
  }

  /** `GET /api/v1/expense-categories/:id`: a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<ExpenseCategoriesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.transformer.toResponse(row);
  }

  /** The model for the facade (never the DTO); a module-to-module read, not a handler. */
  findById(id: number): Promise<ExpenseCategory | null> {
    return this.repository.findById(id);
  }

  /**
   * `POST /api/v1/expense-categories`: the strict body, the description stored in its `nl2br` form
   * (`''` when absent). One `ExpenseCategoriesCreatedV1` after the write, then the log line.
   */
  async create(actor: AuthenticatedUser, body: unknown): Promise<ExpenseCategoriesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const row = await this.repository.create({
      name: input.name,
      description: toStoredDescription(input.description ?? ''),
    });
    const at = new Date(this.now()).toISOString();
    await this.transport.publish(new ExpenseCategoriesCreatedV1({ id: row.id, at }));
    this.logger.log('expense category created', { id: row.id });
    return this.transformer.toResponse(row);
  }

  /**
   * `PATCH /api/v1/expense-categories/:id`: a description in the patch is stored in its `nl2br`
   * form; a missing id is `ERP-CORE-0004`. One `ExpenseCategoriesUpdatedV1` after the write, then
   * the log line.
   */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<ExpenseCategoriesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const patch = this.validator.parseUpdateBody(body);
    const row = await this.repository.update(id, toStoredPatch(patch));
    if (row === null) throw notFound();
    const at = new Date(this.now()).toISOString();
    await this.transport.publish(new ExpenseCategoriesUpdatedV1({ id: row.id, at }));
    this.logger.log('expense category updated', { id: row.id });
    return this.transformer.toResponse(row);
  }

  /**
   * `DELETE /api/v1/expense-categories/:id`: a missing id is `ERP-CORE-0004`; a category an expense,
   * an accounting mapping or a petty cash advance still uses is `ERP-EXPENSECATEGORIES-0001` (409)
   * with the three counts, and nothing is deleted (D-07, D-15). A row gone between the read and the
   * delete is the same 404. One `ExpenseCategoriesDeletedV1` after the delete, then the log line.
   * The check-then-delete window is Perfex's own (T-4.1-05, accepted).
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    const usage = await this.repository.usageByCategory([id]);
    const refusal = inUse(usage.get(id));
    if (refusal !== null) throw refusal;
    const at = new Date(this.now()).toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new ExpenseCategoriesDeletedV1({ id, at }));
    this.logger.log('expense category deleted', { id });
  }

  /**
   * `GET /api/v1/expense-categories/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (D-26, D-42, ADR-0043). **Administrators first**, for
   * every format, before any parse or count. The shared core parses the export parameters (no row
   * selection here: a `key` is a 400), counts first and refuses over the format's cap before any
   * row is read, then follows the list's own keyset read, so the rows and their order are the
   * list's. The cells are the response DTO's fields (the description in its read form), so nothing
   * the wire hides reaches the file, and the usage counts are never read.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: EXPENSE_CATEGORIES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: EXPENSE_CATEGORIES_EXPORT_FILE_STEM,
      cells: EXPENSE_CATEGORIES_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        return {
          items: page.items.map((row) => this.transformer.toResponse(row)),
          nextCursor: page.nextCursor,
        };
      },
      now: new Date(this.now()),
    });
  }

  /** D-06: the administrator flag, never a permission code; `ERP-AUTH-0005` (never identity's code). */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }
}

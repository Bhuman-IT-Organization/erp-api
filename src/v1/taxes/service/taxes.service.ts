/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer), the repository or the transport; nothing here touches a database client, `fetch`
 * or a breaker directly, and the controller receives the DTO from here: it never imports the
 * transformer (BE-08). Failures are `AppError`s the shared filter maps to problem details.
 *
 * Administrators only (D-06, BE-25). Every use case a handler calls asserts the administrator flag
 * as its FIRST statement, before the input is parsed or a row is read, so a refused caller learns
 * nothing: `PermissionGuard` admits a handler that declares no code, and this assertion is the only
 * gate (T-4.1-37; `__tests__/route-gates.spec.ts` reads it from each method's source). The facade
 * reads (`findById`, `listAll`, `findByIds`) assert nothing: a module-to-module read has no actor.
 *
 * Perfex's Taxes flow, reproduced (FE-18): the rate is rounded to the column before anything is
 * read (a rate the column cannot hold is a 400 on `rate`); a delete is refused while anything in
 * `TAX_REFERENCES` holds the id (`ERP-TAXES-0001`, D-07); an edit is refused while an expense or a
 * subscription holds it (`ERP-TAXES-0002`, Perfex's locked modal); a name another tax holds is
 * refused under the column's collation (`ERP-TAXES-0003`, Perfex's `tax_name_exists`); and a name
 * or rate change of a tax Perfex's `default_tax` setting names is refused (`ERP-TAXES-0004`, D-21),
 * because Node never writes `tbloptions` (D-10). A usage answer that does not name the id fails
 * closed. The 409 details name counts or causes only, never the setting's text (T-4.1-45).
 *
 * Every change publishes its event through the transport AFTER the write, then writes one `log`
 * line with the id only (D-08; BE-10 merges `requestId` and `staffId` from the request context).
 * Node writes nothing to Perfex's activity log (D-18).
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
import type { TaxesListResponseDto, TaxesResponseDto, UpdateTaxesBody } from '../dto/taxes.dto.js';
import { TaxesCreatedV1, TaxesDeletedV1, TaxesUpdatedV1 } from '../events/published.js';
import type { NewTax, Tax, TaxRow, TaxUsage } from '../model/taxes.model.js';
import { TaxesRepository } from '../repository/taxes.repository.js';
import { TAXES_EXPORT_COLUMNS, TAXES_EXPORT_FILE_STEM } from '../taxes.routes.js';
import { isNamedInDefaultTaxes, roundRate, TaxesTransformer, toTax } from './taxes.transformer.js';
import { TaxesTransport } from './taxes.transport.js';
import { TaxesValidator } from './taxes.validator.js';

export interface TaxesDescription {
  readonly module: 'taxes';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'taxes are managed by administrators only';

/** The detail when the usage answer does not name the id: an unknown count refuses. */
const NOT_COUNTED = 'its use could not be counted';

/** Each usage group's words in a 409 detail, in the order the detail lists them. */
const GROUP_WORDS = [
  ['items', 'item(s)'],
  ['expenses', 'expense(s)'],
  ['subscriptions', 'subscription(s)'],
  ['vendorItems', 'vendor item(s)'],
  ['purchaseLines', 'purchase line(s)'],
  ['warehouseLines', 'warehouse line(s)'],
  ['fixedEquipmentLines', 'fixed equipment line(s)'],
  ['salesReturnLines', 'sales return line(s)'],
  ['accounting', 'accounting row(s)'],
] as const satisfies readonly (readonly [keyof TaxUsage, string])[];

/** The groups whose use locks an edit in Perfex (`views/admin/tables/taxes.php`). */
const EDIT_LOCKS: readonly (keyof TaxUsage)[] = ['expenses', 'subscriptions'];

/** One exported row: the three export columns as text, nothing else. */
interface TaxExportRow {
  readonly id: string;
  readonly name: string;
  readonly rate: string;
}

/**
 * Each export column's cell over the exported row, keyed by the column name, so the column list in
 * `taxes.routes.ts` and what is written under it cannot drift (`satisfies`); the usage and the
 * default flag are not columns and are never read.
 */
const TAXES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  rate: { value: (row) => row.rate },
} as const satisfies Record<(typeof TAXES_EXPORT_COLUMNS)[number], ExportCell<TaxExportRow>>;

function toExportRow(row: TaxRow): TaxExportRow {
  return { id: String(row.id), name: row.name, rate: row.taxrate };
}

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/** The rate rounded to the column, or a 400 on `rate` when the column could not hold it. */
function storedRate(rate: string): string {
  const rounded = roundRate(rate);
  if (rounded === null) {
    throw new AppError('ERP-VALIDATION-0001', 'Request body is invalid', {
      issues: [{ path: ['rate'], message: 'the rate is too large' }],
    });
  }
  return rounded;
}

/** The stored form of a checked patch: only the fields it carries, the rate rounded. */
function toStoredPatch(patch: UpdateTaxesBody): Partial<NewTax> {
  return {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.rate === undefined ? {} : { taxrate: storedRate(patch.rate) }),
  };
}

/** `used by 2 item(s), 1 expense(s) and 4 accounting row(s)` over the given groups' non-zero counts. */
function usedBy(usage: TaxUsage, groups: readonly (keyof TaxUsage)[]): string | null {
  const parts = GROUP_WORDS.filter(([group]) => groups.includes(group) && usage[group] > 0).map(
    ([group, words]) => `${String(usage[group])} ${words}`,
  );
  const last = parts.pop();
  if (last === undefined) return null;
  return `used by ${parts.length === 0 ? last : `${parts.join(', ')} and ${last}`}`;
}

/** A refusal when the usage answer is unknown or any of `groups` is in use, else `null`. */
function usageRefusal(
  code: 'ERP-TAXES-0001' | 'ERP-TAXES-0002',
  usage: TaxUsage | undefined,
  groups: readonly (keyof TaxUsage)[],
): AppError | null {
  if (usage === undefined) return new AppError(code, NOT_COUNTED);
  const detail = usedBy(usage, groups);
  return detail === null ? null : new AppError(code, detail);
}

@Injectable()
export class TaxesService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `Date.now()`. */
  now: () => number = () => Date.now();

  constructor(
    private readonly validator: TaxesValidator,
    private readonly repository: TaxesRepository,
    private readonly transformer: TaxesTransformer,
    private readonly transport: TaxesTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): TaxesDescription {
    return { module: 'taxes', version: 1 };
  }

  /**
   * `GET /api/v1/taxes?limit&cursor&q&sort`: one keyset page (the rate ascending by default), each
   * row's usage read once for the page and the `default_tax` setting read once.
   */
  async list(actor: AuthenticatedUser, input: unknown): Promise<TaxesListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const usage = await this.repository.usageByTax(page.items.map((row) => row.id));
    const setting = await this.repository.defaultTaxSetting();
    return this.transformer.toListResponse(page.items, usage, setting, page);
  }

  /** `GET /api/v1/taxes/:id`: the tax with its usage and default flag; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<TaxesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.record(row);
  }

  /**
   * `POST /api/v1/taxes`: the strict body, the rate rounded; a name another tax holds is
   * `ERP-TAXES-0003`. One `TaxesCreatedV1` after the write, then the log line.
   */
  async create(actor: AuthenticatedUser, body: unknown): Promise<TaxesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const taxrate = storedRate(input.rate);
    if ((await this.repository.findOtherByName(input.name)) !== null) throw duplicateName();
    const row = await this.repository.create({ name: input.name, taxrate });
    const at = new Date(this.now()).toISOString();
    await this.transport.publish(new TaxesCreatedV1({ id: row.id, at }));
    this.logger.log('tax created', { id: row.id });
    return this.record(row);
  }

  /**
   * `PATCH /api/v1/taxes/:id`, refused in Perfex's order: 404 for a missing id; `ERP-TAXES-0002`
   * while an expense or a subscription uses the tax (or its use cannot be counted); `ERP-TAXES-0003`
   * for a name another tax holds; `ERP-TAXES-0004` for a name or rate change of a tax
   * `default_tax` names (D-21). A row gone at the write is the same 404. One `TaxesUpdatedV1` after
   * the write, then the log line.
   */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<TaxesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const patch = toStoredPatch(this.validator.parseUpdateBody(body));
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    await this.assertChangeable(row, patch);
    const updated = await this.repository.update(id, patch);
    if (updated === null) throw notFound();
    const at = new Date(this.now()).toISOString();
    await this.transport.publish(new TaxesUpdatedV1({ id, at }));
    this.logger.log('tax updated', { id });
    return this.record(updated);
  }

  /**
   * `DELETE /api/v1/taxes/:id`: a missing id is `ERP-CORE-0004`; a tax anything in
   * `TAX_REFERENCES` still holds (or whose use cannot be counted) is `ERP-TAXES-0001`, naming the
   * non-zero groups, and nothing is deleted (D-07). A row gone between the read and the delete is
   * the same 404. One `TaxesDeletedV1` after the delete, then the log line. The check-then-delete
   * window is Perfex's own (T-4.1-46, accepted).
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    const usage = await this.repository.usageByTax([id]);
    const refusal = usageRefusal(
      'ERP-TAXES-0001',
      usage.get(id),
      GROUP_WORDS.map(([group]) => group),
    );
    if (refusal !== null) throw refusal;
    const at = new Date(this.now()).toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new TaxesDeletedV1({ id, at }));
    this.logger.log('tax deleted', { id });
  }

  /**
   * `GET /api/v1/taxes/export?format&column&header&q&sort`: every row the list's query matches, as
   * CSV, Excel, PDF or print rows (ADR-0043). **Administrators first**, for every format, before
   * any parse or count. No row selection here: a `key` is a 400. The cells are the id, the name and
   * the rate; the usage and the default flag are never read. The generated handler name is kept.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, { columns: TAXES_EXPORT_COLUMNS, keys: 'refuse' });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: TAXES_EXPORT_FILE_STEM,
      cells: TAXES_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        return { items: page.items.map(toExportRow), nextCursor: page.nextCursor };
      },
      now: new Date(this.now()),
    });
  }

  /** The facade's read: one tax, or `null`. No assertion: a module-to-module read. */
  async findById(id: number): Promise<Tax | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toTax(row);
  }

  /** The facade's read: every tax, the rate ascending, then the id. */
  async listAll(): Promise<readonly Tax[]> {
    return (await this.repository.listAll()).map(toTax);
  }

  /** The facade's read: the taxes with these ids, in the order given, each once, absent ids skipped. */
  async findByIds(ids: readonly number[]): Promise<readonly Tax[]> {
    const unique = [...new Set(ids)];
    const rows = new Map((await this.repository.findByIds(unique)).map((row) => [row.id, row]));
    return unique.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined ? [] : [toTax(row)];
    });
  }

  /** The edit refusals, in Perfex's order: locked (0002), duplicate name (0003), default tax (0004). */
  private async assertChangeable(row: TaxRow, patch: Partial<NewTax>): Promise<void> {
    const usage = await this.repository.usageByTax([row.id]);
    const locked = usageRefusal('ERP-TAXES-0002', usage.get(row.id), EDIT_LOCKS);
    if (locked !== null) throw locked;
    const renamed = patch.name !== undefined && patch.name !== row.name;
    if (renamed && (await this.repository.findOtherByName(patch.name, row.id)) !== null) {
      throw duplicateName();
    }
    const rerated = patch.taxrate !== undefined && patch.taxrate !== row.taxrate;
    if (!renamed && !rerated) return;
    const setting = await this.repository.defaultTaxSetting();
    if (isNamedInDefaultTaxes(setting, row.name, row.taxrate)) {
      throw new AppError(
        'ERP-TAXES-0004',
        "the tax is a default tax in Perfex's settings: remove it as a default there first",
      );
    }
  }

  /** One record with its usage and default flag. */
  private async record(row: TaxRow): Promise<TaxesResponseDto> {
    const usage = await this.repository.usageByTax([row.id]);
    const setting = await this.repository.defaultTaxSetting();
    return this.transformer.toResponse(row, usage, setting);
  }

  /** D-06: the administrator flag, never a permission code; `ERP-AUTH-0005` (never identity's code). */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }
}

function duplicateName(): AppError {
  return new AppError('ERP-TAXES-0003', 'another tax already has this name');
}

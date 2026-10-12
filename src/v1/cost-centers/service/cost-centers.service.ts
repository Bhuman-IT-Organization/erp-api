/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer), the repository or the transport; nothing here touches a database client, `fetch`
 * or a breaker directly, and the controller receives the DTO from here: it never imports the
 * transformer (BE-08). Failures are `AppError`s the shared filter maps to problem details.
 *
 * Administrators only (D-06, D-26, BE-25). Every use case a handler calls asserts the administrator
 * flag as its FIRST statement, before the input is parsed, a row is read or the settings facade is
 * asked, so a refused caller learns nothing: `PermissionGuard` admits a handler that declares no
 * code, and this assertion is the only gate (T-4.1-79; `__tests__/route-gates.spec.ts` reads it from
 * each method's source). Perfex's own screen had no check at all (D-26). The facade reads
 * (`findById`, `listAll`, `findByIds`) assert nothing: a module-to-module read has no actor.
 *
 * Perfex's Cost Centers flow, reproduced (D-29): the list in Perfex's order (the id descending),
 * each row with its usage; a create writes `created_by` (the signed-in staff id) and `datecreated`
 * (Perfex's wall clock in the `default_timezone` zone, D-31); an update changes the name only, with
 * no duplicate check and no lock (Perfex has neither); a delete is refused while anything in
 * `COST_CENTER_REFERENCES` holds the cost center (`ERP-COSTCENTERS-0001`, D-07 and D-28), and when
 * its use cannot be counted. The 409 detail names counts only, never a name (T-4.1-89).
 *
 * Every change publishes its event through the transport AFTER the write, then writes one `log`
 * line with the id only (D-08; BE-10 merges `requestId` and `staffId` from the request context).
 * Node writes nothing to Perfex's activity log, and neither did Perfex's screen (D-18).
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  COST_CENTERS_EXPORT_COLUMNS,
  COST_CENTERS_EXPORT_FILE_STEM,
} from '../cost-centers.routes.js';
import type {
  CostCentersListResponseDto,
  CostCentersResponseDto,
} from '../dto/cost-centers.dto.js';
import {
  CostCentersCreatedV1,
  CostCentersDeletedV1,
  CostCentersUpdatedV1,
} from '../events/published.js';
import type { CostCenter, CostCenterRow, CostCenterUsage } from '../model/cost-centers.model.js';
import { CostCentersRepository } from '../repository/cost-centers.repository.js';
import {
  companyZone,
  COST_CENTERS_EXPORT_CELLS,
  CostCentersTransformer,
  toCostCenter,
  toExportRow,
  wallClockAt,
} from './cost-centers.transformer.js';
import { CostCentersTransport } from './cost-centers.transport.js';
import { CostCentersValidator } from './cost-centers.validator.js';

export interface CostCentersDescription {
  readonly module: 'cost-centers';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'cost centers are managed by administrators only';

/** The detail when the usage answer does not name the id: an unknown count refuses. */
const NOT_COUNTED = 'its use could not be counted';

/** Each usage group's words in a 409 detail, in the order the detail lists them. */
const GROUP_WORDS = [
  ['purchaseRequests', 'purchase request(s)'],
  ['purchaseOrders', 'purchase order(s)'],
  ['purchaseQuotations', 'purchase quotation(s)'],
  ['shippingCharges', 'shipping charge(s)'],
  ['expenses', 'expense(s)'],
  ['assets', 'asset(s)'],
] as const satisfies readonly (readonly [keyof CostCenterUsage, string])[];

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/**
 * The delete refusal: unknown usage, or `used by 2 purchase request(s), 1 expense(s) and 4 asset(s)`
 * over the non-zero groups only, in `GROUP_WORDS` order; `null` when nothing uses the cost center.
 */
function inUse(usage: CostCenterUsage | undefined): AppError | null {
  if (usage === undefined) return new AppError('ERP-COSTCENTERS-0001', NOT_COUNTED);
  const parts = GROUP_WORDS.filter(([group]) => usage[group] > 0).map(
    ([group, words]) => `${String(usage[group])} ${words}`,
  );
  const last = parts.pop();
  if (last === undefined) return null;
  const list = parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
  return new AppError('ERP-COSTCENTERS-0001', `used by ${list}`);
}

@Injectable()
export class CostCentersService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `new Date()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: CostCentersValidator,
    private readonly repository: CostCentersRepository,
    private readonly transformer: CostCentersTransformer,
    private readonly transport: CostCentersTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): CostCentersDescription {
    return { module: 'cost-centers', version: 1 };
  }

  /**
   * `GET /api/v1/cost-centers?limit&cursor&q&sort`: one keyset page (the id descending by default),
   * the page's usage read once and the company zone read once.
   */
  async list(actor: AuthenticatedUser, input: unknown): Promise<CostCentersListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const usage = await this.repository.usageByCostCenter(page.items.map((row) => row.id));
    const zone = await this.zone();
    return this.transformer.toListResponse(page.items, usage, zone, page);
  }

  /** `GET /api/v1/cost-centers/:id`: the cost center with its usage; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<CostCentersResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.record(row);
  }

  /**
   * `POST /api/v1/cost-centers`: the strict body; `created_by` is the actor and `datecreated` the
   * wall clock of the company zone now, as Perfex's `add` writes them (D-31). One
   * `CostCentersCreatedV1` after the write, then the log line; the new row's usage is zero.
   */
  async create(actor: AuthenticatedUser, body: unknown): Promise<CostCentersResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const zone = await this.zone();
    const now = this.now();
    const row = await this.repository.create({
      name: input.name,
      createdBy: actor.staffId,
      datecreated: wallClockAt(now, zone),
    });
    await this.transport.publish(new CostCentersCreatedV1({ id: row.id, at: now.toISOString() }));
    this.logger.log('cost center created', { id: row.id });
    return this.transformer.toResponse(row, new Map(), zone);
  }

  /**
   * `PATCH /api/v1/cost-centers/:id`: the name and nothing else (`created_by` and `datecreated` are
   * never changed, D-31); no duplicate check and no lock, as in Perfex. A missing id is
   * `ERP-CORE-0004`. One `CostCentersUpdatedV1` after the write, then the log line.
   */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<CostCentersResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const { name } = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, { name });
    if (updated === null) throw notFound();
    await this.transport.publish(new CostCentersUpdatedV1({ id, at: this.now().toISOString() }));
    this.logger.log('cost center updated', { id });
    return this.record(updated);
  }

  /**
   * `DELETE /api/v1/cost-centers/:id`: a missing id is `ERP-CORE-0004`; a cost center anything in
   * `COST_CENTER_REFERENCES` still holds (or whose use cannot be counted) is `ERP-COSTCENTERS-0001`,
   * naming the non-zero groups, and nothing is deleted (D-07, D-28). A row gone between the read and
   * the delete is the same 404. One `CostCentersDeletedV1` after the delete, then the log line. The
   * check-then-delete window is accepted (T-4.1-90): Perfex's own delete had no check at all.
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    const usage = await this.repository.usageByCostCenter([id]);
    const refusal = inUse(usage.get(id));
    if (refusal !== null) throw refusal;
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new CostCentersDeletedV1({ id, at }));
    this.logger.log('cost center deleted', { id });
  }

  /**
   * `GET /api/v1/cost-centers/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (ADR-0043). **Administrators first**, for every format,
   * before any parse or count. No row selection here: a `key` is a 400. The cells are the id, the
   * name and the date created; the usage is never read. The generated handler name is kept.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: COST_CENTERS_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    const zone = await this.zone();
    return runExport({
      stem: COST_CENTERS_EXPORT_FILE_STEM,
      cells: COST_CENTERS_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        return {
          items: page.items.map((row) => toExportRow(row, zone)),
          nextCursor: page.nextCursor,
        };
      },
      now: this.now(),
    });
  }

  /** The facade's read: one cost center, or `null`. No assertion: a module-to-module read. */
  async findById(id: number): Promise<CostCenter | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toCostCenter(row);
  }

  /** The facade's read: every cost center, the name ascending, then the id. */
  async listAll(): Promise<readonly CostCenter[]> {
    return (await this.repository.listAll()).map(toCostCenter);
  }

  /** The facade's read: the cost centers with these ids, in the order given, each once, absent ids skipped. */
  async findByIds(ids: readonly number[]): Promise<readonly CostCenter[]> {
    const unique = [...new Set(ids)];
    const rows = new Map((await this.repository.findByIds(unique)).map((row) => [row.id, row]));
    return unique.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined ? [] : [toCostCenter(row)];
    });
  }

  /** One record with its usage and the company zone. */
  private async record(row: CostCenterRow): Promise<CostCentersResponseDto> {
    const usage = await this.repository.usageByCostCenter([row.id]);
    return this.transformer.toResponse(row, usage, await this.zone());
  }

  /** Perfex's zone: `default_timezone` through the settings facade, `UTC` when unusable (D-31). */
  private async zone(): Promise<string> {
    return companyZone(await this.transport.companyTimeZone());
  }

  /** D-06: the administrator flag, never a permission code; `ERP-AUTH-0005` (never identity's code). */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }
}

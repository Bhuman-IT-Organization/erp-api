/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator,
 * transformer), the repository or the transport; nothing here touches a database client, `fetch`
 * or a breaker directly, and the controller receives the DTO from here: it never imports the
 * transformer (BE-08). Failures are `AppError`s the shared filter maps to problem details.
 *
 * Administrators only (D-06, D-26, BE-25). Every use case a handler calls asserts the administrator
 * flag as its FIRST statement, before the input is parsed, a row is read or the transport is
 * asked, so a refused caller learns nothing.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  LEAD_SOURCES_EXPORT_COLUMNS,
  LEAD_SOURCES_EXPORT_FILE_STEM,
} from '../lead-sources.routes.js';
import type {
  LeadSourcesListResponseDto,
  LeadSourcesResponseDto,
} from '../dto/lead-sources.dto.js';
import {
  LeadSourcesCreatedV1,
  LeadSourcesDeletedV1,
  LeadSourcesUpdatedV1,
} from '../events/published.js';
import type { LeadSource, LeadSourceRow, LeadSourceUsage } from '../model/lead-sources.model.js';
import { LeadSourcesRepository } from '../repository/lead-sources.repository.js';
import {
  LEAD_SOURCES_EXPORT_CELLS,
  LeadSourcesTransformer,
  toLeadSource,
  toExportRow,
} from './lead-sources.transformer.js';
import { LeadSourcesTransport } from './lead-sources.transport.js';
import { LeadSourcesValidator } from './lead-sources.validator.js';

export interface LeadSourcesDescription {
  readonly module: 'lead-sources';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'lead sources are managed by administrators only';

/** The detail when the usage answer does not name the id: an unknown count refuses. */
const NOT_COUNTED = 'its use could not be counted';

/** Each usage group's words in a 409 detail, in the order the detail lists them. */
const GROUP_WORDS = [['leads', 'lead(s)']] as const satisfies readonly (readonly [
  keyof LeadSourceUsage,
  string,
])[];

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/**
 * The delete refusal: unknown usage, or `used by 3 lead(s)` over the non-zero groups only;
 * `null` when nothing uses the lead source.
 */
function inUse(usage: LeadSourceUsage | undefined): AppError | null {
  if (usage === undefined) return new AppError('ERP-LEADSOURCES-0001', NOT_COUNTED);
  const parts = GROUP_WORDS.filter(([group]) => usage[group] > 0).map(
    ([group, words]) => `${String(usage[group])} ${words}`,
  );
  const last = parts.pop();
  if (last === undefined) return null;
  const list = parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
  return new AppError('ERP-LEADSOURCES-0001', `used by ${list}`);
}

@Injectable()
export class LeadSourcesService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `new Date()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: LeadSourcesValidator,
    private readonly repository: LeadSourcesRepository,
    private readonly transformer: LeadSourcesTransformer,
    private readonly transport: LeadSourcesTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): LeadSourcesDescription {
    return { module: 'lead-sources', version: 1 };
  }

  /**
   * `GET /api/v1/lead-sources?limit&cursor&q&sort`: one keyset page (the name ascending by default),
   * the page's usage read once.
   */
  async list(actor: AuthenticatedUser, input: unknown): Promise<LeadSourcesListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const usage = await this.repository.usageByLeadSource(page.items.map((row) => row.id));
    return this.transformer.toListResponse(page.items, usage, page);
  }

  /** `GET /api/v1/lead-sources/:id`: the lead source with its usage; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<LeadSourcesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.record(row);
  }

  /**
   * `POST /api/v1/lead-sources`: the strict body. One `LeadSourcesCreatedV1` after the write,
   * then the log line; the new row's usage is zero.
   */
  async create(actor: AuthenticatedUser, body: unknown): Promise<LeadSourcesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const now = this.now();
    const row = await this.repository.create({
      name: input.name,
    });
    await this.transport.publish(new LeadSourcesCreatedV1({ id: row.id, at: now.toISOString() }));
    this.logger.log('lead source created', { id: row.id });
    return this.transformer.toResponse(row, new Map());
  }

  /**
   * `PATCH /api/v1/lead-sources/:id`: the name and nothing else; no duplicate check and no lock.
   * A missing id is `ERP-CORE-0004`. One `LeadSourcesUpdatedV1` after the write, then the log line.
   */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<LeadSourcesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const { name } = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, { name });
    if (updated === null) throw notFound();
    await this.transport.publish(new LeadSourcesUpdatedV1({ id, at: this.now().toISOString() }));
    this.logger.log('lead source updated', { id });
    return this.record(updated);
  }

  /**
   * `DELETE /api/v1/lead-sources/:id`: a missing id is `ERP-CORE-0004`; the default source and any
   * source still in use are refused with 409s. One `LeadSourcesDeletedV1` after the delete, then the log line.
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    if (await this.transport.isDefaultSource(id)) {
      throw new AppError('ERP-LEADSOURCES-0002', 'it is the default lead source');
    }
    let usage: ReadonlyMap<number, LeadSourceUsage>;
    try {
      usage = await this.repository.usageByLeadSource([id]);
    } catch (error) {
      this.logger.error('lead source usage could not be counted', { id, error });
      throw new AppError('ERP-LEADSOURCES-0001', NOT_COUNTED);
    }
    const refusal = inUse(usage.get(id));
    if (refusal !== null) throw refusal;
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new LeadSourcesDeletedV1({ id, at }));
    this.logger.log('lead source deleted', { id });
  }

  /**
   * `GET /api/v1/lead-sources/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (ADR-0043). **Administrators first**.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: LEAD_SOURCES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: LEAD_SOURCES_EXPORT_FILE_STEM,
      cells: LEAD_SOURCES_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        const usage = await this.repository.usageByLeadSource(page.items.map((row) => row.id));
        return {
          items: page.items.map((row) => toExportRow(row, usage.get(row.id))),
          nextCursor: page.nextCursor,
        };
      },
      now: this.now(),
    });
  }

  /** The facade's read: one lead source, or `null`. No assertion: a module-to-module read. */
  async findById(id: number): Promise<LeadSource | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toLeadSource(row);
  }

  /** The facade's read: every lead source, the name ascending, then the id. */
  async listAll(): Promise<readonly LeadSource[]> {
    return (await this.repository.listAll()).map(toLeadSource);
  }

  /** The facade's read: the lead sources with these ids, in the order given. */
  async findByIds(ids: readonly number[]): Promise<readonly LeadSource[]> {
    const unique = [...new Set(ids)];
    const rows = new Map((await this.repository.findByIds(unique)).map((row) => [row.id, row]));
    return unique.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined ? [] : [toLeadSource(row)];
    });
  }

  /** One record with its usage. */
  private async record(row: LeadSourceRow): Promise<LeadSourcesResponseDto> {
    const usage = await this.repository.usageByLeadSource([row.id]);
    return this.transformer.toResponse(row, usage);
  }

  /** D-06: the administrator flag, never a permission code; `ERP-AUTH-0005`. */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }
}

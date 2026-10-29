/**
 * Service: the module's business rules (BE-07). All six use cases assert the administrator flag
 * (D-06, D-26) before touching a layer or returning anything.
 *
 * D-31: a create writes `name`. A PATCH changes only the name; `created_by` is never modified.
 *
 * Delete refuses (409 `ERP-CONTRACTTYPES-0001`) while any group in `CONTRACT_TYPE_REFERENCES` is
 * non-zero or its use cannot be counted.
 *
 * Writes publish their domain event (ADR-0029) and log one line through `LoggerService` (BE-14).
 * Everything is an in-process call, so no breaker and no retry.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import { runExport, type ExportFile } from '../../../shared/http/export.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  CONTRACT_TYPES_EXPORT_COLUMNS,
  CONTRACT_TYPES_EXPORT_FILE_STEM,
} from '../contract-types.routes.js';
import {
  type ContractTypesListResponseDto,
  type ContractTypesResponseDto,
} from '../dto/contract-types.dto.js';
import {
  ContractTypesCreatedV1,
  ContractTypesDeletedV1,
  ContractTypesUpdatedV1,
} from '../events/published.js';
import type {
  ContractType,
  ContractTypeRow,
  ContractTypeUsage,
} from '../model/contract-types.model.js';
import { ContractTypesRepository } from '../repository/contract-types.repository.js';
import {
  CONTRACT_TYPES_EXPORT_CELLS,
  ContractTypesTransformer,
  NO_CONTRACT_TYPE_USAGE,
  toContractType,
  toExportRow,
} from './contract-types.transformer.js';
import { ContractTypesTransport } from './contract-types.transport.js';
import { ContractTypesValidator } from './contract-types.validator.js';

export interface ContractTypesDescription {
  readonly module: 'contract-types';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'contract types are managed by administrators only';

/** The detail when the usage answer does not name the id or fails: an unknown count refuses. */
const NOT_COUNTED = 'its use could not be counted';

/** Each usage group's words in a 409 detail, in the order the detail lists them. */
const GROUP_WORDS = [['contracts', 'contract(s)']] as const satisfies readonly (readonly [
  keyof ContractTypeUsage,
  string,
])[];

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/**
 * The delete refusal: unknown usage, or `used by 1 contract(s)`
 * over the non-zero groups only, in `GROUP_WORDS` order; `null` when nothing uses the contract type.
 */
function inUse(usage: ContractTypeUsage | undefined): AppError | null {
  if (usage === undefined) return new AppError('ERP-CONTRACTTYPES-0001', NOT_COUNTED);
  const parts = GROUP_WORDS.filter(([group]) => usage[group] > 0).map(
    ([group, words]) => `${String(usage[group])} ${words}`,
  );
  const last = parts.pop();
  if (last === undefined) return null;
  const list = parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
  return new AppError('ERP-CONTRACTTYPES-0001', `used by ${list}`);
}

@Injectable()
export class ContractTypesService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `new Date()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: ContractTypesValidator,
    private readonly repository: ContractTypesRepository,
    private readonly transformer: ContractTypesTransformer,
    private readonly transport: ContractTypesTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): ContractTypesDescription {
    return { module: 'contract-types', version: 1 };
  }

  /**
   * `GET /api/v1/contract-types?limit&cursor&q&sort`: one keyset page (the name descending by default),
   * the page's usage read once.
   */
  async list(actor: AuthenticatedUser, input: unknown): Promise<ContractTypesListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const usage = await this.repository.usageByContractType(page.items.map((row) => row.id));
    return this.transformer.toListResponse(page.items, usage, page);
  }

  /** `GET /api/v1/contract-types/:id`: the contract type with its usage; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<ContractTypesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.record(row);
  }

  /**
   * `POST /api/v1/contract-types`: the strict body.
   * One `ContractTypesCreatedV1` after the write, then the log line; the new row's usage is zero.
   */
  async create(actor: AuthenticatedUser, body: unknown): Promise<ContractTypesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const now = this.now();
    const row = await this.repository.create({
      name: input.name,
    });
    await this.transport.publish(new ContractTypesCreatedV1({ id: row.id, at: now.toISOString() }));
    this.logger.log('contract type created', { id: row.id });
    return this.transformer.toResponse(row, new Map());
  }

  /**
   * `PATCH /api/v1/contract-types/:id`: the name and nothing else; no duplicate check and no lock, as in Perfex.
   * A missing id is `ERP-CORE-0004`. One `ContractTypesUpdatedV1` after the write, then the log line.
   */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<ContractTypesResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const { name } = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, { name });
    if (updated === null) throw notFound();
    await this.transport.publish(new ContractTypesUpdatedV1({ id, at: this.now().toISOString() }));
    this.logger.log('contract type updated', { id });
    return this.record(updated);
  }

  /**
   * `DELETE /api/v1/contract-types/:id`: a missing id is `ERP-CORE-0004`; a contract type anything in
   * `CONTRACT_TYPE_REFERENCES` still holds (or whose use cannot be counted) is `ERP-CONTRACTTYPES-0001`,
   * naming the non-zero groups, and nothing is deleted (D-07, D-28). A row gone between the read and
   * the delete is the same 404. One `ContractTypesDeletedV1` after the delete, then the log line. The
   * check-then-delete window is accepted (T-4.1-90): Perfex's own delete had no check at all.
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    let usage: ReadonlyMap<number, ContractTypeUsage>;
    try {
      usage = await this.repository.usageByContractType([id]);
    } catch {
      throw new AppError('ERP-CONTRACTTYPES-0001', NOT_COUNTED);
    }
    const refusal = inUse(usage.get(id));
    if (refusal !== null) throw refusal;
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new ContractTypesDeletedV1({ id, at }));
    this.logger.log('contract type deleted', { id });
  }

  /**
   * `GET /api/v1/contract-types/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (ADR-0043). **Administrators first**, for every format,
   * before any parse or count. No row selection here: a `key` is a 400.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: CONTRACT_TYPES_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: CONTRACT_TYPES_EXPORT_FILE_STEM,
      cells: CONTRACT_TYPES_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.count(list),
      page: async (list) => {
        const page = await this.repository.list(list);
        const usage = await this.repository.usageByContractType(page.items.map((row) => row.id));
        return {
          items: page.items.map((row) =>
            toExportRow(row, usage.get(row.id) ?? NO_CONTRACT_TYPE_USAGE),
          ),
          nextCursor: page.nextCursor,
        };
      },
      now: this.now(),
    });
  }

  /** The facade's read: one contract type, or `null`. No assertion: a module-to-module read. */
  async findById(id: number): Promise<ContractType | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toContractType(row);
  }

  /** The facade's read: every contract type, the name ascending, then the id. */
  async listAll(): Promise<readonly ContractType[]> {
    return (await this.repository.listAll()).map(toContractType);
  }

  /** The facade's read: the contract types with these ids, in the order given, each once, absent ids skipped. */
  async findByIds(ids: readonly number[]): Promise<readonly ContractType[]> {
    const unique = [...new Set(ids)];
    const rows = new Map((await this.repository.findByIds(unique)).map((row) => [row.id, row]));
    return unique.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined ? [] : [toContractType(row)];
    });
  }

  /** One record with its usage. */
  private async record(row: ContractTypeRow): Promise<ContractTypesResponseDto> {
    const usage = await this.repository.usageByContractType([row.id]);
    return this.transformer.toResponse(row, usage);
  }

  /** D-06: the administrator flag, never a permission code; `ERP-AUTH-0005` (never identity's code). */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }
}

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
 * Perfex's Knowledge Base flow, reproduced (D-29): the list in Perfex's order (the id descending),
 * each row with its usage; a create writes `created_by` (the signed-in staff id) and `datecreated`
 * (Perfex's wall clock in the `default_timezone` zone, D-31); an update changes the name only, with
 * no duplicate check and no lock (Perfex has neither); a delete is refused while anything in
 * `KNOWLEDGE_BASE_REFERENCES` holds the knowledge base (`ERP-KNOWLEDGEBASE-0001`, D-07 and D-28), and when
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
  KNOWLEDGE_BASE_EXPORT_COLUMNS,
  KNOWLEDGE_BASE_EXPORT_FILE_STEM,
  KNOWLEDGE_BASE_GROUPS_EXPORT_COLUMNS,
  KNOWLEDGE_BASE_GROUPS_EXPORT_FILE_STEM,
} from '../knowledge-base.routes.js';
import type {
  KnowledgeBaseListResponseDto,
  KnowledgeBaseResponseDto,
  KnowledgeBaseGroupListResponseDto,
  KnowledgeBaseGroupResponseDto,
  UpdateKnowledgeBaseGroupBody,
} from '../dto/knowledge-base.dto.js';
import {
  KnowledgeBaseCreatedV1,
  KnowledgeBaseDeletedV1,
  KnowledgeBaseUpdatedV1,
} from '../events/published.js';
import type {
  KnowledgeBase,
  KnowledgeBaseRow,
  KnowledgeBaseUsage,
} from '../model/knowledge-base.model.js';
import { KnowledgeBaseRepository } from '../repository/knowledge-base.repository.js';
import {
  companyZone,
  KNOWLEDGE_BASE_EXPORT_CELLS,
  KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS,
  KnowledgeBaseTransformer,
  toKnowledgeBase,
  toExportRow,
  wallClockAt,
} from './knowledge-base.transformer.js';
import { KnowledgeBaseTransport } from './knowledge-base.transport.js';
import { KnowledgeBaseValidator } from './knowledge-base.validator.js';

export interface KnowledgeBaseDescription {
  readonly module: 'knowledge-base';
  readonly version: 1;
}

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'knowledge bases are managed by administrators only';

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
] as const satisfies readonly (readonly [keyof KnowledgeBaseUsage, string])[];

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

/**
 * The delete refusal: unknown usage, or `used by 2 purchase request(s), 1 expense(s) and 4 asset(s)`
 * over the non-zero groups only, in `GROUP_WORDS` order; `null` when nothing uses the knowledge base.
 */
function inUse(usage: KnowledgeBaseUsage | undefined): AppError | null {
  if (usage === undefined) return new AppError('ERP-KNOWLEDGEBASE-0001', NOT_COUNTED);
  const parts = GROUP_WORDS.filter(([group]) => usage[group] > 0).map(
    ([group, words]) => `${String(usage[group])} ${words}`,
  );
  const last = parts.pop();
  if (last === undefined) return null;
  const list = parts.length === 0 ? last : `${parts.join(', ')} and ${last}`;
  return new AppError('ERP-KNOWLEDGEBASE-0001', `used by ${list}`);
}

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveActive(parsed: UpdateKnowledgeBaseGroupBody): number | undefined {
  if (parsed.disabled !== undefined) return parsed.disabled ? 0 : 1;
  if (parsed.active !== undefined) return parsed.active ? 1 : 0;
  return undefined;
}

function buildGroupUpdateData(parsed: UpdateKnowledgeBaseGroupBody) {
  const active = resolveActive(parsed);
  return {
    ...(parsed.name !== undefined && { name: parsed.name }),
    ...(parsed.name !== undefined && !parsed.groupSlug && { group_slug: toSlug(parsed.name) }),
    ...(parsed.groupSlug !== undefined && { group_slug: parsed.groupSlug }),
    ...(parsed.description !== undefined && { description: parsed.description }),
    ...(parsed.color !== undefined && { color: parsed.color }),
    ...(parsed.groupOrder !== undefined && { group_order: parsed.groupOrder }),
    ...(active !== undefined && { active }),
  };
}

@Injectable()
export class KnowledgeBaseService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; a use case reads `this.now()`, never `new Date()`. */
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: KnowledgeBaseValidator,
    private readonly repository: KnowledgeBaseRepository,
    private readonly transformer: KnowledgeBaseTransformer,
    private readonly transport: KnowledgeBaseTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): KnowledgeBaseDescription {
    return { module: 'knowledge-base', version: 1 };
  }

  /**
   * `GET /api/v1/knowledge-base?limit&cursor&q&sort`: one keyset page (the id descending by default),
   * the page's usage read once and the company zone read once.
   */
  async list(actor: AuthenticatedUser, input: unknown): Promise<KnowledgeBaseListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseListQuery(input);
    const page = await this.repository.list(request);
    const usage = await this.repository.usageByKnowledgeBase(page.items.map((row) => row.id));
    const zone = await this.zone();
    return this.transformer.toListResponse(page.items, usage, zone, page);
  }

  /** `GET /api/v1/knowledge-base/:id`: the knowledge base with its usage; a missing id is `ERP-CORE-0004`. */
  async get(actor: AuthenticatedUser, params: unknown): Promise<KnowledgeBaseResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.record(row);
  }

  /**
   * `POST /api/v1/knowledge-base`: the strict body; `created_by` is the actor and `datecreated` the
   * wall clock of the company zone now, as Perfex's `add` writes them (D-31). One
   * `KnowledgeBaseCreatedV1` after the write, then the log line; the new row's usage is zero.
   */
  async create(actor: AuthenticatedUser, body: unknown): Promise<KnowledgeBaseResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const input = this.validator.parseCreateBody(body);
    const zone = await this.zone();
    const now = this.now();
    const row = await this.repository.create({
      name: input.name,
      createdBy: actor.staffId,
      datecreated: wallClockAt(now, zone),
    });
    await this.transport.publish(new KnowledgeBaseCreatedV1({ id: row.id, at: now.toISOString() }));
    this.logger.log('knowledge base created', { id: row.id });
    return this.transformer.toResponse(row, new Map(), zone);
  }

  /**
   * `PATCH /api/v1/knowledge-base/:id`: the name and nothing else (`created_by` and `datecreated` are
   * never changed, D-31); no duplicate check and no lock, as in Perfex. A missing id is
   * `ERP-CORE-0004`. One `KnowledgeBaseUpdatedV1` after the write, then the log line.
   */
  async update(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<KnowledgeBaseResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    const { name } = this.validator.parseUpdateBody(body);
    const updated = await this.repository.update(id, { name });
    if (updated === null) throw notFound();
    await this.transport.publish(new KnowledgeBaseUpdatedV1({ id, at: this.now().toISOString() }));
    this.logger.log('knowledge base updated', { id });
    return this.record(updated);
  }

  /**
   * `DELETE /api/v1/knowledge-base/:id`: a missing id is `ERP-CORE-0004`; a knowledge base anything in
   * `KNOWLEDGE_BASE_REFERENCES` still holds (or whose use cannot be counted) is `ERP-KNOWLEDGEBASE-0001`,
   * naming the non-zero groups, and nothing is deleted (D-07, D-28). A row gone between the read and
   * the delete is the same 404. One `KnowledgeBaseDeletedV1` after the delete, then the log line. The
   * check-then-delete window is accepted (T-4.1-90): Perfex's own delete had no check at all.
   */
  async remove(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.parseParams(params);
    if ((await this.repository.findById(id)) === null) throw notFound();
    const usage = await this.repository.usageByKnowledgeBase([id]);
    const refusal = inUse(usage.get(id));
    if (refusal !== null) throw refusal;
    const at = this.now().toISOString();
    if (!(await this.repository.remove(id))) throw notFound();
    await this.transport.publish(new KnowledgeBaseDeletedV1({ id, at }));
    this.logger.log('knowledge base deleted', { id });
  }

  /**
   * `GET /api/v1/knowledge-base/export?format&column&header&q&sort`: every row the list's query
   * matches, as CSV, Excel, PDF or print rows (ADR-0043). **Administrators first**, for every format,
   * before any parse or count. No row selection here: a `key` is a 400. The cells are the id, the
   * name and the date created; the usage is never read. The generated handler name is kept.
   */
  async exportCsv(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: KNOWLEDGE_BASE_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    const zone = await this.zone();
    return runExport({
      stem: KNOWLEDGE_BASE_EXPORT_FILE_STEM,
      cells: KNOWLEDGE_BASE_EXPORT_CELLS,
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

  async listGroups(
    actor: AuthenticatedUser,
    input: unknown,
  ): Promise<KnowledgeBaseGroupListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const parsed = this.validator.parseListGroupsQuery(input);
    const rows = await this.repository.listGroups(parsed.q ?? null);
    return this.transformer.toGroupListResponse(rows);
  }

  async getGroup(
    actor: AuthenticatedUser,
    params: unknown,
  ): Promise<KnowledgeBaseGroupResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { groupId } = this.validator.parseGroupParams(params);
    const row = await this.repository.findGroupById(groupId);
    if (!row) {
      throw new AppError('ERP-CORE-0004', `Knowledge base group ${String(groupId)} not found`);
    }
    return this.transformer.toGroupResponse(row);
  }

  async createGroup(
    actor: AuthenticatedUser,
    body: unknown,
  ): Promise<KnowledgeBaseGroupResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const parsed = this.validator.parseCreateGroupBody(body);
    const active = parsed.disabled === true || parsed.active === false ? 0 : 1;
    const existing = await this.repository.listGroups();
    const groupOrder = parsed.groupOrder ?? existing.length + 1;
    const groupSlug = toSlug(parsed.name);

    const row = await this.repository.createGroup({
      name: parsed.name,
      group_slug: groupSlug,
      description: parsed.description ?? null,
      active,
      color: parsed.color ?? '#28B8DA',
      group_order: groupOrder,
    });

    this.logger.log('Knowledge base group created', {
      staffId: actor.staffId,
      groupId: row.groupid,
    });

    return this.transformer.toGroupResponse(row);
  }

  async updateGroup(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<KnowledgeBaseGroupResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { groupId } = this.validator.parseGroupParams(params);
    const parsed = this.validator.parseUpdateGroupBody(body);
    const updateData = buildGroupUpdateData(parsed);

    const row = await this.repository.updateGroup(groupId, updateData);
    if (!row) {
      throw new AppError('ERP-CORE-0004', `Knowledge base group ${String(groupId)} not found`);
    }

    this.logger.log('Knowledge base group updated', {
      staffId: actor.staffId,
      groupId: row.groupid,
    });

    return this.transformer.toGroupResponse(row);
  }

  async removeGroup(actor: AuthenticatedUser, params: unknown): Promise<void> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { groupId } = this.validator.parseGroupParams(params);
    const result = await this.repository.removeGroup(groupId);
    if (result.inUse) {
      throw new AppError(
        'ERP-KNOWLEDGEBASE-0002',
        `Knowledge base group ${String(groupId)} is in use by articles and cannot be deleted`,
      );
    }
    if (!result.deleted) {
      throw new AppError('ERP-CORE-0004', `Knowledge base group ${String(groupId)} not found`);
    }

    this.logger.log('Knowledge base group deleted', {
      staffId: actor.staffId,
      groupId,
    });
  }

  async exportGroups(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const options = parseExportOptions(input, {
      columns: KNOWLEDGE_BASE_GROUPS_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const parsed = this.validator.parseListGroupsQuery(input);
    return runExport({
      stem: KNOWLEDGE_BASE_GROUPS_EXPORT_FILE_STEM,
      cells: KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS,
      options,
      request: {
        search: parsed.q ?? null,
        sortField: 'id',
        order: 'asc',
        cursor: null,
        limit: 100,
      },
      count: async () => (await this.repository.listGroups(parsed.q ?? null)).length,
      page: async () => {
        const rows = await this.repository.listGroups(parsed.q ?? null);
        return {
          items: rows.map((r) => this.transformer.toGroupExportRow(r)),
          nextCursor: null,
        };
      },
      now: this.now(),
    });
  }

  /** The facade's read: one knowledge base, or `null`. No assertion: a module-to-module read. */
  async findById(id: number): Promise<KnowledgeBase | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : toKnowledgeBase(row);
  }

  /** The facade's read: every knowledge base, the name ascending, then the id. */
  async listAll(): Promise<readonly KnowledgeBase[]> {
    return (await this.repository.listAll()).map(toKnowledgeBase);
  }

  /** The facade's read: the knowledge base with these ids, in the order given, each once, absent ids skipped. */
  async findByIds(ids: readonly number[]): Promise<readonly KnowledgeBase[]> {
    const unique = [...new Set(ids)];
    const rows = new Map((await this.repository.findByIds(unique)).map((row) => [row.id, row]));
    return unique.flatMap((id) => {
      const row = rows.get(id);
      return row === undefined ? [] : [toKnowledgeBase(row)];
    });
  }

  /** One record with its usage and the company zone. */
  private async record(row: KnowledgeBaseRow): Promise<KnowledgeBaseResponseDto> {
    const usage = await this.repository.usageByKnowledgeBase([row.id]);
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

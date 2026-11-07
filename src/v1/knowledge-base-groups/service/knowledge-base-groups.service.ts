import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { parseExportOptions, runExport, type ExportFile } from '../../../shared/http/export.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  KNOWLEDGE_BASE_GROUPS_EXPORT_COLUMNS,
  KNOWLEDGE_BASE_GROUPS_EXPORT_FILE_STEM,
} from '../knowledge-base-groups.routes.js';
import {
  toSlug,
  type KnowledgeBaseGroupListResponseDto,
  type KnowledgeBaseGroupResponseDto,
  type UpdateKnowledgeBaseGroupBody,
} from '../dto/knowledge-base-groups.dto.js';
import {
  KNOWLEDGE_BASE_GROUPS_FACADE_MAX_ROWS,
  type KnowledgeBaseGroup,
  type KnowledgeBaseGroupPatch,
} from '../model/knowledge-base-groups.model.js';
import { KnowledgeBaseGroupsRepository } from '../repository/knowledge-base-groups.repository.js';
import {
  KnowledgeBaseGroupsCreatedV1,
  KnowledgeBaseGroupsDeletedV1,
  KnowledgeBaseGroupsUpdatedV1,
} from '../events/published.js';
import {
  KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS,
  KnowledgeBaseGroupsTransformer,
} from './knowledge-base-groups.transformer.js';
import { KnowledgeBaseGroupsTransport } from './knowledge-base-groups.transport.js';
import { KnowledgeBaseGroupsValidator } from './knowledge-base-groups.validator.js';

export { toSlug };

function notFound(): AppError {
  return new AppError('ERP-CORE-0004', 'Resource not found');
}

export interface KnowledgeBaseGroupsDescription {
  readonly module: 'knowledge-base-groups';
  readonly version: 1;
}

@Injectable()
export class KnowledgeBaseGroupsService {
  now: () => Date = () => new Date();

  constructor(
    private readonly validator: KnowledgeBaseGroupsValidator,
    private readonly repository: KnowledgeBaseGroupsRepository,
    private readonly transformer: KnowledgeBaseGroupsTransformer,
    private readonly transport: KnowledgeBaseGroupsTransport,
    private readonly logger: LoggerService,
  ) {}

  describe(): KnowledgeBaseGroupsDescription {
    return { module: 'knowledge-base-groups', version: 1 };
  }

  private async resolveUniqueSlug(baseSlug: string, excludeGroupId?: number): Promise<string> {
    if (!baseSlug) return '';
    let candidate = baseSlug;
    let suffix = 2;
    // eslint-disable-next-line no-await-in-loop -- sequential check for next available slug candidate
    while (await this.repository.existsBySlug(candidate, excludeGroupId)) {
      candidate = `${baseSlug}-${String(suffix)}`;
      suffix++;
    }
    return candidate;
  }

  private async resolveUpdateSlug(
    groupSlug: string | undefined,
    existingSlug: string | null,
    id: number,
  ): Promise<string | undefined> {
    if (groupSlug === undefined) return undefined;
    const slug = toSlug(groupSlug);
    if (existingSlug !== null && slug === existingSlug) {
      return existingSlug;
    }
    return this.resolveUniqueSlug(slug, id);
  }

  private buildGroupPatch(
    parsed: UpdateKnowledgeBaseGroupBody,
    groupSlug: string | undefined,
  ): KnowledgeBaseGroupPatch {
    const patch: {
      name?: string;
      group_slug?: string | null;
      description?: string | null;
      active?: number;
      color?: string | null;
      group_order?: number;
    } = {};
    if (parsed.name !== undefined) patch.name = parsed.name;
    if (groupSlug !== undefined) patch.group_slug = groupSlug;
    if (parsed.description !== undefined) patch.description = parsed.description;
    if (parsed.disabled !== undefined) patch.active = parsed.disabled ? 0 : 1;
    if (parsed.color !== undefined) patch.color = parsed.color;
    if (parsed.groupOrder !== undefined) patch.group_order = parsed.groupOrder ?? 0;
    return patch;
  }

  async listGroups(
    _actor: AuthenticatedUser,
    query: unknown,
  ): Promise<KnowledgeBaseGroupListResponseDto> {
    const request = this.validator.parseListGroupsQuery(query);
    const page = await this.repository.list(request);
    return this.transformer.toGroupListResponse(page);
  }

  async exportGroups(_actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    const options = parseExportOptions(input, {
      columns: KNOWLEDGE_BASE_GROUPS_EXPORT_COLUMNS,
      keys: 'refuse',
    });
    const request = this.validator.parseExportList(input);
    return runExport({
      stem: KNOWLEDGE_BASE_GROUPS_EXPORT_FILE_STEM,
      cells: KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.list(list).then((p) => p.total),
      page: async (list) => {
        const page = await this.repository.list(list);
        return {
          items: page.items.map((row) => this.transformer.toGroupExportRow(row)),
          nextCursor: page.nextCursor,
        };
      },
      now: this.now(),
    });
  }

  async getGroup(
    _actor: AuthenticatedUser,
    params: unknown,
  ): Promise<KnowledgeBaseGroupResponseDto> {
    const { id } = this.validator.parseGroupParams(params);
    const row = await this.repository.findById(id);
    if (row === null) throw notFound();
    return this.transformer.toGroupResponse(row);
  }

  async createGroup(
    _actor: AuthenticatedUser,
    body: unknown,
  ): Promise<KnowledgeBaseGroupResponseDto> {
    const parsed = this.validator.parseCreateGroupBody(body);
    const active = parsed.disabled === true ? 0 : 1;
    const baseSlug = toSlug(parsed.name);
    const groupSlug = await this.resolveUniqueSlug(baseSlug);
    const groupOrder = parsed.groupOrder ?? (await this.repository.count()) + 1;

    const row = await this.repository.create({
      name: parsed.name,
      group_slug: groupSlug || null,
      description: parsed.description ?? null,
      active,
      color: parsed.color ?? '#28B8DA',
      group_order: groupOrder,
    });

    const at = this.now().toISOString();
    await this.transport.publish(new KnowledgeBaseGroupsCreatedV1({ id: row.groupid, at }));
    this.logger.log('knowledge base group created', { id: row.groupid });

    return this.transformer.toGroupResponse(row);
  }

  async updateGroup(
    _actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<KnowledgeBaseGroupResponseDto> {
    const { id } = this.validator.parseGroupParams(params);
    const existing = await this.repository.findById(id);
    if (existing === null) throw notFound();

    const parsed = this.validator.parseUpdateGroupBody(body);
    const groupSlug = await this.resolveUpdateSlug(parsed.groupSlug, existing.group_slug, id);
    const patch = this.buildGroupPatch(parsed, groupSlug);

    const updated = await this.repository.update(id, patch);
    if (updated === null) throw notFound();

    const at = this.now().toISOString();
    await this.transport.publish(new KnowledgeBaseGroupsUpdatedV1({ id: updated.groupid, at }));
    this.logger.log('knowledge base group updated', { id: updated.groupid });

    return this.transformer.toGroupResponse(updated);
  }

  async removeGroup(_actor: AuthenticatedUser, params: unknown): Promise<void> {
    const { id } = this.validator.parseGroupParams(params);
    const group = await this.repository.findById(id);
    if (group === null) throw notFound();

    const count = await this.repository.countArticles(id);
    if (count > 0) {
      throw new AppError(
        'ERP-KNOWLEDGEBASEGROUPS-0001',
        'The knowledge base group has articles and cannot be deleted',
      );
    }

    const deleted = await this.repository.remove(id);
    if (!deleted) throw notFound();

    const at = this.now().toISOString();
    await this.transport.publish(new KnowledgeBaseGroupsDeletedV1({ id, at }));
    this.logger.log('knowledge base group deleted', { id });
  }

  async findById(id: number): Promise<KnowledgeBaseGroup | null> {
    const row = await this.repository.findById(id);
    return row === null ? null : this.transformer.toKnowledgeBaseGroup(row);
  }

  async listAll(): Promise<readonly KnowledgeBaseGroup[]> {
    const rows = await this.repository.listAll();
    if (rows.length > KNOWLEDGE_BASE_GROUPS_FACADE_MAX_ROWS) {
      throw new AppError('ERP-INTERNAL-0001', 'too many knowledge base groups');
    }
    return rows.map((r) => this.transformer.toKnowledgeBaseGroup(r));
  }

  async findByIds(ids: readonly number[]): Promise<readonly KnowledgeBaseGroup[]> {
    const rows = await this.repository.findByIds(ids);
    return rows.map((r) => this.transformer.toKnowledgeBaseGroup(r));
  }
}

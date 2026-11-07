import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import { KNOWLEDGE_BASE_GROUPS_EXPORT_COLUMNS } from '../knowledge-base-groups.routes.js';
import {
  knowledgeBaseGroupListResponseSchema,
  knowledgeBaseGroupResponseSchema,
  type KnowledgeBaseGroupListResponseDto,
  type KnowledgeBaseGroupResponseDto,
} from '../dto/knowledge-base-groups.dto.js';
import type {
  KnowledgeBaseGroup,
  KnowledgeBaseGroupPage,
  KnowledgeBaseGroupRow,
} from '../model/knowledge-base-groups.model.js';

export interface KnowledgeBaseGroupExportRow {
  readonly id: string;
  readonly name: string;
  readonly color: string | null;
  readonly groupOrder: number;
  readonly active: boolean;
  readonly totalArticles: number;
}

export const KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS = {
  id: { value: (row: KnowledgeBaseGroupExportRow) => row.id },
  name: { value: (row: KnowledgeBaseGroupExportRow) => row.name },
  color: { value: (row: KnowledgeBaseGroupExportRow) => row.color ?? '' },
  groupOrder: { value: (row: KnowledgeBaseGroupExportRow) => row.groupOrder },
  active: { value: (row: KnowledgeBaseGroupExportRow) => row.active },
  totalArticles: { value: (row: KnowledgeBaseGroupExportRow) => row.totalArticles },
} as const satisfies Record<
  (typeof KNOWLEDGE_BASE_GROUPS_EXPORT_COLUMNS)[number],
  ExportCell<KnowledgeBaseGroupExportRow>
>;

@Injectable()
export class KnowledgeBaseGroupsTransformer {
  toGroupResponse(row: KnowledgeBaseGroupRow): KnowledgeBaseGroupResponseDto {
    return knowledgeBaseGroupResponseSchema.parse({
      id: String(row.groupid),
      name: row.name,
      groupSlug: row.group_slug ?? null,
      description: row.description ?? null,
      active: row.active === 1,
      color: row.color ?? '#28B8DA',
      groupOrder: row.group_order ?? 0,
      totalArticles: row.totalArticles ?? 0,
    });
  }

  toGroupListResponse(page: KnowledgeBaseGroupPage): KnowledgeBaseGroupListResponseDto {
    return knowledgeBaseGroupListResponseSchema.parse({
      data: page.items.map((r) => this.toGroupResponse(r)),
      meta: {
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
        total: page.total,
        rangeStart: page.rangeStart,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  }

  toGroupExportRow(row: KnowledgeBaseGroupRow): KnowledgeBaseGroupExportRow {
    return {
      id: String(row.groupid),
      name: row.name,
      color: row.color ?? null,
      groupOrder: row.group_order ?? 0,
      active: row.active === 1,
      totalArticles: row.totalArticles ?? 0,
    };
  }

  toKnowledgeBaseGroup(row: KnowledgeBaseGroupRow): KnowledgeBaseGroup {
    return { id: row.groupid, name: row.name };
  }
}

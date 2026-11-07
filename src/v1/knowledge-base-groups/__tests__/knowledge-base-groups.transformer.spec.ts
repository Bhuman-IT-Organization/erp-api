import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type {
  KnowledgeBaseGroupPage,
  KnowledgeBaseGroupRow,
} from '../model/knowledge-base-groups.model.js';
import {
  KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS,
  KnowledgeBaseGroupsTransformer,
} from '../service/knowledge-base-groups.transformer.js';

const SAMPLE_ROW: KnowledgeBaseGroupRow = {
  groupid: 1,
  name: 'General',
  group_slug: 'general',
  description: 'General articles',
  active: 1,
  color: '#03a9f4',
  group_order: 1,
  totalArticles: 5,
};

describe('KnowledgeBaseGroupsTransformer', () => {
  const transformer = new KnowledgeBaseGroupsTransformer();

  it('toGroupResponse transforms database row to response DTO', () => {
    const dto = transformer.toGroupResponse(SAMPLE_ROW);
    expect(dto).toEqual({
      id: '1',
      name: 'General',
      groupSlug: 'general',
      description: 'General articles',
      active: true,
      color: '#03a9f4',
      groupOrder: 1,
      totalArticles: 5,
    });
  });

  it('toGroupListResponse formats keyset page to list response', () => {
    const page: KnowledgeBaseGroupPage = {
      items: [SAMPLE_ROW],
      total: 1,
      nextCursor: null,
      prevCursor: null,
      rangeStart: 1,
    };
    const response = transformer.toGroupListResponse(page);
    expect(response.data).toHaveLength(1);
    expect(response.data[0]?.name).toBe('General');
    expect(response.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 1,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('toGroupExportRow and KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS format export rows with boolean active', () => {
    const exportRow = transformer.toGroupExportRow(SAMPLE_ROW);
    expect(exportRow).toEqual({
      id: '1',
      name: 'General',
      color: '#03a9f4',
      groupOrder: 1,
      active: true,
      totalArticles: 5,
    });

    expect(KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS.id.value(exportRow)).toBe('1');
    expect(KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS.name.value(exportRow)).toBe('General');
    expect(KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS.color.value(exportRow)).toBe('#03a9f4');
    expect(KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS.groupOrder.value(exportRow)).toBe(1);
    expect(KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS.active.value(exportRow)).toBe(true);
    expect(KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS.totalArticles.value(exportRow)).toBe(5);

    const inactiveRow = transformer.toGroupExportRow({ ...SAMPLE_ROW, active: 0 });
    expect(inactiveRow.active).toBe(false);
    expect(KNOWLEDGE_BASE_GROUPS_EXPORT_CELLS.active.value(inactiveRow)).toBe(false);
  });

  it('toKnowledgeBaseGroup returns facade item', () => {
    expect(transformer.toKnowledgeBaseGroup(SAMPLE_ROW)).toEqual({
      id: 1,
      name: 'General',
    });
  });
});

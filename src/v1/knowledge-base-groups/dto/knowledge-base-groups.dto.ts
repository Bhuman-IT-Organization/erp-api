import { z } from 'zod';
import {
  exportBlankField,
  exportColumnField,
  exportDateFormatField,
  exportFormatField,
  exportHeaderField,
  exportNoField,
  exportTimeFormatField,
  exportTimeZoneField,
  exportTitleField,
  exportYesField,
} from '../../../shared/http/export.js';
import { listPageMetaSchema } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';

export const KNOWLEDGE_BASE_GROUP_ID_MAX = 2_147_483_647;
export const KNOWLEDGE_BASE_GROUP_NAME_MAX = 191;
export const KNOWLEDGE_BASE_COLOR_MAX = 10;
export const KNOWLEDGE_BASE_SEARCH_MAX = 100;
export const KNOWLEDGE_BASE_GROUP_ORDER_MIN = -2_147_483_648;
export const KNOWLEDGE_BASE_GROUP_ORDER_MAX = 2_147_483_647;

export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
}

/** Keyset list query for knowledge base groups (ListPageTemplate format). */
export const listKnowledgeBaseGroupsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  cursor: z.string().min(1).optional(),
  q: z.string().max(KNOWLEDGE_BASE_SEARCH_MAX).optional(),
  sort: z.string().optional(),
});

export const exportKnowledgeBaseGroupsQuerySchema = listKnowledgeBaseGroupsQuerySchema
  .omit({ limit: true, cursor: true })
  .extend({
    header: exportHeaderField,
    format: exportFormatField,
    column: exportColumnField,
    title: exportTitleField,
    yes: exportYesField,
    no: exportNoField,
    blank: exportBlankField,
    dateFormat: exportDateFormatField,
    timeFormat: exportTimeFormatField,
    timeZone: exportTimeZoneField,
  });

export const knowledgeBaseGroupParamsSchema = z.strictObject({
  id: z.coerce.number().int().positive().max(KNOWLEDGE_BASE_GROUP_ID_MAX),
});

export const createKnowledgeBaseGroupBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(KNOWLEDGE_BASE_GROUP_NAME_MAX),
  color: z.string().max(KNOWLEDGE_BASE_COLOR_MAX).optional().nullable(),
  description: z.string().optional().nullable(),
  groupOrder: z
    .number()
    .int()
    .min(KNOWLEDGE_BASE_GROUP_ORDER_MIN)
    .max(KNOWLEDGE_BASE_GROUP_ORDER_MAX)
    .optional()
    .nullable(),
  disabled: z.boolean().optional(),
});

export const updateKnowledgeBaseGroupBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(KNOWLEDGE_BASE_GROUP_NAME_MAX).optional(),
    color: z.string().max(KNOWLEDGE_BASE_COLOR_MAX).optional().nullable(),
    description: z.string().optional().nullable(),
    groupOrder: z
      .number()
      .int()
      .min(KNOWLEDGE_BASE_GROUP_ORDER_MIN)
      .max(KNOWLEDGE_BASE_GROUP_ORDER_MAX)
      .optional()
      .nullable(),
    disabled: z.boolean().optional(),
    groupSlug: z
      .string()
      .trim()
      .min(1)
      .refine((val) => toSlug(val).length > 0, {
        message: 'groupSlug must not slugify to empty',
      })
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'send at least one field');

export const knowledgeBaseGroupResponseSchema = z
  .strictObject({
    id: z.string(),
    name: z.string().max(KNOWLEDGE_BASE_GROUP_NAME_MAX),
    groupSlug: z.string().nullable(),
    description: z.string().nullable(),
    active: z.boolean(),
    color: z.string().max(KNOWLEDGE_BASE_COLOR_MAX).nullable(),
    groupOrder: z.number().int(),
    totalArticles: z.number().int().nonnegative(),
  })
  .readonly();

export const knowledgeBaseGroupListResponseSchema = z
  .strictObject({
    data: z.array(knowledgeBaseGroupResponseSchema),
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListKnowledgeBaseGroupsQuery = z.infer<typeof listKnowledgeBaseGroupsQuerySchema>;
export type ExportKnowledgeBaseGroupsQuery = z.infer<typeof exportKnowledgeBaseGroupsQuerySchema>;
export type KnowledgeBaseGroupParams = z.infer<typeof knowledgeBaseGroupParamsSchema>;
export type CreateKnowledgeBaseGroupBody = z.infer<typeof createKnowledgeBaseGroupBodySchema>;
export type UpdateKnowledgeBaseGroupBody = z.infer<typeof updateKnowledgeBaseGroupBodySchema>;
export type KnowledgeBaseGroupResponseDto = z.infer<typeof knowledgeBaseGroupResponseSchema>;
export type KnowledgeBaseGroupListResponseDto = z.infer<
  typeof knowledgeBaseGroupListResponseSchema
>;

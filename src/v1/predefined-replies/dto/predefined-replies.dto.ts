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
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { listPageMetaSchema } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';

export const PREDEFINED_REPLY_NAME_MAX = 191;
export const PREDEFINED_REPLIES_SEARCH_MAX = 191;
export const PREDEFINED_REPLY_MYSQL_INT_MAX = 2_147_483_647;

export const listPredefinedRepliesQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  cursor: z.string().min(1).optional(),
  q: z.string().max(PREDEFINED_REPLIES_SEARCH_MAX).optional(),
  sort: z.string().optional(),
});

export const exportPredefinedRepliesQuerySchema = listPredefinedRepliesQuerySchema
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

export const predefinedReplyParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(PREDEFINED_REPLY_MYSQL_INT_MAX),
});

export const createPredefinedReplyBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(PREDEFINED_REPLY_NAME_MAX),
  message: z.string().optional(),
});

export const updatePredefinedReplyBodySchema = z
  .strictObject({
    name: z.string().trim().min(1).max(PREDEFINED_REPLY_NAME_MAX).optional(),
    message: z.string().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'send at least one field',
  });

export const predefinedReplyResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    message: z.string(),
    hasOtherFormatting: z.boolean(),
  })
  .readonly();

export const predefinedReplyListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .readonly();

export const predefinedRepliesListResponseSchema = z
  .object({
    data: z.array(predefinedReplyListItemSchema),
    meta: listPageMetaSchema.extend({
      exportLimit: z.literal(EXPORT_MAX_ROWS),
      printLimit: z.literal(PRINT_MAX_ROWS),
    }),
  })
  .readonly();

export type ListPredefinedRepliesQuery = z.infer<typeof listPredefinedRepliesQuerySchema>;
export type PredefinedReplyParams = z.infer<typeof predefinedReplyParamsSchema>;
export type CreatePredefinedReplyBody = z.infer<typeof createPredefinedReplyBodySchema>;
export type UpdatePredefinedReplyBody = z.infer<typeof updatePredefinedReplyBodySchema>;
export type PredefinedReplyResponseDto = z.infer<typeof predefinedReplyResponseSchema>;
export type PredefinedRepliesListResponseDto = z.infer<typeof predefinedRepliesListResponseSchema>;

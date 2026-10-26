import { z } from 'zod';
import { listPageMetaSchema } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';

export const PREDEFINED_REPLY_NAME_MAX = 191;
export const PREDEFINED_REPLIES_SEARCH_MAX = 100;

export const listPredefinedRepliesQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  cursor: z.string().min(1).optional(),
  q: z.string().max(PREDEFINED_REPLIES_SEARCH_MAX).optional(),
  sort: z.string().optional(),
});

export const predefinedReplyParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const createPredefinedReplyBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(PREDEFINED_REPLY_NAME_MAX),
  message: z.string().trim().min(1),
});

export const updatePredefinedReplyBodySchema = createPredefinedReplyBodySchema;

export const predefinedReplyResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    message: z.string(),
  })
  .readonly();

export const predefinedReplyDeleteResponseSchema = z
  .object({
    success: z.literal(true),
  })
  .readonly();

export const predefinedRepliesListResponseSchema = z
  .object({
    data: z.array(predefinedReplyResponseSchema),
    meta: listPageMetaSchema,
  })
  .readonly();

export type ListPredefinedRepliesQuery = z.infer<typeof listPredefinedRepliesQuerySchema>;
export type PredefinedReplyParams = z.infer<typeof predefinedReplyParamsSchema>;
export type CreatePredefinedReplyBody = z.infer<typeof createPredefinedReplyBodySchema>;
export type UpdatePredefinedReplyBody = z.infer<typeof updatePredefinedReplyBodySchema>;
export type PredefinedReplyResponseDto = z.infer<typeof predefinedReplyResponseSchema>;
export type PredefinedRepliesListResponseDto = z.infer<typeof predefinedRepliesListResponseSchema>;

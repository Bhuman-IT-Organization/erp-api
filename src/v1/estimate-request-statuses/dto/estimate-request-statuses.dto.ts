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
import { ESTIMATE_REQUEST_STATUS_ID_MAX } from '../model/estimate-request-statuses.model.js';

export const ESTIMATE_REQUEST_STATUS_NAME_MAX = 50;
export const ESTIMATE_REQUEST_STATUS_COLOR_MAX = 10;
export const ESTIMATE_REQUEST_STATUSES_SEARCH_MAX = 100;
const ESTIMATE_REQUEST_STATUS_ORDER_MIN = -2_147_483_648;
const ESTIMATE_REQUEST_STATUS_ORDER_MAX = 2_147_483_647;

const orderSchema = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const number = Number(trimmed);
    return Number.isInteger(number) ? number : value;
  }
  return value;
}, z.number().int().min(ESTIMATE_REQUEST_STATUS_ORDER_MIN).max(ESTIMATE_REQUEST_STATUS_ORDER_MAX).nullable());

export const estimateRequestStatusesListQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  cursor: z.string().min(1).optional(),
  q: z.string().max(ESTIMATE_REQUEST_STATUSES_SEARCH_MAX).optional(),
  sort: z.string().optional(),
});

export const exportEstimateRequestStatusesQuerySchema = estimateRequestStatusesListQuerySchema
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

export const estimateRequestStatusesParamsSchema = z.strictObject({
  id: z.coerce.number().int().positive().max(ESTIMATE_REQUEST_STATUS_ID_MAX),
});

export const createEstimateRequestStatusBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(ESTIMATE_REQUEST_STATUS_NAME_MAX),
  color: z.string().max(ESTIMATE_REQUEST_STATUS_COLOR_MAX).nullable().optional(),
  statusorder: orderSchema.optional(),
});

export const updateEstimateRequestStatusBodySchema = createEstimateRequestStatusBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'send at least one field');

export const estimateRequestStatusResponseSchema = z
  .strictObject({
    id: z.string(),
    name: z.string().max(ESTIMATE_REQUEST_STATUS_NAME_MAX),
    color: z.string().max(ESTIMATE_REQUEST_STATUS_COLOR_MAX).nullable(),
    statusorder: z.number().int().nullable(),
    flag: z.string().nullable(),
    total_request: z.number().int().nonnegative(),
  })
  .readonly();

export const estimateRequestStatusesListResponseSchema = z
  .strictObject({
    data: z.array(estimateRequestStatusResponseSchema),
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type EstimateRequestStatusesParams = z.infer<typeof estimateRequestStatusesParamsSchema>;
export type CreateEstimateRequestStatusBody = z.infer<typeof createEstimateRequestStatusBodySchema>;
export type UpdateEstimateRequestStatusBody = z.infer<typeof updateEstimateRequestStatusBodySchema>;
export type EstimateRequestStatusResponseDto = z.infer<typeof estimateRequestStatusResponseSchema>;
export type EstimateRequestStatusesListResponseDto = z.infer<
  typeof estimateRequestStatusesListResponseSchema
>;
export type ExportEstimateRequestStatusesQuery = z.infer<
  typeof exportEstimateRequestStatusesQuerySchema
>;

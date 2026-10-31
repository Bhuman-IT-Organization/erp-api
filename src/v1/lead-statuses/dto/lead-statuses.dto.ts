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

const LEAD_STATUS_COLOR_MAX_LENGTH = 10;
export const LEAD_STATUSES_NAME_MAX = 50;
export const LEAD_STATUSES_SEARCH_MAX = 100;

/** Query parameters for listing lead statuses. */
export const listLeadStatusesQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),

  cursor: z.string().min(1).optional(),

  q: z.string().max(LEAD_STATUSES_SEARCH_MAX).optional(),

  sort: z.string().optional(),
});

/** Query parameters for exporting lead statuses. */
export const exportLeadStatusesQuerySchema = listLeadStatusesQuerySchema
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

/** Record ID from the URL. */
export const leadStatusesParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
});
// MySQL signed INT boundaries.
const MYSQL_INT_MIN = -2_147_483_648;
const MYSQL_INT_MAX = 2_147_483_647;
/** Request body when creating a status. */
export const createLeadStatusesBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(LEAD_STATUSES_NAME_MAX),

  color: z.string().trim().max(LEAD_STATUS_COLOR_MAX_LENGTH).nullable().optional(),

  statusorder: z.number().int().min(MYSQL_INT_MIN).max(MYSQL_INT_MAX).nullable().optional(),
});

/** Request body when updating a status. */
export const updateLeadStatusesBodySchema = createLeadStatusesBodySchema;

/** Counts of records referencing this status. */
export const leadStatusUsageSchema = z.object({
  leads: z.number().int().nonnegative(),
  lastLeadStatus: z.number().int().nonnegative(),
  emailIntegration: z.number().int().nonnegative(),
  webToLead: z.number().int().nonnegative(),
});

/** One lead status returned by the backend. */
export const leadStatusesResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    statusorder: z.number().int().nullable(),
    color: z.string().nullable(),
    isdefault: z.number().int(),
    usage: leadStatusUsageSchema,
    isConfiguredDefault: z.boolean(),
  })
  .readonly();

/** One row displayed in the list. */
export const leadStatusesListRowSchema = leadStatusesResponseSchema;

/** Paginated list response. */
export const leadStatusesListResponseSchema = z
  .object({
    data: z.array(leadStatusesListRowSchema),
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListLeadStatusesQuery = z.infer<typeof listLeadStatusesQuerySchema>;

export type LeadStatusesParams = z.infer<typeof leadStatusesParamsSchema>;

export type CreateLeadStatusesBody = z.infer<typeof createLeadStatusesBodySchema>;

export type UpdateLeadStatusesBody = z.infer<typeof updateLeadStatusesBodySchema>;

export type LeadStatusUsageDto = z.infer<typeof leadStatusUsageSchema>;

export type LeadStatusesResponseDto = z.infer<typeof leadStatusesResponseSchema>;

export type LeadStatusesListRowDto = z.infer<typeof leadStatusesListRowSchema>;

export type LeadStatusesListResponseDto = z.infer<typeof leadStatusesListResponseSchema>;

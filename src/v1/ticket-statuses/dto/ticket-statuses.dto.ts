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

/** MySQL `INT` is a signed 32-bit value in the existing Prisma schema. */
export const TICKET_STATUS_ID_MAX = 2_147_483_647;
export const TICKET_STATUS_NAME_MAX = 50;
export const TICKET_STATUSES_SEARCH_MAX = 100;

const TICKET_STATUS_COLOR_MAX = 7;

const statusColorSchema = z
  .union([z.literal(''), z.string().max(TICKET_STATUS_COLOR_MAX)])
  .nullable();

const statusOrderSchema = z.preprocess((value) => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const numeric = Number(trimmed);
    return Number.isInteger(numeric) ? numeric : value;
  }
  return value;
}, z.number().int().nullable());

/** Standard BE-19 list query parameters. */
export const ticketStatusesListQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  cursor: z.string().min(1).optional(),
  q: z.string().max(TICKET_STATUSES_SEARCH_MAX).optional(),
  sort: z.string().optional(),
});

/** Export query uses the same search and sort parameters, without pagination controls. */
export const exportTicketStatusesQuerySchema = ticketStatusesListQuerySchema
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

/** A positive signed `INT`; malformed ids are 400s, not 404 probes. */
export const ticketStatusesParamsSchema = z.strictObject({
  id: z.coerce.number().int().positive().max(TICKET_STATUS_ID_MAX),
});

/**
 * Perfex's form edits name, color and order. `ticketstatusid` is generated and `isdefault` is
 * controlled by the database, so neither is accepted from request bodies.
 */
export const createTicketStatusBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(TICKET_STATUS_NAME_MAX),
  statuscolor: statusColorSchema.optional(),
  statusorder: statusOrderSchema.optional(),
});

export const updateTicketStatusBodySchema = createTicketStatusBodySchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'send at least one field');

/** Response fields mirror `tbltickets_status`, with its integer key stringified on the wire. */
export const ticketStatusResponseSchema = z
  .strictObject({
    ticketstatusid: z.string(),
    name: z.string().max(TICKET_STATUS_NAME_MAX),
    isdefault: z.number().int(),
    statuscolor: z.string().max(TICKET_STATUS_COLOR_MAX).nullable(),
    statusorder: z.number().int().nullable(),
    ticket_count: z.number().int().nonnegative(),
  })
  .readonly();

/** Standard BE-19 paged list response. */
export const ticketStatusesListResponseSchema = z
  .strictObject({
    data: z.array(ticketStatusResponseSchema),
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type TicketStatusesParams = z.infer<typeof ticketStatusesParamsSchema>;
export type CreateTicketStatusBody = z.infer<typeof createTicketStatusBodySchema>;
export type UpdateTicketStatusBody = z.infer<typeof updateTicketStatusBodySchema>;
export type TicketStatusResponseDto = z.infer<typeof ticketStatusResponseSchema>;
export type TicketStatusesListResponseDto = z.infer<typeof ticketStatusesListResponseSchema>;
export type ListTicketStatusesQuery = z.infer<typeof ticketStatusesListQuerySchema>;
export type ExportTicketStatusesQuery = z.infer<typeof exportTicketStatusesQuerySchema>;

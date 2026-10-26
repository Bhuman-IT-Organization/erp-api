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

/** MySQL `INT` is a signed 32-bit value in the existing Prisma schema. */
export const TICKET_STATUS_ID_MAX = 2_147_483_647;
export const TICKET_STATUS_NAME_MAX = 50;

const TICKET_STATUS_ORDER_MIN = -TICKET_STATUS_ID_MAX - 1;
const TICKET_STATUS_COLOR_MAX = '#ffffff'.length;

const statusColorSchema = z
  .union([z.literal(''), z.string().regex(/^#[\da-f]{6}$/i, 'expected a six-digit hex color')])
  .nullable();
const statusOrderSchema = z
  .number()
  .int()
  .min(TICKET_STATUS_ORDER_MIN)
  .max(TICKET_STATUS_ID_MAX)
  .nullable();

/** The list has no filters or pagination; unexpected query keys are refused. */
export const ticketStatusesListQuerySchema = z.strictObject({});

/** The list's local search and sort, plus the shared export format parameters. */
export const exportTicketStatusesQuerySchema = z.strictObject({
  q: z.string().optional(),
  sort: z.enum(['id', '-id', 'name', '-name']).optional(),
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
  })
  .readonly();

export const ticketStatusesListResponseSchema = z
  .strictObject({ data: z.array(ticketStatusResponseSchema) })
  .readonly();

export type TicketStatusesParams = z.infer<typeof ticketStatusesParamsSchema>;
export type CreateTicketStatusBody = z.infer<typeof createTicketStatusBodySchema>;
export type UpdateTicketStatusBody = z.infer<typeof updateTicketStatusBodySchema>;
export type TicketStatusResponseDto = z.infer<typeof ticketStatusResponseSchema>;
export type TicketStatusesListResponseDto = z.infer<typeof ticketStatusesListResponseSchema>;
export type ExportTicketStatusesQuery = z.infer<typeof exportTicketStatusesQuerySchema>;

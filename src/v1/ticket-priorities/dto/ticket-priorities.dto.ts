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

/** The longest name a body may carry: Perfex's priority name. */
export const TICKET_PRIORITIES_NAME_MAX = 50;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const TICKET_PRIORITIES_SEARCH_MAX = 100;

/** Documentation only: `parseListQuery` in the validator is the gate. */
export const listTicketPrioritiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  cursor: z.string().min(1).optional(),
  q: z.string().max(TICKET_PRIORITIES_SEARCH_MAX).optional(),
  /** `-id` (default), `id`, `name` or `-name`. */
  sort: z.string().optional(),
});

/** Documentation only: `parseExportOptions` in `shared/http/export.js` is the gate. */
export const exportTicketPrioritiesQuerySchema = listTicketPrioritiesQuerySchema
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

export const ticketPrioritiesParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const createTicketPrioritiesBodySchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Name cannot be empty')
    .max(
      TICKET_PRIORITIES_NAME_MAX,
      `Name must be ${String(TICKET_PRIORITIES_NAME_MAX)} characters or less`,
    ),
});

export const updateTicketPrioritiesBodySchema = createTicketPrioritiesBodySchema;

export const ticketPrioritiesResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .readonly();

export const ticketPrioritiesListResponseSchema = z
  .object({
    data: z.array(ticketPrioritiesResponseSchema),
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListTicketPrioritiesQuery = z.infer<typeof listTicketPrioritiesQuerySchema>;
export type TicketPrioritiesParams = z.infer<typeof ticketPrioritiesParamsSchema>;
export type CreateTicketPrioritiesBody = z.infer<typeof createTicketPrioritiesBodySchema>;
export type UpdateTicketPrioritiesBody = z.infer<typeof updateTicketPrioritiesBodySchema>;
export type TicketPrioritiesResponseDto = z.infer<typeof ticketPrioritiesResponseSchema>;
export type TicketPrioritiesListResponseDto = z.infer<typeof ticketPrioritiesListResponseSchema>;

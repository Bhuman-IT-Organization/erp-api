import { z } from 'zod';

const MAX_NAME_LENGTH = 50;

export const createTicketPrioritiesBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(MAX_NAME_LENGTH),
});

export const updateTicketPrioritiesBodySchema = createTicketPrioritiesBodySchema;

export const ticketPrioritiesParamsSchema = z.object({
  id: z.union([z.string(), z.number()]),
});

export const ticketPrioritiesResponseSchema = z.object({
  id: z.number(),
  name: z.string(),
});

export const ticketPrioritiesListResponseSchema = z.object({
  data: z.array(ticketPrioritiesResponseSchema),
  meta: z
    .object({
      total: z.number().optional(),
    })
    .optional(),
});

export type CreateTicketPrioritiesBodyDto = z.infer<typeof createTicketPrioritiesBodySchema>;
export type UpdateTicketPrioritiesBodyDto = z.infer<typeof updateTicketPrioritiesBodySchema>;
export type TicketPrioritiesResponseDto = z.infer<typeof ticketPrioritiesResponseSchema>;
export type TicketPrioritiesListResponseDto = z.infer<typeof ticketPrioritiesListResponseSchema>;

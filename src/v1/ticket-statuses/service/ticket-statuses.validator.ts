import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  createTicketStatusBodySchema,
  exportTicketStatusesQuerySchema,
  ticketStatusesListQuerySchema,
  ticketStatusesParamsSchema,
  updateTicketStatusBodySchema,
  type CreateTicketStatusBody,
  type ExportTicketStatusesQuery,
  type TicketStatusesParams,
  type UpdateTicketStatusBody,
} from '../dto/ticket-statuses.dto.js';

function parse<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new AppError('ERP-VALIDATION-0001', detail, { issues: result.error.issues });
  return result.data;
}

@Injectable()
export class TicketStatusesValidator {
  parseListQuery(input: unknown): void {
    parse(ticketStatusesListQuerySchema, input, 'Query is invalid');
  }

  parseExportQuery(input: unknown): ExportTicketStatusesQuery {
    return parse(exportTicketStatusesQuerySchema, input, 'Query is invalid');
  }

  parseParams(input: unknown): TicketStatusesParams {
    return parse(ticketStatusesParamsSchema, input, 'Path parameter is invalid');
  }

  parseCreateBody(input: unknown): CreateTicketStatusBody {
    return parse(createTicketStatusBodySchema, input, 'Request body is invalid');
  }

  parseUpdateBody(input: unknown): UpdateTicketStatusBody {
    return parse(updateTicketStatusBodySchema, input, 'Request body is invalid');
  }
}

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import { z } from 'zod';
import {
  createTicketPrioritiesBodySchema,
  ticketPrioritiesListResponseSchema,
  ticketPrioritiesParamsSchema,
  ticketPrioritiesResponseSchema,
  updateTicketPrioritiesBodySchema,
  type CreateTicketPrioritiesBodyDto,
  type TicketPrioritiesListResponseDto,
  type TicketPrioritiesResponseDto,
  type UpdateTicketPrioritiesBodyDto,
} from '../dto/ticket-priority.dto.js';
import { TicketPrioritiesService } from '../service/ticket-priorities.service.js';
import { TICKET_PRIORITIES_ROUTES } from '../ticket-priorities.routes.js';

// Infer the params type directly from your Zod schema
type TicketPrioritiesParamsDto = z.infer<typeof ticketPrioritiesParamsSchema>;

@Controller(TICKET_PRIORITIES_ROUTES.base)
export class TicketPrioritiesController {
  constructor(private readonly service: TicketPrioritiesService) {}

  @Get(TICKET_PRIORITIES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List ticket priorities',
    responses: { [HTTP_STATUS.OK]: ticketPrioritiesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(@CurrentUser() user: AuthenticatedUser): Promise<TicketPrioritiesListResponseDto> {
    return this.service.list(user);
  }

  @Get(TICKET_PRIORITIES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one ticket priority',
    params: ticketPrioritiesParamsSchema,
    responses: { [HTTP_STATUS.OK]: ticketPrioritiesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: TicketPrioritiesParamsDto,
  ): Promise<TicketPrioritiesResponseDto> {
    return this.service.get(user, params);
  }

  @Post(TICKET_PRIORITIES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a ticket priority',
    body: createTicketPrioritiesBodySchema,
    responses: { [HTTP_STATUS.CREATED]: ticketPrioritiesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateTicketPrioritiesBodyDto,
  ): Promise<TicketPrioritiesResponseDto> {
    return this.service.create(user, body);
  }

  @Patch(TICKET_PRIORITIES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Update a ticket priority',
    params: ticketPrioritiesParamsSchema,
    body: updateTicketPrioritiesBodySchema,
    responses: { [HTTP_STATUS.OK]: ticketPrioritiesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: TicketPrioritiesParamsDto,
    @Body() body: UpdateTicketPrioritiesBodyDto,
  ): Promise<TicketPrioritiesResponseDto> {
    return this.service.update(user, params, body);
  }

  @Delete(TICKET_PRIORITIES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a ticket priority',
    params: ticketPrioritiesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: TicketPrioritiesParamsDto,
  ): Promise<void> {
    return this.service.remove(user, params);
  }
}

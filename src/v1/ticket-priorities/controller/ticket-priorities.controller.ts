import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import type { FastifyReply } from 'fastify';
import { replyExport, type ExportFile } from '../../../shared/http/export.js';
import {
  createTicketPrioritiesBodySchema,
  exportTicketPrioritiesQuerySchema,
  listTicketPrioritiesQuerySchema,
  ticketPrioritiesListResponseSchema,
  ticketPrioritiesParamsSchema,
  ticketPrioritiesResponseSchema,
  updateTicketPrioritiesBodySchema,
  type TicketPrioritiesListResponseDto,
  type TicketPrioritiesResponseDto,
} from '../dto/ticket-priorities.dto.js';
import { TicketPrioritiesService } from '../service/ticket-priorities.service.js';
import { TICKET_PRIORITIES_ROUTES } from '../ticket-priorities.routes.js';

/**
 * Administrators only (BE-25): every handler carries `JwtAuthGuard, PermissionGuard` and declares NO
 * permission code, so the guard admits any signed-in member and the service's `assertAdministrator`
 * answers 403 `ERP-AUTH-0005`. Controllers hold no logic and never catch.
 */
@Controller(TICKET_PRIORITIES_ROUTES.base)
export class TicketPrioritiesController {
  constructor(private readonly service: TicketPrioritiesService) {}

  @Get(TICKET_PRIORITIES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List ticket priorities (administrators only; keyset paging, one sort, q)',
    query: listTicketPrioritiesQuerySchema,
    responses: { [HTTP_STATUS.OK]: ticketPrioritiesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<TicketPrioritiesListResponseDto> {
    return this.service.list(user, query);
  }
  @Get(TICKET_PRIORITIES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every ticket priority the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportTicketPrioritiesQuerySchema,
    produces: 'export',
    responses: {},
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
    headers: ['Content-Disposition', 'Cache-Control'],
  })
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExportFile['body']> {
    return replyExport(reply, await this.service.exportCsv(user, query));
  }

  @Get(TICKET_PRIORITIES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one ticket priority (administrators only)',
    params: ticketPrioritiesParamsSchema,
    responses: { [HTTP_STATUS.OK]: ticketPrioritiesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<TicketPrioritiesResponseDto> {
    return this.service.get(user, params);
  }

  @Post(TICKET_PRIORITIES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a ticket priority (administrators only)',
    body: createTicketPrioritiesBodySchema,
    responses: { [HTTP_STATUS.CREATED]: ticketPrioritiesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<TicketPrioritiesResponseDto> {
    return this.service.create(user, body);
  }

  @Patch(TICKET_PRIORITIES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Rename a ticket priority (administrators only)',
    params: ticketPrioritiesParamsSchema,
    body: updateTicketPrioritiesBodySchema,
    responses: { [HTTP_STATUS.OK]: ticketPrioritiesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<TicketPrioritiesResponseDto> {
    return this.service.update(user, params, body);
  }

  @Delete(TICKET_PRIORITIES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a ticket priority (administrators only); refused while in use or the default',
    params: ticketPrioritiesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-TICKETPRIORITIES-0001',
      'ERP-TICKETPRIORITIES-0002',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

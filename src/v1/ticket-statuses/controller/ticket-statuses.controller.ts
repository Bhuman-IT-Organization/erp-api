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
import type { FastifyReply } from 'fastify';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { replyExport, type ExportFile } from '../../../shared/http/export.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import {
  createTicketStatusBodySchema,
  exportTicketStatusesQuerySchema,
  ticketStatusesListQuerySchema,
  ticketStatusesListResponseSchema,
  ticketStatusesParamsSchema,
  ticketStatusResponseSchema,
  updateTicketStatusBodySchema,
  type TicketStatusResponseDto,
  type TicketStatusesListResponseDto,
} from '../dto/ticket-statuses.dto.js';
import { TICKET_STATUSES_ROUTES } from '../ticket-statuses.routes.js';
import { TicketStatusesService } from '../service/ticket-statuses.service.js';

@Controller(TICKET_STATUSES_ROUTES.base)
export class TicketStatusesController {
  constructor(private readonly service: TicketStatusesService) {}

  @Get(TICKET_STATUSES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List ticket statuses (administrators only)',
    query: ticketStatusesListQuerySchema,
    responses: { [HTTP_STATUS.OK]: ticketStatusesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<TicketStatusesListResponseDto> {
    return this.service.list(user, query);
  }

  @Get(TICKET_STATUSES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Export ticket statuses as CSV, Excel, PDF or print rows (administrators only)',
    query: exportTicketStatusesQuerySchema,
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

  @Get(TICKET_STATUSES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one ticket status (administrators only)',
    params: ticketStatusesParamsSchema,
    responses: { [HTTP_STATUS.OK]: ticketStatusResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<TicketStatusResponseDto> {
    return this.service.get(user, params);
  }

  @Post(TICKET_STATUSES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a ticket status (administrators only)',
    body: createTicketStatusBodySchema,
    responses: { [HTTP_STATUS.CREATED]: ticketStatusResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<TicketStatusResponseDto> {
    return this.service.create(user, body);
  }

  @Patch(TICKET_STATUSES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Update a ticket status (administrators only)',
    params: ticketStatusesParamsSchema,
    body: updateTicketStatusBodySchema,
    responses: { [HTTP_STATUS.OK]: ticketStatusResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<TicketStatusResponseDto> {
    return this.service.update(user, params, body);
  }

  @Delete(TICKET_STATUSES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a ticket status (administrators only)',
    params: ticketStatusesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-TICKETSTATUSES-0001',
      'ERP-TICKETSTATUSES-0002',
      'ERP-TICKETSTATUSES-0003',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

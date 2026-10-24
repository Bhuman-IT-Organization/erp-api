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

import { LEAD_STATUSES_ROUTES } from '../lead-statuses.routes.js';

import {
  leadStatusesListResponseSchema,
  leadStatusesParamsSchema,
  leadStatusesResponseSchema,
  createLeadStatusesBodySchema,
  exportLeadStatusesQuerySchema,
  listLeadStatusesQuerySchema,
  updateLeadStatusesBodySchema,
  type LeadStatusesListResponseDto,
  type LeadStatusesResponseDto,
} from '../dto/lead-statuses.dto.js';

import { LeadStatusesService } from '../service/lead-statuses.service.js';

@Controller(LEAD_STATUSES_ROUTES.base)
export class LeadStatusesController {
  constructor(private readonly service: LeadStatusesService) {}

  /** GET: List all lead statuses. */
  @Get(LEAD_STATUSES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List lead statuses (administrators only)',
    query: listLeadStatusesQuerySchema,
    responses: {
      [HTTP_STATUS.OK]: leadStatusesListResponseSchema,
    },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<LeadStatusesListResponseDto> {
    return this.service.list(user, query);
  }

  /** GET: Export lead statuses. */
  @Get(LEAD_STATUSES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Export lead statuses (administrators only)',
    query: exportLeadStatusesQuerySchema,
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

  /** GET: Retrieve a status by ID. */
  @Get(LEAD_STATUSES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one lead status (administrators only)',
    params: leadStatusesParamsSchema,
    responses: {
      [HTTP_STATUS.OK]: leadStatusesResponseSchema,
    },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<LeadStatusesResponseDto> {
    return this.service.get(user, params);
  }

  /** POST: Create a lead status. */
  @Post(LEAD_STATUSES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a lead status (administrators only)',
    body: createLeadStatusesBodySchema,
    responses: {
      [HTTP_STATUS.CREATED]: leadStatusesResponseSchema,
    },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<LeadStatusesResponseDto> {
    return this.service.create(user, body);
  }

  /** PATCH: Update a lead status. */
  @Patch(LEAD_STATUSES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Update a lead status (administrators only)',
    params: leadStatusesParamsSchema,
    body: updateLeadStatusesBodySchema,
    responses: {
      [HTTP_STATUS.OK]: leadStatusesResponseSchema,
    },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<LeadStatusesResponseDto> {
    return this.service.update(user, params, body);
  }

  /** DELETE: Remove a status only when business rules allow it. */
  @Delete(LEAD_STATUSES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a lead status when permitted (administrators only)',
    params: leadStatusesParamsSchema,
    responses: {
      [HTTP_STATUS.NO_CONTENT]: null,
    },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

/**
 * HTTP entry for `api/v1/custom-fields`: the three read routes (list, export, detail). Decorators
 * bind the route, the guards and the API documentation; the handler hands the actor and the raw
 * input to the service and returns its DTO. No logic, no transformer import, no try (every failure
 * reaches `ProblemDetailsFilter`).
 *
 * Read-only: `tblcustomfields` and `tblcustomfieldsvalues` are Perfex's, and Perfex's Setup > Custom
 * Fields page is the only place a field is created, edited, switched or deleted. This copy serves
 * no write route.
 *
 * Administrators only (Perfex's controller is `is_admin()` only): every handler carries `JwtAuthGuard,
 * PermissionGuard` (401 `ERP-AUTH-0004` without a valid bearer) and declares NO permission code, so
 * the guard admits any signed-in member and the service's `assertAdministrator` answers 403
 * `ERP-AUTH-0005` to anyone without the administrator flag.
 *
 * The record answer carries the ADR-0040 fingerprint in the `ETag` header and in the body's `etag`.
 */
import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { ETAG_HEADER } from '../../../shared/http/etag.js';
import { replyExport, type ExportFile } from '../../../shared/http/export.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import { CUSTOM_FIELDS_ROUTES } from '../custom-fields.routes.js';
import {
  customFieldsListResponseSchema,
  customFieldsParamsSchema,
  customFieldsResponseSchema,
  exportCustomFieldsQuerySchema,
  listCustomFieldsQuerySchema,
  type CustomFieldsListResponseDto,
  type CustomFieldsResponseDto,
} from '../dto/custom-fields.dto.js';
import { CustomFieldsService } from '../service/custom-fields.service.js';

const AUTH_ERRORS = ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'] as const;

@Controller(CUSTOM_FIELDS_ROUTES.base)
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  /** `GET /api/v1/custom-fields?limit&cursor&q&sort&filter[fieldto][in]`: each row with its value count. */
  @Get(CUSTOM_FIELDS_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List custom fields with their value counts (administrators only)',
    query: listCustomFieldsQuerySchema,
    responses: { [HTTP_STATUS.OK]: customFieldsListResponseSchema },
    errors: [...AUTH_ERRORS],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<CustomFieldsListResponseDto> {
    return this.service.list(user, query);
  }

  /** `GET /api/v1/custom-fields/export?format&column&header&q&sort`: the shared export. */
  @Get(CUSTOM_FIELDS_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Export the custom fields the list query matches (administrators only)',
    query: exportCustomFieldsQuerySchema,
    produces: 'export',
    responses: {},
    errors: [...AUTH_ERRORS],
    headers: ['Content-Disposition', 'Cache-Control'],
  })
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExportFile['body']> {
    return replyExport(reply, await this.service.exportCsv(user, query));
  }

  /** `GET /api/v1/custom-fields/:id`: the record and its fingerprint. */
  @Get(CUSTOM_FIELDS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one custom field (administrators only)',
    params: customFieldsParamsSchema,
    responses: { [HTTP_STATUS.OK]: customFieldsResponseSchema },
    errors: [...AUTH_ERRORS, 'ERP-CORE-0004'],
    headers: [ETAG_HEADER],
  })
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CustomFieldsResponseDto> {
    const dto = await this.service.get(user, params);
    reply.header(ETAG_HEADER, dto.etag);
    return dto;
  }
}

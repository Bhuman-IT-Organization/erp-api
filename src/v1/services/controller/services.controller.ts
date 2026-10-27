/**
 * HTTP entry for `api/v1/services`: list, export, detail, create, update and delete. Decorators bind
 * the route, the guards and the API documentation (`@ApiZod`, BE-23); the handler hands the actor
 * and the raw input to the service and returns its DTO. Controllers hold no logic, import no
 * transformer and never catch.
 *
 * Administrators only (D-06, D-26, BE-25): every handler carries `JwtAuthGuard, PermissionGuard`
 * (401 `ERP-AUTH-0004` without a valid bearer) and declares NO permission code; the service's
 * `assertAdministrator` answers 403 `ERP-AUTH-0005` to anyone without the administrator flag.
 *
 * The static `export` segment is declared before `:id`; find-my-way serves it first anyway.
 */
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
  createServicesBodySchema,
  exportServicesQuerySchema,
  listServicesQuerySchema,
  servicesListResponseSchema,
  servicesParamsSchema,
  servicesResponseSchema,
  updateServicesBodySchema,
  type ServicesListResponseDto,
  type ServicesResponseDto,
} from '../dto/services.dto.js';
import { ServicesService } from '../service/services.service.js';
import { SERVICES_ROUTES } from '../services.routes.js';

@Controller(SERVICES_ROUTES.base)
export class ServicesController {
  constructor(private readonly service: ServicesService) {}

  /** `GET /api/v1/services?limit&cursor&q&sort`: the BE-19 envelope. */
  @Get(SERVICES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List services (administrators only; keyset paging, one sort, q)',
    query: listServicesQuerySchema,
    responses: { [HTTP_STATUS.OK]: servicesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<ServicesListResponseDto> {
    return this.service.list(user, query);
  }

  /**
   * `GET /api/v1/services/export?format&column&header&q&sort`: every row the list's query matches
   * as CSV, Excel, PDF or print rows, gated exactly like the list (the service asserts the
   * administrator flag first). `replyExport` sets the export's headers on the passthrough reply.
   */
  @Get(SERVICES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every service the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportServicesQuerySchema,
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

  /** `GET /api/v1/services/:id`: one service; a missing id is a 404. */
  @Get(SERVICES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one service (administrators only)',
    params: servicesParamsSchema,
    responses: { [HTTP_STATUS.OK]: servicesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<ServicesResponseDto> {
    return this.service.get(user, params);
  }

  /** `POST /api/v1/services`: 201 and the service. */
  @Post(SERVICES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a service (administrators only)',
    body: createServicesBodySchema,
    responses: { [HTTP_STATUS.CREATED]: servicesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<ServicesResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/services/:id`: the service after the rename; a missing id is a 404. */
  @Patch(SERVICES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Rename a service (administrators only)',
    params: servicesParamsSchema,
    body: updateServicesBodySchema,
    responses: { [HTTP_STATUS.OK]: servicesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<ServicesResponseDto> {
    return this.service.update(user, params, body);
  }

  /** `DELETE /api/v1/services/:id`: 204; 404 for a missing id; 409 while a ticket uses it. */
  @Delete(SERVICES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a service (administrators only); refused while a ticket uses it',
    params: servicesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-SERVICES-0001',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

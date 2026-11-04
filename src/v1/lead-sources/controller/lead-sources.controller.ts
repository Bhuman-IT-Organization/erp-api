/**
 * HTTP entry for `api/v1/lead-sources`: the six routes the screens call (list, export, detail,
 * create, update and delete). Decorators bind the route, the guards and the API documentation
 * (`@ApiZod` names the zod schemas and the error codes, BE-23), the handler hands the actor and the
 * raw input to the service and returns its DTO. Controllers hold no logic, import no transformer
 * and never catch (the architecture block rejects a `try` here): every failure reaches
 * `ProblemDetailsFilter`.
 *
 * Administrators only (D-06, D-26, BE-25): every handler carries `JwtAuthGuard, PermissionGuard`
 * (401 `ERP-AUTH-0004` without a valid bearer) and declares NO permission code, so the guard admits
 * any signed-in member and the service's `assertAdministrator` answers 403 `ERP-AUTH-0005` to anyone
 * without the administrator flag. `@erp/contracts`' `ROUTE_GATES` declares the three screens
 * `'admin'`; `__tests__/route-gates.spec.ts` compares every handler with it.
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
import { LEAD_SOURCES_ROUTES } from '../lead-sources.routes.js';
import {
  leadSourcesListResponseSchema,
  leadSourcesParamsSchema,
  leadSourcesResponseSchema,
  createLeadSourcesBodySchema,
  exportLeadSourcesQuerySchema,
  listLeadSourcesQuerySchema,
  updateLeadSourcesBodySchema,
  type LeadSourcesListResponseDto,
  type LeadSourcesResponseDto,
} from '../dto/lead-sources.dto.js';
import { LeadSourcesService } from '../service/lead-sources.service.js';

@Controller(LEAD_SOURCES_ROUTES.base)
export class LeadSourcesController {
  constructor(private readonly service: LeadSourcesService) {}

  /** `GET /api/v1/lead-sources?limit&cursor&q&sort`: the BE-19 envelope, each row with its usage. */
  @Get(LEAD_SOURCES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List lead sources with their usage (administrators only; keyset paging, one sort, q)',
    query: listLeadSourcesQuerySchema,
    responses: { [HTTP_STATUS.OK]: leadSourcesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<LeadSourcesListResponseDto> {
    return this.service.list(user, query);
  }

  /**
   * `GET /api/v1/lead-sources/export?format&column&header&q&sort`: every row the list's query
   * matches as CSV, Excel, PDF or print rows, gated exactly like the list (the service asserts the
   * administrator flag first). `replyExport` sets the export's headers on the passthrough reply.
   */
  @Get(LEAD_SOURCES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every lead source the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportLeadSourcesQuerySchema,
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

  /** `GET /api/v1/lead-sources/:id`: one lead source with its usage; a missing id is a 404. */
  @Get(LEAD_SOURCES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one lead source (administrators only)',
    params: leadSourcesParamsSchema,
    responses: { [HTTP_STATUS.OK]: leadSourcesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<LeadSourcesResponseDto> {
    return this.service.get(user, params);
  }

  /**
   * `POST /api/v1/lead-sources`: 201 and the lead source; a name another lead source holds is
   * accepted, as in Perfex. Unkeyed, like the other Setup lists.
   */
  @Post(LEAD_SOURCES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a lead source (administrators only)',
    body: createLeadSourcesBodySchema,
    responses: { [HTTP_STATUS.CREATED]: leadSourcesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<LeadSourcesResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/lead-sources/:id`: the lead source after the rename; a missing id is a 404. */
  @Patch(LEAD_SOURCES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Rename a lead source (administrators only)',
    params: leadSourcesParamsSchema,
    body: updateLeadSourcesBodySchema,
    responses: { [HTTP_STATUS.OK]: leadSourcesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<LeadSourcesResponseDto> {
    return this.service.update(user, params, body);
  }

  /**
   * `DELETE /api/v1/lead-sources/:id`: 204 with no body; 404 for a missing id; 409 while any
   * referencing column still holds the lead source (D-07, D-28).
   */
  @Delete(LEAD_SOURCES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a lead source (administrators only); refused while anything still uses it',
    params: leadSourcesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-LEADSOURCES-0001',
      'ERP-LEADSOURCES-0002',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

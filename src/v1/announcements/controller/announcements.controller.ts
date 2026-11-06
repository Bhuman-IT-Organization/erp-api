/**
 * HTTP entry for `api/v1/announcements`: the six routes the screens call (list, export, detail,
 * create, update and delete). Decorators bind the route, the guards and the API documentation
 * (`@ApiZod` names the zod schemas and the error codes, BE-23), the handler hands the actor and the
 * raw input to the service and returns its DTO. Controllers hold no logic, import no transformer
 * and never catch: every failure reaches `ProblemDetailsFilter`.
 *
 * Administrators only: every handler carries `JwtAuthGuard, PermissionGuard` (401 `ERP-AUTH-0004`
 * without a valid bearer) and declares NO permission code, so the guard admits any signed-in member
 * and the service's `assertAdministrator` answers 403 `ERP-AUTH-0005` to anyone without the
 * administrator flag. `@erp/contracts`' `ROUTE_GATES` declares the three screens `'admin'`;
 * `__tests__/route-gates.spec.ts` compares every handler with it.
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
import { ANNOUNCEMENTS_ROUTES } from '../announcements.routes.js';
import {
  announcementsListResponseSchema,
  announcementsParamsSchema,
  announcementsResponseSchema,
  createAnnouncementsBodySchema,
  exportAnnouncementsQuerySchema,
  listAnnouncementsQuerySchema,
  updateAnnouncementsBodySchema,
  type AnnouncementsListResponseDto,
  type AnnouncementsResponseDto,
} from '../dto/announcements.dto.js';
import { AnnouncementsService } from '../service/announcements.service.js';

@Controller(ANNOUNCEMENTS_ROUTES.base)
export class AnnouncementsController {
  constructor(private readonly service: AnnouncementsService) {}

  /** `GET /api/v1/announcements?limit&cursor&q&sort`: the BE-19 envelope. */
  @Get(ANNOUNCEMENTS_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List announcements (administrators only; keyset paging, one sort, q)',
    query: listAnnouncementsQuerySchema,
    responses: { [HTTP_STATUS.OK]: announcementsListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<AnnouncementsListResponseDto> {
    return this.service.list(user, query);
  }

  /**
   * `GET /api/v1/announcements/export?format&column&header&q&sort`: every row the list's query
   * matches as CSV, Excel, PDF or print rows, gated exactly like the list (the service asserts the
   * administrator flag first). `replyExport` sets the export's headers on the passthrough reply.
   */
  @Get(ANNOUNCEMENTS_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every announcement the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportAnnouncementsQuerySchema,
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

  /** `GET /api/v1/announcements/:id`: one announcement; a missing id is a 404. */
  @Get(ANNOUNCEMENTS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one announcement (administrators only)',
    params: announcementsParamsSchema,
    responses: { [HTTP_STATUS.OK]: announcementsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<AnnouncementsResponseDto> {
    return this.service.get(user, params);
  }

  /** `POST /api/v1/announcements`: 201 and the announcement. */
  @Post(ANNOUNCEMENTS_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create an announcement (administrators only)',
    body: createAnnouncementsBodySchema,
    responses: { [HTTP_STATUS.CREATED]: announcementsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<AnnouncementsResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/announcements/:id`: the announcement after the edit; a missing id is a 404. */
  @Patch(ANNOUNCEMENTS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Edit an announcement (administrators only)',
    params: announcementsParamsSchema,
    body: updateAnnouncementsBodySchema,
    responses: { [HTTP_STATUS.OK]: announcementsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<AnnouncementsResponseDto> {
    return this.service.update(user, params, body);
  }

  /** `DELETE /api/v1/announcements/:id`: 204 with no body; 404 for a missing id. */
  @Delete(ANNOUNCEMENTS_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete an announcement (administrators only)',
    params: announcementsParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

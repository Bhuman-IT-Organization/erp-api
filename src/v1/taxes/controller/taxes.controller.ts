/**
 * HTTP entry for `api/v1/taxes`: the six routes the Setup screens call (list, export, detail,
 * create, update and delete). Decorators bind the route, the guards and the API
 * documentation (`@ApiZod` names the zod schemas and the error codes, BE-23), the handler hands the
 * actor and the raw input to the service and returns its DTO. Controllers hold no logic, import no
 * transformer and never catch (the architecture block rejects a `try` here): every failure reaches
 * `ProblemDetailsFilter`.
 *
 * Administrators only (D-06, BE-25): every handler carries `JwtAuthGuard, PermissionGuard` (401
 * `ERP-AUTH-0004` without a valid bearer) and declares NO permission code, so the guard admits any
 * signed-in member and the service's `assertAdministrator` answers 403 `ERP-AUTH-0005` to anyone
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
import {
  createTaxesBodySchema,
  exportTaxesQuerySchema,
  listTaxesQuerySchema,
  taxesListResponseSchema,
  taxesParamsSchema,
  taxesResponseSchema,
  updateTaxesBodySchema,
  type TaxesListResponseDto,
  type TaxesResponseDto,
} from '../dto/taxes.dto.js';
import { TaxesService } from '../service/taxes.service.js';
import { TAXES_ROUTES } from '../taxes.routes.js';

@Controller(TAXES_ROUTES.base)
export class TaxesController {
  constructor(private readonly service: TaxesService) {}

  /** `GET /api/v1/taxes?limit&cursor&q&sort`: the BE-19 envelope, each row with its usage and default flag. */
  @Get(TAXES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'List taxes with their usage and default flag (administrators only; keyset paging, one sort, q)',
    query: listTaxesQuerySchema,
    responses: { [HTTP_STATUS.OK]: taxesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<TaxesListResponseDto> {
    return this.service.list(user, query);
  }

  /**
   * `GET /api/v1/taxes/export?format&column&header&q&sort`: every row the list's query
   * matches as CSV, Excel, PDF or print rows, gated exactly like the list (the service asserts the
   * administrator flag first). `replyExport` sets the export's headers on the passthrough reply.
   */
  @Get(TAXES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every tax the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportTaxesQuerySchema,
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

  /** `GET /api/v1/taxes/:id`: one tax with its usage and default flag; a missing id is a 404. */
  @Get(TAXES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one tax (administrators only)',
    params: taxesParamsSchema,
    responses: { [HTTP_STATUS.OK]: taxesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<TaxesResponseDto> {
    return this.service.get(user, params);
  }

  /**
   * `POST /api/v1/taxes`: 201 and the tax; a name another tax holds is a 409. Unkeyed, like identity's `POST members`
   * (BE-15's interceptor is built by the first module that needs one).
   */
  @Post(TAXES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a tax (administrators only); refused when another tax has the name',
    body: createTaxesBodySchema,
    responses: { [HTTP_STATUS.CREATED]: taxesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-TAXES-0003'],
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown): Promise<TaxesResponseDto> {
    return this.service.create(user, body);
  }

  /**
   * `PATCH /api/v1/taxes/:id`: the tax after the change; a missing id is a 404; Perfex's locked edit,
   * a duplicate name and a name or rate change of a default tax (D-21) are 409s.
   */
  @Patch(TAXES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Update a tax (administrators only); refused while locked, duplicated or a default tax',
    params: taxesParamsSchema,
    body: updateTaxesBodySchema,
    responses: { [HTTP_STATUS.OK]: taxesResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-TAXES-0002',
      'ERP-TAXES-0003',
      'ERP-TAXES-0004',
    ],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<TaxesResponseDto> {
    return this.service.update(user, params, body);
  }

  /**
   * `DELETE /api/v1/taxes/:id`: 204 with no body; 404 for a missing id; 409 while any referencing
   * column of `TAX_REFERENCES` still holds the id (D-07).
   */
  @Delete(TAXES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a tax (administrators only); refused while anything still uses it',
    params: taxesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-TAXES-0001',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

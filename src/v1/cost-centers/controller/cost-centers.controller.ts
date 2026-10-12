/**
 * HTTP entry for `api/v1/cost-centers`: the six routes the screens call (list, export, detail,
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
import { COST_CENTERS_ROUTES } from '../cost-centers.routes.js';
import {
  costCentersListResponseSchema,
  costCentersParamsSchema,
  costCentersResponseSchema,
  createCostCentersBodySchema,
  exportCostCentersQuerySchema,
  listCostCentersQuerySchema,
  updateCostCentersBodySchema,
  type CostCentersListResponseDto,
  type CostCentersResponseDto,
} from '../dto/cost-centers.dto.js';
import { CostCentersService } from '../service/cost-centers.service.js';

@Controller(COST_CENTERS_ROUTES.base)
export class CostCentersController {
  constructor(private readonly service: CostCentersService) {}

  /** `GET /api/v1/cost-centers?limit&cursor&q&sort`: the BE-19 envelope, each row with its usage. */
  @Get(COST_CENTERS_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List cost centers with their usage (administrators only; keyset paging, one sort, q)',
    query: listCostCentersQuerySchema,
    responses: { [HTTP_STATUS.OK]: costCentersListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<CostCentersListResponseDto> {
    return this.service.list(user, query);
  }

  /**
   * `GET /api/v1/cost-centers/export?format&column&header&q&sort`: every row the list's query
   * matches as CSV, Excel, PDF or print rows, gated exactly like the list (the service asserts the
   * administrator flag first). `replyExport` sets the export's headers on the passthrough reply.
   */
  @Get(COST_CENTERS_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every cost center the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportCostCentersQuerySchema,
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

  /** `GET /api/v1/cost-centers/:id`: one cost center with its usage; a missing id is a 404. */
  @Get(COST_CENTERS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one cost center (administrators only)',
    params: costCentersParamsSchema,
    responses: { [HTTP_STATUS.OK]: costCentersResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<CostCentersResponseDto> {
    return this.service.get(user, params);
  }

  /**
   * `POST /api/v1/cost-centers`: 201 and the cost center; a name another cost center holds is
   * accepted, as in Perfex. Unkeyed, like the other Setup lists (BE-15's interceptor is built by the
   * first module that needs one).
   */
  @Post(COST_CENTERS_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a cost center (administrators only)',
    body: createCostCentersBodySchema,
    responses: { [HTTP_STATUS.CREATED]: costCentersResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<CostCentersResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/cost-centers/:id`: the cost center after the rename; a missing id is a 404. */
  @Patch(COST_CENTERS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Rename a cost center (administrators only)',
    params: costCentersParamsSchema,
    body: updateCostCentersBodySchema,
    responses: { [HTTP_STATUS.OK]: costCentersResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<CostCentersResponseDto> {
    return this.service.update(user, params, body);
  }

  /**
   * `DELETE /api/v1/cost-centers/:id`: 204 with no body; 404 for a missing id; 409 while any
   * referencing column of `COST_CENTER_REFERENCES` still holds the cost center (D-07, D-28).
   */
  @Delete(COST_CENTERS_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a cost center (administrators only); refused while anything still uses it',
    params: costCentersParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-COSTCENTERS-0001',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

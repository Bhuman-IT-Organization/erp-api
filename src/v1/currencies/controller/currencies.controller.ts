/**
 * HTTP entry for `api/v1/currencies`: the seven routes the screens call (list, export, detail,
 * create, update, make-base and delete). Decorators bind the route, the guards and the API
 * documentation (`@ApiZod` names the zod schemas and the error codes, BE-23), the handler hands the
 * actor and the raw input to the service and returns its DTO. Controllers hold no logic, import no
 * transformer and never catch (the architecture block rejects a `try` here): every failure reaches
 * `ProblemDetailsFilter`.
 *
 * Administrators only (D-06, D-38, BE-25): every handler carries `JwtAuthGuard, PermissionGuard`
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
import { CURRENCIES_ROUTES } from '../currencies.routes.js';
import {
  createCurrenciesBodySchema,
  currenciesBaseBodySchema,
  currenciesBaseResponseSchema,
  currenciesListResponseSchema,
  currenciesParamsSchema,
  currenciesResponseSchema,
  exportCurrenciesQuerySchema,
  listCurrenciesQuerySchema,
  updateCurrenciesBodySchema,
  type CurrenciesBaseResponseDto,
  type CurrenciesListResponseDto,
  type CurrenciesResponseDto,
} from '../dto/currencies.dto.js';
import { CurrenciesService } from '../service/currencies.service.js';

@Controller(CURRENCIES_ROUTES.base)
export class CurrenciesController {
  constructor(private readonly service: CurrenciesService) {}

  /** `GET /api/v1/currencies?limit&cursor&q&sort`: the BE-19 envelope, each row with every count. */
  @Get(CURRENCIES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List currencies with their usage (administrators only; keyset paging, one sort, q)',
    query: listCurrenciesQuerySchema,
    responses: { [HTTP_STATUS.OK]: currenciesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<CurrenciesListResponseDto> {
    return this.service.list(user, query);
  }

  /** `GET /api/v1/currencies/export?format&column&header&q&sort`: CSV, Excel, PDF or print rows. */
  @Get(CURRENCIES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every currency the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportCurrenciesQuerySchema,
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

  /** `GET /api/v1/currencies/:id`: one currency with every count; a missing id is a 404. */
  @Get(CURRENCIES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one currency (administrators only)',
    params: currenciesParamsSchema,
    responses: { [HTTP_STATUS.OK]: currenciesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<CurrenciesResponseDto> {
    return this.service.get(user, params);
  }

  /** `POST /api/v1/currencies`: 201 and the currency; a code another currency holds is accepted. */
  @Post(CURRENCIES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a currency (administrators only)',
    body: createCurrenciesBodySchema,
    responses: { [HTTP_STATUS.CREATED]: currenciesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<CurrenciesResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/currencies/:id`: the currency after all five fields are rewritten; a missing id is a 404. */
  @Patch(CURRENCIES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Update a currency, all five fields (administrators only); the code is locked while the currency is in use',
    params: currenciesParamsSchema,
    body: updateCurrenciesBodySchema,
    responses: { [HTTP_STATUS.OK]: currenciesResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-CURRENCIES-0005',
    ],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<CurrenciesResponseDto> {
    return this.service.update(user, params, body);
  }

  /**
   * `PATCH /api/v1/currencies/:id/base`: Perfex's make-base link as one call (D-39), `{}` in,
   * `{ id, isBase: true }` out; refused while the current base has transactions.
   */
  @Patch(CURRENCIES_ROUTES.makeBase)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Make a currency the base currency (administrators only); refused while the current base has transactions',
    params: currenciesParamsSchema,
    body: currenciesBaseBodySchema,
    responses: { [HTTP_STATUS.OK]: currenciesBaseResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-CURRENCIES-0004',
    ],
  })
  makeBase(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<CurrenciesBaseResponseDto> {
    return this.service.makeBase(user, params, body);
  }

  /**
   * `DELETE /api/v1/currencies/:id`: 204 with no body; 404 for a missing id; 409
   * `ERP-CURRENCIES-0001` while a delete-counting reference holds it (D-40), `0002` for the base,
   * `0003` while another module's registered counter answers more than 0 (D-41).
   */
  @Delete(CURRENCIES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Delete a currency (administrators only); refused while in use, for the base, or while another module uses it',
    params: currenciesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-CURRENCIES-0001',
      'ERP-CURRENCIES-0002',
      'ERP-CURRENCIES-0003',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

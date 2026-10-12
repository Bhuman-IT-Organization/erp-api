/**
 * HTTP entry for `api/v1/expense-categories`: the six routes the Setup screens call (list, export,
 * detail, create, update and delete). Decorators bind the route, the guards and the API
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
  createExpenseCategoriesBodySchema,
  expenseCategoriesListResponseSchema,
  expenseCategoriesParamsSchema,
  expenseCategoriesResponseSchema,
  exportExpenseCategoriesQuerySchema,
  listExpenseCategoriesQuerySchema,
  updateExpenseCategoriesBodySchema,
  type ExpenseCategoriesListResponseDto,
  type ExpenseCategoriesResponseDto,
} from '../dto/expense-categories.dto.js';
import { EXPENSE_CATEGORIES_ROUTES } from '../expense-categories.routes.js';
import { ExpenseCategoriesService } from '../service/expense-categories.service.js';

@Controller(EXPENSE_CATEGORIES_ROUTES.base)
export class ExpenseCategoriesController {
  constructor(private readonly service: ExpenseCategoriesService) {}

  /** `GET /api/v1/expense-categories?limit&cursor&q&sort`: the BE-19 envelope, each row with its usage counts. */
  @Get(EXPENSE_CATEGORIES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'List expense categories with their usage counts (administrators only; keyset paging, one sort, q)',
    query: listExpenseCategoriesQuerySchema,
    responses: { [HTTP_STATUS.OK]: expenseCategoriesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<ExpenseCategoriesListResponseDto> {
    return this.service.list(user, query);
  }

  /**
   * `GET /api/v1/expense-categories/export?format&column&header&q&sort`: every row the list's query
   * matches as CSV, Excel, PDF or print rows, gated exactly like the list (the service asserts the
   * administrator flag first). `replyExport` sets the export's headers on the passthrough reply.
   */
  @Get(EXPENSE_CATEGORIES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every expense category the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportExpenseCategoriesQuerySchema,
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

  /** `GET /api/v1/expense-categories/:id`: one category; a missing id is a 404. */
  @Get(EXPENSE_CATEGORIES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one expense category (administrators only)',
    params: expenseCategoriesParamsSchema,
    responses: { [HTTP_STATUS.OK]: expenseCategoriesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<ExpenseCategoriesResponseDto> {
    return this.service.get(user, params);
  }

  /**
   * `POST /api/v1/expense-categories`: 201 and the category. Unkeyed, like identity's `POST members`
   * (BE-15's interceptor is built by the first module that needs one).
   */
  @Post(EXPENSE_CATEGORIES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create an expense category (administrators only)',
    body: createExpenseCategoriesBodySchema,
    responses: { [HTTP_STATUS.CREATED]: expenseCategoriesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<ExpenseCategoriesResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/expense-categories/:id`: the category after the change; a missing id is a 404. */
  @Patch(EXPENSE_CATEGORIES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Update an expense category (administrators only)',
    params: expenseCategoriesParamsSchema,
    body: updateExpenseCategoriesBodySchema,
    responses: { [HTTP_STATUS.OK]: expenseCategoriesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<ExpenseCategoriesResponseDto> {
    return this.service.update(user, params, body);
  }

  /**
   * `DELETE /api/v1/expense-categories/:id`: 204 with no body; 404 for a missing id; 409 while an
   * expense, an accounting mapping or a petty cash advance still uses the category (D-07, D-15).
   */
  @Delete(EXPENSE_CATEGORIES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Delete an expense category (administrators only); refused while anything still uses it',
    params: expenseCategoriesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-EXPENSECATEGORIES-0001',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

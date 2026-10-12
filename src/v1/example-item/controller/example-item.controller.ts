/**
 * HTTP entry for `api/v1/example-item`: exactly the five routes the frontend template's screens
 * call (its `EXAMPLE_ITEM_ENDPOINTS`). Decorators bind the route, the guards and the API documentation (`@ApiZod`
 * names the zod schemas and the error codes — BE-23), the handler hands the raw input to the
 * service and returns its DTO. Controllers hold no logic, import no transformer and never catch
 * (the architecture block rejects a `try` here): every failure reaches `ProblemDetailsFilter`.
 *
 * Every handler names its guards and permission (T-2-12): `JwtAuthGuard` answers 401
 * `ERP-AUTH-0004` without a valid bearer, `PermissionGuard` answers 403 `ERP-AUTH-0005` without
 * the code; `__tests__/route-gates.spec.ts` classifies every method. The reads and the export are
 * the ADR-0033 decision 5 read: `@PermissionsAny(view, viewOwn)` and `@Scope()`, the scope only
 * forwarded — the repository filters (T-3.1-11). The writes need `create` and `edit`.
 *
 * The static `export` segment is declared before `:id`; find-my-way serves it first anyway.
 */
import {
  Body,
  Controller,
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
import {
  Permissions,
  PermissionsAny,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { Scope, type ReadScope } from '../../../shared/http/decorators/scope.decorator.js';
import { replyExport, type ExportFile } from '../../../shared/http/export.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import {
  createExampleItemBodySchema,
  exampleItemListResponseSchema,
  exampleItemParamsSchema,
  exampleItemResponseSchema,
  exportExampleItemsQuerySchema,
  listExampleItemsQuerySchema,
  updateExampleItemBodySchema,
  type ExampleItemListResponseDto,
  type ExampleItemResponseDto,
} from '../dto/example-item.dto.js';
import { EXAMPLE_ITEM_PERMISSIONS, EXAMPLE_ITEM_ROUTES } from '../example-item.routes.js';
import { ExampleItemService } from '../service/example-item.service.js';

@Controller(EXAMPLE_ITEM_ROUTES.base)
export class ExampleItemController {
  constructor(private readonly service: ExampleItemService) {}

  /** `GET /api/v1/example-item?limit&cursor&q&sort` → the BE-19 envelope, narrowed under `viewOwn`. */
  @Get(EXAMPLE_ITEM_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @PermissionsAny(EXAMPLE_ITEM_PERMISSIONS.view, EXAMPLE_ITEM_PERMISSIONS.viewOwn)
  @ApiZod({
    summary: 'List ExampleItem records (keyset paging, one sort, q)',
    query: listExampleItemsQuerySchema,
    responses: { [HTTP_STATUS.OK]: exampleItemListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @Query() query: unknown,
    @Scope() scope: ReadScope,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExampleItemListResponseDto> {
    return this.service.list(query, scope, user.staffId);
  }

  /**
   * `GET /api/v1/example-item/export?format&column&header&key&q&sort`: every row the list's query
   * matches (or only the ticked ones) as CSV, Excel, PDF or print rows, gated exactly like the
   * list. The service answers the export; `replyExport` sets its headers on the passthrough reply.
   */
  @Get(EXAMPLE_ITEM_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @PermissionsAny(EXAMPLE_ITEM_PERMISSIONS.view, EXAMPLE_ITEM_PERMISSIONS.viewOwn)
  @ApiZod({
    summary:
      'Export every ExampleItem record the list query matches as CSV, Excel, PDF or print rows',
    query: exportExampleItemsQuerySchema,
    produces: 'export',
    responses: {},
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
    headers: ['Content-Disposition', 'Cache-Control'],
  })
  async exportCsv(
    @Query() query: unknown,
    @Scope() scope: ReadScope,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExportFile['body']> {
    return replyExport(reply, await this.service.exportCsv(query, scope, user.staffId));
  }

  /** `GET /api/v1/example-item/:id` → one record; missing or hidden by `viewOwn` is the same 404. */
  @Get(EXAMPLE_ITEM_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @PermissionsAny(EXAMPLE_ITEM_PERMISSIONS.view, EXAMPLE_ITEM_PERMISSIONS.viewOwn)
  @ApiZod({
    summary: 'Read one ExampleItem record',
    params: exampleItemParamsSchema,
    responses: { [HTTP_STATUS.OK]: exampleItemResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @Param() params: unknown,
    @Scope() scope: ReadScope,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ExampleItemResponseDto> {
    return this.service.get(params, scope, user.staffId);
  }

  /**
   * `POST /api/v1/example-item` → 201 and the record; the caller becomes its owner. Unkeyed, like
   * identity's `POST members` (BE-15's interceptor is built by the first module that needs one).
   */
  @Post(EXAMPLE_ITEM_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(EXAMPLE_ITEM_PERMISSIONS.create)
  @ApiZod({
    summary: 'Create an ExampleItem record',
    body: createExampleItemBodySchema,
    responses: { [HTTP_STATUS.CREATED]: exampleItemResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<ExampleItemResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/example-item/:id` → the record after the change; a missing id is a 404. */
  @Patch(EXAMPLE_ITEM_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(EXAMPLE_ITEM_PERMISSIONS.edit)
  @ApiZod({
    summary: 'Update an ExampleItem record',
    params: exampleItemParamsSchema,
    body: updateExampleItemBodySchema,
    responses: { [HTTP_STATUS.OK]: exampleItemResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(@Param() params: unknown, @Body() body: unknown): Promise<ExampleItemResponseDto> {
    return this.service.update(params, body);
  }
}

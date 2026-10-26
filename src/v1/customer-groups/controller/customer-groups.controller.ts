/**
 * HTTP entry for `api/v1/customer-groups`: the five routes the screens call (list, detail,
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
  UseGuards,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import { CUSTOMER_GROUPS_ROUTES } from '../customer-groups.routes.js';
import {
  createCustomerGroupsBodySchema,
  customerGroupsListResponseSchema,
  customerGroupsParamsSchema,
  customerGroupsResponseSchema,
  listCustomerGroupsQuerySchema,
  updateCustomerGroupsBodySchema,
  type CustomerGroupsListResponseDto,
  type CustomerGroupsResponseDto,
} from '../dto/customer-groups.dto.js';
import { CustomerGroupsService } from '../service/customer-groups.service.js';

@Controller(CUSTOMER_GROUPS_ROUTES.base)
export class CustomerGroupsController {
  constructor(private readonly service: CustomerGroupsService) {}

  /** `GET /api/v1/customer-groups?limit&cursor&q&sort`: the BE-19 envelope. */
  @Get(CUSTOMER_GROUPS_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List customer groups (administrators only; keyset paging, one sort, q)',
    query: listCustomerGroupsQuerySchema,
    responses: { [HTTP_STATUS.OK]: customerGroupsListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<CustomerGroupsListResponseDto> {
    return this.service.list(user, query);
  }

  /** `GET /api/v1/customer-groups/:id`: one customer group; a missing id is a 404. */
  @Get(CUSTOMER_GROUPS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one customer group (administrators only)',
    params: customerGroupsParamsSchema,
    responses: { [HTTP_STATUS.OK]: customerGroupsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<CustomerGroupsResponseDto> {
    return this.service.get(user, params);
  }

  /** `POST /api/v1/customer-groups`: 201 and the customer group. */
  @Post(CUSTOMER_GROUPS_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a customer group (administrators only)',
    body: createCustomerGroupsBodySchema,
    responses: { [HTTP_STATUS.CREATED]: customerGroupsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<CustomerGroupsResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/customer-groups/:id`: the group after the rename; a missing id is a 404. */
  @Patch(CUSTOMER_GROUPS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Rename a customer group (administrators only)',
    params: customerGroupsParamsSchema,
    body: updateCustomerGroupsBodySchema,
    responses: { [HTTP_STATUS.OK]: customerGroupsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<CustomerGroupsResponseDto> {
    return this.service.update(user, params, body);
  }

  /**
   * `DELETE /api/v1/customer-groups/:id`: 204 with no body; 404 for a missing id. The group's
   * rows in `tblcustomer_groups` are removed in the same transaction.
   */
  @Delete(CUSTOMER_GROUPS_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a customer group and its customer links (administrators only)',
    params: customerGroupsParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

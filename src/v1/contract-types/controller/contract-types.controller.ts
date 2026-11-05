/**
 * HTTP entry for `api/v1/contract-types`: the six routes the screens call (list, export, detail,
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
import { CONTRACT_TYPES_ROUTES } from '../contract-types.routes.js';
import {
  contractTypesListResponseSchema,
  contractTypesParamsSchema,
  contractTypesResponseSchema,
  createContractTypesBodySchema,
  exportContractTypesQuerySchema,
  listContractTypesQuerySchema,
  updateContractTypesBodySchema,
  type ContractTypesListResponseDto,
  type ContractTypesResponseDto,
} from '../dto/contract-types.dto.js';
import { ContractTypesService } from '../service/contract-types.service.js';

@Controller(CONTRACT_TYPES_ROUTES.base)
export class ContractTypesController {
  constructor(private readonly service: ContractTypesService) {}

  /** `GET /api/v1/contract-types?limit&cursor&q&sort`: the BE-19 envelope, each row with its usage. */
  @Get(CONTRACT_TYPES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'List contract types with their usage (administrators only; keyset paging, one sort, q)',
    query: listContractTypesQuerySchema,
    responses: { [HTTP_STATUS.OK]: contractTypesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<ContractTypesListResponseDto> {
    return this.service.list(user, query);
  }

  /**
   * `GET /api/v1/contract-types/export?format&column&header&q&sort`: every row the list's query
   * matches as CSV, Excel, PDF or print rows, gated exactly like the list (the service asserts the
   * administrator flag first). `replyExport` sets the export's headers on the passthrough reply.
   */
  @Get(CONTRACT_TYPES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every contract type the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportContractTypesQuerySchema,
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

  /** `GET /api/v1/contract-types/:id`: one contract type with its usage; a missing id is a 404. */
  @Get(CONTRACT_TYPES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one contract type (administrators only)',
    params: contractTypesParamsSchema,
    responses: { [HTTP_STATUS.OK]: contractTypesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<ContractTypesResponseDto> {
    return this.service.get(user, params);
  }

  /**
   * `POST /api/v1/contract-types`: 201 and the contract type; a name another contract type holds is
   * accepted, as in Perfex. Unkeyed, like the other Setup lists (BE-15's interceptor is built by the
   * first module that needs one).
   */
  @Post(CONTRACT_TYPES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a contract type (administrators only)',
    body: createContractTypesBodySchema,
    responses: { [HTTP_STATUS.CREATED]: contractTypesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<ContractTypesResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/contract-types/:id`: the contract type after the rename; a missing id is a 404. */
  @Patch(CONTRACT_TYPES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Rename a contract type (administrators only)',
    params: contractTypesParamsSchema,
    body: updateContractTypesBodySchema,
    responses: { [HTTP_STATUS.OK]: contractTypesResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<ContractTypesResponseDto> {
    return this.service.update(user, params, body);
  }

  /**
   * `DELETE /api/v1/contract-types/:id`: 204 with no body; 404 for a missing id; 409 while any
   * referencing column of `CONTRACT_TYPE_REFERENCES` still holds the contract type (D-07, D-28).
   */
  @Delete(CONTRACT_TYPES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a contract type (administrators only); refused while anything still uses it',
    params: contractTypesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-CONTRACTTYPES-0001',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

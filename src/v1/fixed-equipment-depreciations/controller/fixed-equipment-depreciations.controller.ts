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
  createFixedEquipmentDepreciationsBodySchema,
  exportFixedEquipmentDepreciationsQuerySchema,
  fixedEquipmentDepreciationsListResponseSchema,
  fixedEquipmentDepreciationsParamsSchema,
  fixedEquipmentDepreciationsResponseSchema,
  listFixedEquipmentDepreciationsQuerySchema,
  updateFixedEquipmentDepreciationsBodySchema,
  type FixedEquipmentDepreciationsListResponseDto,
  type FixedEquipmentDepreciationsResponseDto,
} from '../dto/fixed-equipment-depreciations.dto.js';
import {
  FIXED_EQUIPMENT_DEPRECIATIONS_PERMISSIONS,
  FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES,
} from '../fixed-equipment-depreciations.routes.js';
import { FixedEquipmentDepreciationsService } from '../service/fixed-equipment-depreciations.service.js';

const { view, viewOwn, create, edit, delete: remove } = FIXED_EQUIPMENT_DEPRECIATIONS_PERMISSIONS;

/**
 * Every handler names its guards and permission: `JwtAuthGuard` answers 401 `ERP-AUTH-0004`
 * without a valid bearer, `PermissionGuard` answers 403 `ERP-AUTH-0005` without the code;
 * `__tests__/route-gates.spec.ts` classifies every method. The reads and the export are the
 * ADR-0033 decision 5 read: `@PermissionsAny(view, viewOwn)` and `@Scope()`, the scope only
 * forwarded (the repository filters on `creator_id`). The writes need `create`, `edit` and `delete`.
 * Controllers hold no logic and never catch.
 */
@Controller(FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES.base)
export class FixedEquipmentDepreciationsController {
  constructor(private readonly service: FixedEquipmentDepreciationsService) {}

  @Get(FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @PermissionsAny(view, viewOwn)
  @ApiZod({
    summary:
      'List depreciations (keyset paging, one sort, q); narrowed to the own rows under viewOwn',
    query: listFixedEquipmentDepreciationsQuerySchema,
    responses: { [HTTP_STATUS.OK]: fixedEquipmentDepreciationsListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() scope: ReadScope,
    @Query() query: unknown,
  ): Promise<FixedEquipmentDepreciationsListResponseDto> {
    return this.service.list(query, scope, user.staffId);
  }

  @Get(FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @PermissionsAny(view, viewOwn)
  @ApiZod({
    summary: 'Export every depreciation the list query matches as CSV, Excel, PDF or print rows',
    query: exportFixedEquipmentDepreciationsQuerySchema,
    produces: 'export',
    responses: {},
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
    headers: ['Content-Disposition', 'Cache-Control'],
  })
  async exportCsv(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() scope: ReadScope,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExportFile['body']> {
    return replyExport(reply, await this.service.exportCsv(query, scope, user.staffId));
  }

  @Get(FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @PermissionsAny(view, viewOwn)
  @ApiZod({
    summary: 'Read one depreciation; missing or hidden by viewOwn is the same 404',
    params: fixedEquipmentDepreciationsParamsSchema,
    responses: { [HTTP_STATUS.OK]: fixedEquipmentDepreciationsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Scope() scope: ReadScope,
    @Param() params: unknown,
  ): Promise<FixedEquipmentDepreciationsResponseDto> {
    return this.service.get(params, scope, user.staffId);
  }

  @Post(FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(create)
  @ApiZod({
    summary: 'Create a depreciation; the creator is the signed-in member',
    body: createFixedEquipmentDepreciationsBodySchema,
    responses: { [HTTP_STATUS.CREATED]: fixedEquipmentDepreciationsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<FixedEquipmentDepreciationsResponseDto> {
    return this.service.create(user, body);
  }

  @Patch(FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(edit)
  @ApiZod({
    summary: 'Change a depreciation’s name and number of months',
    params: fixedEquipmentDepreciationsParamsSchema,
    body: updateFixedEquipmentDepreciationsBodySchema,
    responses: { [HTTP_STATUS.OK]: fixedEquipmentDepreciationsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<FixedEquipmentDepreciationsResponseDto> {
    return this.service.update(params, body);
  }

  @Delete(FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(remove)
  @ApiZod({
    summary: 'Delete a depreciation (allowed while assets use it, as in Perfex)',
    params: fixedEquipmentDepreciationsParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  remove(@Param() params: unknown): Promise<void> {
    return this.service.remove(params);
  }
}

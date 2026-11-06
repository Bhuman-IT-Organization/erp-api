import { FIXED_EQUIPMENT_SETTINGS_CODES } from '@erp/contracts';
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
  PermissionsAny,
  PermissionsRead,
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
import { FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES } from '../fixed-equipment-depreciations.routes.js';
import { FixedEquipmentDepreciationsService } from '../service/fixed-equipment-depreciations.service.js';

/** Who may do what on this tab: the depreciation settings group and the four item groups. */
const codes = FIXED_EQUIPMENT_SETTINGS_CODES.depreciation;

/**
 * Every handler names its guards and permission: `JwtAuthGuard` answers 401 `ERP-AUTH-0004`
 * without a valid bearer, `PermissionGuard` answers 403 `ERP-AUTH-0005` without the code;
 * `__tests__/route-gates.spec.ts` classifies every method. The codes are the tab's five groups
 * (`FIXED_EQUIPMENT_SETTINGS_CODES.depreciation`: the depreciation settings group and the assets,
 * licenses, accessories and consumables groups). The reads and the export are
 * `@PermissionsRead(codes.read)` and `@Scope()`: any group's full view reads every row, else any
 * group's view own reads the member's own, and the scope is only forwarded (the repository filters
 * on `creator_id`). Each write needs that action's code in any of the five groups. Controllers hold
 * no logic and never catch.
 */
@Controller(FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES.base)
export class FixedEquipmentDepreciationsController {
  constructor(private readonly service: FixedEquipmentDepreciationsService) {}

  @Get(FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @PermissionsRead(codes.read)
  @ApiZod({
    summary:
      'List depreciations (keyset paging, one sort, q); narrowed to the own rows under a view own',
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
  @PermissionsRead(codes.read)
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
  @PermissionsRead(codes.read)
  @ApiZod({
    summary: 'Read one depreciation; missing or hidden by a view own is the same 404',
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
  @PermissionsAny(...codes.create)
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
  @PermissionsAny(...codes.edit)
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
  @PermissionsAny(...codes.delete)
  @ApiZod({
    summary:
      'Delete a depreciation; refused with 409 while an asset model or an asset uses it, or when its use cannot be checked',
    params: fixedEquipmentDepreciationsParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-FIXEDEQUIPMENTDEPRECIATIONS-0001',
      'ERP-FIXEDEQUIPMENTDEPRECIATIONS-0002',
    ],
  })
  remove(@Param() params: unknown): Promise<void> {
    return this.service.remove(params);
  }
}

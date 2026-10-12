/**
 * HTTP entry for `api/v1/departments`: the five read routes (list, export, the manager and parent
 * pickers, detail). There is no create, update or delete: `tbldepartments` is Perfex's table and
 * Perfex's `admin/departments` screen is the only writer, so Node only reads it. Decorators bind the
 * route, the guards and the API documentation (`@ApiZod` names the zod schemas and the error codes,
 * BE-23), the handler hands the actor and the raw input to the service and returns its DTO.
 * Controllers hold no logic, import no transformer and never catch (the architecture block rejects
 * a `try` here): every failure reaches `ProblemDetailsFilter`.
 *
 * Administrators only (D-06, D-45, BE-25): every handler carries `JwtAuthGuard, PermissionGuard`
 * (401 `ERP-AUTH-0004` without a valid bearer) and declares NO permission code, so the guard admits
 * any signed-in member and the service's `assertAdministrator` answers 403 `ERP-AUTH-0005` to anyone
 * without the administrator flag.
 *
 * The static `export`, `managers` and `options` segments are declared before `:id`; find-my-way
 * serves them first anyway.
 */
import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { replyExport, type ExportFile } from '../../../shared/http/export.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import { DEPARTMENTS_ROUTES } from '../departments.routes.js';
import {
  departmentsListResponseSchema,
  departmentsManagersResponseSchema,
  departmentsOptionsResponseSchema,
  departmentsParamsSchema,
  departmentsResponseSchema,
  exportDepartmentsQuerySchema,
  listDepartmentsQuerySchema,
  type DepartmentsListResponseDto,
  type DepartmentsManagersResponseDto,
  type DepartmentsOptionsResponseDto,
  type DepartmentsResponseDto,
} from '../dto/departments.dto.js';
import { DepartmentsService } from '../service/departments.service.js';

@Controller(DEPARTMENTS_ROUTES.base)
export class DepartmentsController {
  constructor(private readonly service: DepartmentsService) {}

  /** `GET /api/v1/departments?limit&cursor&q&sort`: the BE-19 envelope, each row with every count. */
  @Get(DEPARTMENTS_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List departments with their usage (administrators only; keyset paging, one sort, q)',
    query: listDepartmentsQuerySchema,
    responses: { [HTTP_STATUS.OK]: departmentsListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<DepartmentsListResponseDto> {
    return this.service.list(user, query);
  }

  /** `GET /api/v1/departments/export?format&column&header&q&sort`: CSV, Excel, PDF or print rows. */
  @Get(DEPARTMENTS_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every department the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportDepartmentsQuerySchema,
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

  /** `GET /api/v1/departments/managers`: the staff directory's active members (D-49). */
  @Get(DEPARTMENTS_ROUTES.managers)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List the active staff members a department may show as manager (administrators only)',
    responses: { [HTTP_STATUS.OK]: departmentsManagersResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  managers(@CurrentUser() user: AuthenticatedUser): Promise<DepartmentsManagersResponseDto> {
    return this.service.managers(user);
  }

  /** `GET /api/v1/departments/options`: every department with its parent (D-49). */
  @Get(DEPARTMENTS_ROUTES.options)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List every department with its parent (administrators only)',
    responses: { [HTTP_STATUS.OK]: departmentsOptionsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  options(@CurrentUser() user: AuthenticatedUser): Promise<DepartmentsOptionsResponseDto> {
    return this.service.options(user);
  }

  /** `GET /api/v1/departments/:id`: one department with every count; a missing id is a 404. */
  @Get(DEPARTMENTS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one department (administrators only)',
    params: departmentsParamsSchema,
    responses: { [HTTP_STATUS.OK]: departmentsResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<DepartmentsResponseDto> {
    return this.service.get(user, params);
  }
}

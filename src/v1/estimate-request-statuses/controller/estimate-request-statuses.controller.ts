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
import { ESTIMATE_REQUEST_STATUSES_ROUTES } from '../estimate-request-statuses.routes.js';
import {
  createEstimateRequestStatusBodySchema,
  estimateRequestStatusResponseSchema,
  estimateRequestStatusesListResponseSchema,
  estimateRequestStatusesParamsSchema,
  estimateRequestStatusesListQuerySchema,
  exportEstimateRequestStatusesQuerySchema,
  updateEstimateRequestStatusBodySchema,
  type EstimateRequestStatusResponseDto,
  type EstimateRequestStatusesListResponseDto,
} from '../dto/estimate-request-statuses.dto.js';
import { EstimateRequestStatusesService } from '../service/estimate-request-statuses.service.js';

@Controller(ESTIMATE_REQUEST_STATUSES_ROUTES.base)
export class EstimateRequestStatusesController {
  constructor(private readonly service: EstimateRequestStatusesService) {}

  @Get(ESTIMATE_REQUEST_STATUSES_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List estimate request statuses (administrators only)',
    query: estimateRequestStatusesListQuerySchema,
    responses: { [HTTP_STATUS.OK]: estimateRequestStatusesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<EstimateRequestStatusesListResponseDto> {
    return this.service.list(user, query);
  }

  @Get(ESTIMATE_REQUEST_STATUSES_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Export estimate request statuses (administrators only)',
    query: exportEstimateRequestStatusesQuerySchema,
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

  @Get(ESTIMATE_REQUEST_STATUSES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one estimate request status (administrators only)',
    params: estimateRequestStatusesParamsSchema,
    responses: { [HTTP_STATUS.OK]: estimateRequestStatusResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<EstimateRequestStatusResponseDto> {
    return this.service.get(user, params);
  }

  @Post(ESTIMATE_REQUEST_STATUSES_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create an estimate request status (administrators only)',
    body: createEstimateRequestStatusBodySchema,
    responses: { [HTTP_STATUS.CREATED]: estimateRequestStatusResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<EstimateRequestStatusResponseDto> {
    return this.service.create(user, body);
  }

  @Patch(ESTIMATE_REQUEST_STATUSES_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Update an estimate request status (administrators only)',
    params: estimateRequestStatusesParamsSchema,
    body: updateEstimateRequestStatusBodySchema,
    responses: { [HTTP_STATUS.OK]: estimateRequestStatusResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<EstimateRequestStatusResponseDto> {
    return this.service.update(user, params, body);
  }

  @Delete(ESTIMATE_REQUEST_STATUSES_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete an estimate request status (administrators only)',
    params: estimateRequestStatusesParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-ESTIMATEREQUESTSTATUSES-0001',
      'ERP-ESTIMATEREQUESTSTATUSES-0002',
      'ERP-ESTIMATEREQUESTSTATUSES-0003',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

import { HTTP_STATUS } from '../../../shared/http/status.js';
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
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { replyExport, type ExportFile } from '../../../shared/http/export.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import {
  createPredefinedReplyBodySchema,
  listPredefinedRepliesQuerySchema,
  predefinedRepliesListResponseSchema,
  predefinedReplyParamsSchema,
  predefinedReplyResponseSchema,
  updatePredefinedReplyBodySchema,
} from '../dto/predefined-replies.dto.js';
import { PREDEFINED_REPLIES_ROUTES } from '../predefined-replies.routes.js';
import { exportPredefinedRepliesQuerySchema } from '../dto/predefined-replies.dto.js';
import { PredefinedRepliesService } from '../service/predefined-replies.service.js';

@ApiTags('Predefined Replies')
@Controller('predefined-replies')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class PredefinedRepliesController {
  constructor(private readonly service: PredefinedRepliesService) {}

  @Get()
  @ApiZod({
    summary: 'List predefined replies',
    query: listPredefinedRepliesQuerySchema,
    responses: {
      200: predefinedRepliesListResponseSchema,
    },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: unknown) {
    return this.service.list(user, query);
  }

  @Get(PREDEFINED_REPLIES_ROUTES.export)
  @ApiZod({
    summary: 'Export predefined replies as CSV, Excel, PDF or print rows (administrators only)',
    query: exportPredefinedRepliesQuerySchema,
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

  @Get(':id')
  @ApiZod({
    summary: 'Get a predefined reply',
    params: predefinedReplyParamsSchema,
    responses: {
      200: predefinedReplyResponseSchema,
    },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown) {
    return this.service.get(user, params);
  }

  @Post()
  @ApiZod({
    summary: 'Create a predefined reply',
    body: createPredefinedReplyBodySchema,
    responses: {
      201: predefinedReplyResponseSchema,
    },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    return this.service.create(user, body);
  }

  @Patch(':id')
  @ApiZod({
    summary: 'Update a predefined reply',
    params: predefinedReplyParamsSchema,
    body: updatePredefinedReplyBodySchema,
    responses: {
      200: predefinedReplyResponseSchema,
    },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown, @Body() body: unknown) {
    return this.service.update(user, params, body);
  }

  @Delete(':id')
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @ApiZod({
    summary: 'Delete a predefined reply',
    params: predefinedReplyParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    await this.service.remove(user, params);
  }
}

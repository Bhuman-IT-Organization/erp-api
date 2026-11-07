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
import { Permissions } from '../../../shared/http/decorators/permissions.decorator.js';
import { replyExport, type ExportFile } from '../../../shared/http/export.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import {
  KNOWLEDGE_BASE_GROUPS_PERMISSIONS,
  KNOWLEDGE_BASE_GROUPS_ROUTES,
} from '../knowledge-base-groups.routes.js';
import {
  createKnowledgeBaseGroupBodySchema,
  exportKnowledgeBaseGroupsQuerySchema,
  knowledgeBaseGroupListResponseSchema,
  knowledgeBaseGroupParamsSchema,
  knowledgeBaseGroupResponseSchema,
  listKnowledgeBaseGroupsQuerySchema,
  updateKnowledgeBaseGroupBodySchema,
  type KnowledgeBaseGroupListResponseDto,
  type KnowledgeBaseGroupResponseDto,
} from '../dto/knowledge-base-groups.dto.js';
import { KnowledgeBaseGroupsService } from '../service/knowledge-base-groups.service.js';

@Controller(KNOWLEDGE_BASE_GROUPS_ROUTES.base)
export class KnowledgeBaseGroupsController {
  constructor(private readonly service: KnowledgeBaseGroupsService) {}

  @Get(KNOWLEDGE_BASE_GROUPS_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(KNOWLEDGE_BASE_GROUPS_PERMISSIONS.view)
  @ApiZod({
    summary: 'List knowledge base groups (keyset paging, sort, q)',
    query: listKnowledgeBaseGroupsQuerySchema,
    responses: { [HTTP_STATUS.OK]: knowledgeBaseGroupListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  listGroups(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<KnowledgeBaseGroupListResponseDto> {
    return this.service.listGroups(user, query);
  }

  @Get(KNOWLEDGE_BASE_GROUPS_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(KNOWLEDGE_BASE_GROUPS_PERMISSIONS.view)
  @ApiZod({
    summary: 'Export knowledge base groups',
    query: exportKnowledgeBaseGroupsQuerySchema,
    produces: 'export',
    responses: {},
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
    headers: ['Content-Disposition', 'Cache-Control'],
  })
  async exportGroups(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExportFile['body']> {
    return replyExport(reply, await this.service.exportGroups(user, query));
  }

  @Post(KNOWLEDGE_BASE_GROUPS_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(KNOWLEDGE_BASE_GROUPS_PERMISSIONS.create)
  @ApiZod({
    summary: 'Create knowledge base group',
    body: createKnowledgeBaseGroupBodySchema,
    responses: { [HTTP_STATUS.CREATED]: knowledgeBaseGroupResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  createGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<KnowledgeBaseGroupResponseDto> {
    return this.service.createGroup(user, body);
  }

  @Get(KNOWLEDGE_BASE_GROUPS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(KNOWLEDGE_BASE_GROUPS_PERMISSIONS.view)
  @ApiZod({
    summary: 'Get knowledge base group by id',
    params: knowledgeBaseGroupParamsSchema,
    responses: { [HTTP_STATUS.OK]: knowledgeBaseGroupResponseSchema },
    errors: ['ERP-CORE-0004', 'ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  getGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<KnowledgeBaseGroupResponseDto> {
    return this.service.getGroup(user, params);
  }

  @Patch(KNOWLEDGE_BASE_GROUPS_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(KNOWLEDGE_BASE_GROUPS_PERMISSIONS.edit)
  @ApiZod({
    summary: 'Update knowledge base group',
    params: knowledgeBaseGroupParamsSchema,
    body: updateKnowledgeBaseGroupBodySchema,
    responses: { [HTTP_STATUS.OK]: knowledgeBaseGroupResponseSchema },
    errors: ['ERP-CORE-0004', 'ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  updateGroup(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<KnowledgeBaseGroupResponseDto> {
    return this.service.updateGroup(user, params, body);
  }

  @Delete(KNOWLEDGE_BASE_GROUPS_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(KNOWLEDGE_BASE_GROUPS_PERMISSIONS.delete)
  @ApiZod({
    summary: 'Delete knowledge base group (refused while group has articles)',
    params: knowledgeBaseGroupParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-CORE-0004',
      'ERP-KNOWLEDGEBASEGROUPS-0001',
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
    ],
  })
  removeGroup(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.removeGroup(user, params);
  }
}

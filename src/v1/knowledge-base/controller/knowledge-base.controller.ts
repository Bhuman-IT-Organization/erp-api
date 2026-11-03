/**
 * HTTP entry for `api/v1/knowledge-base`: the six routes the screens call (list, export, detail,
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
import { KNOWLEDGE_BASE_ROUTES } from '../knowledge-base.routes.js';
import {
  createKnowledgeBaseBodySchema,
  exportKnowledgeBaseQuerySchema,
  knowledgeBaseListResponseSchema,
  knowledgeBaseParamsSchema,
  knowledgeBaseResponseSchema,
  listKnowledgeBaseQuerySchema,
  updateKnowledgeBaseBodySchema,
  createKnowledgeBaseGroupBodySchema,
  knowledgeBaseGroupListResponseSchema,
  knowledgeBaseGroupParamsSchema,
  knowledgeBaseGroupResponseSchema,
  listKnowledgeBaseGroupsQuerySchema,
  updateKnowledgeBaseGroupBodySchema,
  type KnowledgeBaseListResponseDto,
  type KnowledgeBaseResponseDto,
  type KnowledgeBaseGroupListResponseDto,
  type KnowledgeBaseGroupResponseDto,
} from '../dto/knowledge-base.dto.js';
import { KnowledgeBaseService } from '../service/knowledge-base.service.js';

@Controller(KNOWLEDGE_BASE_ROUTES.base)
export class KnowledgeBaseController {
  constructor(private readonly service: KnowledgeBaseService) {}

  /** `GET /api/v1/knowledge-base?limit&cursor&q&sort`: the BE-19 envelope, each row with its usage. */
  @Get(KNOWLEDGE_BASE_ROUTES.list)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'List knowledge base with their usage (administrators only; keyset paging, one sort, q)',
    query: listKnowledgeBaseQuerySchema,
    responses: { [HTTP_STATUS.OK]: knowledgeBaseListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<KnowledgeBaseListResponseDto> {
    return this.service.list(user, query);
  }

  @Get(KNOWLEDGE_BASE_ROUTES.groups)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List knowledge base groups (administrators only)',
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

  @Get(KNOWLEDGE_BASE_ROUTES.groupsExport)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Export knowledge base groups (administrators only)',
    query: exportKnowledgeBaseQuerySchema,
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

  @Post(KNOWLEDGE_BASE_ROUTES.groups)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create knowledge base group (administrators only)',
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

  @Get(KNOWLEDGE_BASE_ROUTES.groupRecord)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Get knowledge base group by id (administrators only)',
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

  @Patch(KNOWLEDGE_BASE_ROUTES.groupRecord)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Update knowledge base group (administrators only)',
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

  @Delete(KNOWLEDGE_BASE_ROUTES.groupRecord)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete knowledge base group (administrators only)',
    params: knowledgeBaseGroupParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-CORE-0004',
      'ERP-KNOWLEDGEBASE-0002',
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
    ],
  })
  removeGroup(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.removeGroup(user, params);
  }

  /**
   * `GET /api/v1/knowledge-base/export?format&column&header&q&sort`: every row the list's query
   * matches as CSV, Excel, PDF or print rows, gated exactly like the list (the service asserts the
   * administrator flag first). `replyExport` sets the export's headers on the passthrough reply.
   */
  @Get(KNOWLEDGE_BASE_ROUTES.export)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every knowledge base the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportKnowledgeBaseQuerySchema,
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

  /** `GET /api/v1/knowledge-base/:id`: one knowledge base with its usage; a missing id is a 404. */
  @Get(KNOWLEDGE_BASE_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one knowledge base (administrators only)',
    params: knowledgeBaseParamsSchema,
    responses: { [HTTP_STATUS.OK]: knowledgeBaseResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  get(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<KnowledgeBaseResponseDto> {
    return this.service.get(user, params);
  }

  /**
   * `POST /api/v1/knowledge-base`: 201 and the knowledge base; a name another knowledge base holds is
   * accepted, as in Perfex. Unkeyed, like the other Setup lists (BE-15's interceptor is built by the
   * first module that needs one).
   */
  @Post(KNOWLEDGE_BASE_ROUTES.list)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a knowledge base (administrators only)',
    body: createKnowledgeBaseBodySchema,
    responses: { [HTTP_STATUS.CREATED]: knowledgeBaseResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<KnowledgeBaseResponseDto> {
    return this.service.create(user, body);
  }

  /** `PATCH /api/v1/knowledge-base/:id`: the knowledge base after the rename; a missing id is a 404. */
  @Patch(KNOWLEDGE_BASE_ROUTES.record)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Rename a knowledge base (administrators only)',
    params: knowledgeBaseParamsSchema,
    body: updateKnowledgeBaseBodySchema,
    responses: { [HTTP_STATUS.OK]: knowledgeBaseResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-CORE-0004'],
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<KnowledgeBaseResponseDto> {
    return this.service.update(user, params, body);
  }

  /**
   * `DELETE /api/v1/knowledge-base/:id`: 204 with no body; 404 for a missing id; 409 while any
   * referencing column of `KNOWLEDGE_BASE_REFERENCES` still holds the knowledge base (D-07, D-28).
   */
  @Delete(KNOWLEDGE_BASE_ROUTES.record)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a knowledge base (administrators only); refused while anything still uses it',
    params: knowledgeBaseParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-CORE-0004',
      'ERP-KNOWLEDGEBASE-0001',
    ],
  })
  remove(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.remove(user, params);
  }
}

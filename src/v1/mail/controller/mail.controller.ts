/**
 * HTTP entry for `api/v1/mail` (plan 04.3-07): the Email screens' endpoints. Decorators bind the
 * route, the guards and the API documentation (`@ApiZod` names the zod schemas and every error code
 * a handler can answer, BE-23); the handler hands the actor and the raw input to the service and
 * returns its DTO. Controllers hold no logic, import no transformer and never catch: every failure
 * reaches `ProblemDetailsFilter`.
 *
 * Every handler carries `JwtAuthGuard, PermissionGuard` (401 `ERP-AUTH-0004` without a valid
 * bearer). The template handlers declare the mapped Perfex code (D-09): reads and the preview
 * `settings.emailTemplates.view`; the save, both Active switches, the test send and reading one's
 * own test `.edit` (D-10). The sent-email log, Resend, the status and its test declare NO code: the
 * service asserts the administrator flag first (403 `ERP-AUTH-0005`). `route-gates.spec.ts` compares
 * every handler with `@erp/contracts`' `ROUTE_GATES`.
 *
 * The save takes `If-Match` (`@IfMatch()`: 428 without it, 412 when stale, ADR-0040); the record
 * reads answer the fingerprint as the `ETag` header beside the body's `etag`. The three sends are
 * keyed (`@Idempotent()`, BE-15) and answer 202 `{ id }`; a replay answers the same 202.
 *
 * `templates/active` is declared before `templates/:id`; find-my-way serves the static segment
 * first anyway.
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { IfMatch } from '../../../shared/http/decorators/if-match.decorator.js';
import { Permissions } from '../../../shared/http/decorators/permissions.decorator.js';
import { ETAG_HEADER } from '../../../shared/http/etag.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { Idempotent } from '../../../shared/http/interceptors/idempotent.decorator.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import {
  acceptedResponseSchema,
  listSentEmailsQuerySchema,
  listTemplatesQuerySchema,
  mailDraftBodySchema,
  mailParamsSchema,
  moduleActiveBodySchema,
  moduleActiveResponseSchema,
  previewResponseSchema,
  sentEmailResponseSchema,
  sentEmailsListResponseSchema,
  statusResponseSchema,
  templateActiveBodySchema,
  templateListItemSchema,
  templateResponseSchema,
  templateSaveBodySchema,
  templatesListResponseSchema,
  testStateResponseSchema,
  type AcceptedResponseDto,
  type ModuleActiveResponseDto,
  type PreviewResponseDto,
  type TemplateListItemDto,
  type TemplateResponseDto,
  type TemplatesListResponseDto,
  type SentEmailResponseDto,
  type SentEmailsListResponseDto,
  type StatusResponseDto,
  type TestStateResponseDto,
} from '../dto/mail.dto.js';
import { MAIL_PERMISSIONS, MAIL_ROUTES } from '../mail.routes.js';
import { MailService } from '../service/mail.service.js';

const AUTH_ERRORS = ['ERP-AUTH-0004', 'ERP-AUTH-0005'] as const;
const KEYED_ERRORS = ['ERP-CORE-0010', 'ERP-CORE-0011', 'ERP-CORE-0012'] as const;
const { templates } = MAIL_PERMISSIONS;

@Controller(MAIL_ROUTES.base)
export class MailController {
  constructor(private readonly service: MailService) {}

  /** `GET /api/v1/mail/templates?limit&cursor&q&sort&filter[...]`: the BE-19 envelope. */
  @Get(MAIL_ROUTES.templates)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(templates.view)
  @ApiZod({
    summary:
      'List the email templates (keyset paging, one sort, module, translation and active filters)',
    query: listTemplatesQuerySchema,
    responses: { [HTTP_STATUS.OK]: templatesListResponseSchema },
    errors: ['ERP-VALIDATION-0001', ...AUTH_ERRORS],
  })
  listTemplates(@Query() query: unknown): Promise<TemplatesListResponseDto> {
    return this.service.listTemplates(query);
  }

  /** `POST /api/v1/mail/templates/active`: Enable All or Disable All of one module. */
  @Post(MAIL_ROUTES.templatesActive)
  @HttpCode(HTTP_STATUS.OK)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(templates.edit)
  @ApiZod({
    summary: 'Switch every email template of one module on or off; answers how many changed',
    body: moduleActiveBodySchema,
    responses: { [HTTP_STATUS.OK]: moduleActiveResponseSchema },
    errors: ['ERP-VALIDATION-0001', ...AUTH_ERRORS],
  })
  setModuleActive(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<ModuleActiveResponseDto> {
    return this.service.setModuleActive(user, body);
  }

  /** `GET /api/v1/mail/templates/:id`: the editor's read and its fingerprint (`ETag`). */
  @Get(MAIL_ROUTES.template)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(templates.view)
  @ApiZod({
    summary: 'Read one email template with its merge fields, versions and fingerprint',
    params: mailParamsSchema,
    responses: { [HTTP_STATUS.OK]: templateResponseSchema },
    errors: ['ERP-VALIDATION-0001', ...AUTH_ERRORS, 'ERP-CORE-0004'],
    headers: [ETAG_HEADER],
  })
  async getTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TemplateResponseDto> {
    const dto = await this.service.getTemplate(user, params);
    reply.header(ETAG_HEADER, dto.etag);
    return dto;
  }

  /** `PATCH /api/v1/mail/templates/:id` with `If-Match`: Active and every version. */
  @Patch(MAIL_ROUTES.template)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(templates.edit)
  @ApiZod({
    summary: 'Save an email template: Active and its versions (If-Match required)',
    params: mailParamsSchema,
    body: templateSaveBodySchema,
    responses: { [HTTP_STATUS.OK]: templateResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      ...AUTH_ERRORS,
      'ERP-CORE-0004',
      'ERP-CORE-0013',
      'ERP-CORE-0014',
      'ERP-MAIL-0004',
    ],
    headers: [ETAG_HEADER],
  })
  async saveTemplate(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
    @IfMatch() ifMatch: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<TemplateResponseDto> {
    const dto = await this.service.saveTemplate(user, params, body, ifMatch);
    reply.header(ETAG_HEADER, dto.etag);
    return dto;
  }

  /** `PUT /api/v1/mail/templates/:id/active`: the list's immediate switch. */
  @Put(MAIL_ROUTES.templateActive)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(templates.edit)
  @ApiZod({
    summary: 'Switch one email template on or off',
    params: mailParamsSchema,
    body: templateActiveBodySchema,
    responses: { [HTTP_STATUS.OK]: templateListItemSchema },
    errors: ['ERP-VALIDATION-0001', ...AUTH_ERRORS, 'ERP-CORE-0004'],
  })
  setTemplateActive(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<TemplateListItemDto> {
    return this.service.setTemplateActive(user, params, body);
  }

  /** `POST /api/v1/mail/templates/:id/preview`: an unsaved draft rendered with sample values. */
  @Post(MAIL_ROUTES.templatePreview)
  @HttpCode(HTTP_STATUS.OK)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(templates.view)
  @ApiZod({
    summary: 'Preview an unsaved draft of one locale with sample values, inside the brand',
    params: mailParamsSchema,
    body: mailDraftBodySchema,
    responses: { [HTTP_STATUS.OK]: previewResponseSchema },
    errors: ['ERP-VALIDATION-0001', ...AUTH_ERRORS, 'ERP-CORE-0004'],
  })
  previewTemplate(@Param() params: unknown, @Body() body: unknown): Promise<PreviewResponseDto> {
    return this.service.previewTemplate(params, body);
  }

  /** `POST /api/v1/mail/templates/:id/test`: the draft to the caller's own address; 202. */
  @Post(MAIL_ROUTES.templateTest)
  @HttpCode(HTTP_STATUS.ACCEPTED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(templates.edit)
  @Idempotent()
  @ApiZod({
    summary: 'Send a test of an unsaved draft to me (Idempotency-Key required; rate-limited)',
    params: mailParamsSchema,
    body: mailDraftBodySchema,
    responses: { [HTTP_STATUS.ACCEPTED]: acceptedResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      ...AUTH_ERRORS,
      ...KEYED_ERRORS,
      'ERP-CORE-0004',
      'ERP-MAIL-0002',
      'ERP-MAIL-0007',
      'ERP-UPSTREAM-0001',
    ],
  })
  sendTemplateTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<AcceptedResponseDto> {
    return this.service.sendTemplateTest(user, params, body);
  }

  /** `GET /api/v1/mail/tests/:id`: the state of a test the caller sent; anything else is a 404. */
  @Get(MAIL_ROUTES.test)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(templates.edit)
  @ApiZod({
    summary: 'Read the state of a test email I sent',
    params: mailParamsSchema,
    responses: { [HTTP_STATUS.OK]: testStateResponseSchema },
    errors: ['ERP-VALIDATION-0001', ...AUTH_ERRORS, 'ERP-CORE-0004'],
  })
  getTest(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<TestStateResponseDto> {
    return this.service.getTest(user, params);
  }

  // --- administrators only: no code; the service asserts the flag first ---------------------------

  /** `GET /api/v1/mail/sent-emails?limit&cursor&q&sort&filter[...]`: the log, newest first. */
  @Get(MAIL_ROUTES.sentEmails)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'List the sent emails (administrators only; keyset paging, template, status and date filters, recipient prefix)',
    query: listSentEmailsQuerySchema,
    responses: { [HTTP_STATUS.OK]: sentEmailsListResponseSchema },
    errors: ['ERP-VALIDATION-0001', ...AUTH_ERRORS],
  })
  listSentEmails(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<SentEmailsListResponseDto> {
    return this.service.listSentEmails(user, query);
  }

  /** `GET /api/v1/mail/sent-emails/:id`: one entry with the mail server's reply. */
  @Get(MAIL_ROUTES.sentEmail)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read one sent email with the mail server reply (administrators only)',
    params: mailParamsSchema,
    responses: { [HTTP_STATUS.OK]: sentEmailResponseSchema },
    errors: ['ERP-VALIDATION-0001', ...AUTH_ERRORS, 'ERP-CORE-0004'],
  })
  getSentEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<SentEmailResponseDto> {
    return this.service.getSentEmail(user, params);
  }

  /** `POST /api/v1/mail/sent-emails/:id/resend`: a new entry to the same recipient; 202. */
  @Post(MAIL_ROUTES.resend)
  @HttpCode(HTTP_STATUS.ACCEPTED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Idempotent()
  @ApiZod({
    summary:
      'Resend a sent or failed email with the current wording and values (administrators only; Idempotency-Key required)',
    params: mailParamsSchema,
    responses: { [HTTP_STATUS.ACCEPTED]: acceptedResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      ...AUTH_ERRORS,
      ...KEYED_ERRORS,
      'ERP-CORE-0004',
      'ERP-MAIL-0002',
      'ERP-MAIL-0004',
      'ERP-MAIL-0005',
      'ERP-MAIL-0006',
      'ERP-MAIL-0008',
      'ERP-UPSTREAM-0001',
    ],
  })
  resend(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<AcceptedResponseDto> {
    return this.service.resend(user, params);
  }

  /** `GET /api/v1/mail/status`: the deployment's mail setup, read only; never a credential. */
  @Get(MAIL_ROUTES.status)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read the email setup, the mail server state and the last send (administrators only)',
    responses: { [HTTP_STATUS.OK]: statusResponseSchema },
    errors: [...AUTH_ERRORS],
  })
  getStatus(@CurrentUser() user: AuthenticatedUser): Promise<StatusResponseDto> {
    return this.service.getStatus(user);
  }

  /** `POST /api/v1/mail/status/test`: the fixed test email to the administrator's own address; 202. */
  @Post(MAIL_ROUTES.statusTest)
  @HttpCode(HTTP_STATUS.ACCEPTED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Idempotent()
  @ApiZod({
    summary:
      'Send a test email to me (administrators only; Idempotency-Key required; rate-limited)',
    responses: { [HTTP_STATUS.ACCEPTED]: acceptedResponseSchema },
    errors: [
      ...AUTH_ERRORS,
      ...KEYED_ERRORS,
      'ERP-CORE-0004',
      'ERP-MAIL-0002',
      'ERP-MAIL-0007',
      'ERP-UPSTREAM-0001',
    ],
  })
  sendStatusTest(@CurrentUser() user: AuthenticatedUser): Promise<AcceptedResponseDto> {
    return this.service.sendStatusTest(user);
  }
}

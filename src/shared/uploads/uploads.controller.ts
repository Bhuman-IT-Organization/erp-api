/**
 * `/api/v1/uploads` (ADR-0041): the tus 1.0.0 protocol endpoint and the rules read. It is excluded
 * from the OpenAPI document because it is a protocol endpoint, not a JSON resource: tus's
 * `POST` (create), `HEAD` (offset), `PATCH` (chunk) and `DELETE` (cancel) are specified by
 * tus 1.0.0, and the one JSON route beside them, `GET /api/v1/uploads/rules/:purpose`
 * (`{ purpose, maxBytes, maxFiles, extensions }`; 403 `ERP-AUTH-0005`, 404 `ERP-CORE-0004`), is
 * documented here and in `src/shared/README.md`.
 *
 * Every route needs a signed-in caller (`JwtAuthGuard`). `HEAD`, `PATCH` and `DELETE` of an upload
 * another staff member created answer 404 before tus sees them (T-4.2-26); the purpose's codes are
 * checked when the upload is created (`UploadsService`). The controller holds no logic and never
 * catches.
 */
import { All, Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../http/auth/access-token-verifier.js';
import { CurrentUser } from '../http/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../http/guards/jwt-auth.guard.js';
import { UPLOADS_ROUTE } from './upload-purpose.js';
import { UploadsService, type UploadRulesAnswer } from './uploads.service.js';

/** The tus methods on one upload that only its creator may use. */
const OWNER_ONLY: ReadonlySet<string> = new Set(['HEAD', 'PATCH', 'DELETE']);

/** The tus endpoint and the rules read. */
@ApiExcludeController()
@Controller(UPLOADS_ROUTE)
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Get('rules/:purpose')
  rules(
    @Param('purpose') purpose: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<UploadRulesAnswer> {
    return this.uploads.rulesOf(purpose, user.staffId);
  }

  @All()
  async create(
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.uploads.serve(request, reply, user.staffId);
  }

  @All(':id')
  async upload(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    if (OWNER_ONLY.has(request.method)) await this.uploads.assertOwner(id, user.staffId);
    await this.uploads.serve(request, reply, user.staffId);
  }
}

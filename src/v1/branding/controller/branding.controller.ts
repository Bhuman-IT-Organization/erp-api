/**
 * `GET /api/v1/branding` — public and anonymous: the login page needs it before anyone is signed
 * in. Nothing in the payload is secret (it is what every Perfex screen already prints in its
 * header). Cached client-side for `TIMINGS.branding.cacheMaxAgeS`.
 *
 * The service returns the DTO; controllers never import a transformer (erp-docs
 * 02-coding-rules/05-backend.md BE-08).
 */
import { Controller, Get, Header } from '@nestjs/common';
import { TIMINGS } from '../../../shared/config/timings.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import { BRANDING_ROUTES } from '../branding.routes.js';
import { brandingResponseSchema, type BrandingResponseDto } from '../dto/branding.dto.js';
import { BrandingService } from '../service/branding.service.js';

@Controller(BRANDING_ROUTES.base)
export class BrandingController {
  constructor(private readonly service: BrandingService) {}

  @Get()
  @Header('Cache-Control', `public, max-age=${String(TIMINGS.branding.cacheMaxAgeS)}`)
  @ApiZod({
    summary:
      'Company name, logos and theme of this deployment (anonymous; one build serves every customer)',
    responses: { [HTTP_STATUS.OK]: brandingResponseSchema },
    security: 'none',
    headers: ['Cache-Control'],
  })
  current(): Promise<BrandingResponseDto> {
    return this.service.currentResponse();
  }
}

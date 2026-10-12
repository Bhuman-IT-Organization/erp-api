/**
 * Transformer: model -> response DTO. The logo URL contract lives here and nowhere else:
 * `/uploads/company/<file>`, the path Perfex serves today and Nginx will keep pointing at
 * whichever module owns company files after the settings module migrates. `formats` is already
 * parsed fail-closed by the service and passes through; the response schema re-validates it.
 */
import { Injectable } from '@nestjs/common';
import { brandingResponseSchema, type BrandingResponseDto } from '../dto/branding.dto.js';
import type { Branding } from '../model/branding.model.js';

export const COMPANY_UPLOADS_PATH = '/uploads/company';

/** A stored file name is a bare name; anything else (path segments, spaces) is treated as unset. */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** `/uploads/company/<file>` for a bare stored file name; `null` for none or an unsafe one. */
export function logoUrlOf(file: string | null): string | null {
  if (file === null || !SAFE_FILE_NAME.test(file)) return null;
  return `${COMPANY_UPLOADS_PATH}/${file}`;
}

@Injectable()
export class BrandingTransformer {
  toResponse(branding: Branding): BrandingResponseDto {
    return brandingResponseSchema.parse({
      companyName: branding.companyName,
      logoUrl: logoUrlOf(branding.logoFile),
      logoDarkUrl: logoUrlOf(branding.logoDarkFile),
      theme: {},
      defaultLocale: branding.defaultLocale,
      formats: branding.formats,
    });
  }
}

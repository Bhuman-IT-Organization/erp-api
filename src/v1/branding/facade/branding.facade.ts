/**
 * Facade: the ONLY surface other modules may import (ADR-0001). A module that renders the
 * company name or logo (invoice PDFs, e-mail headers) asks here, never `tbloptions`.
 */
import { Injectable } from '@nestjs/common';
import type { Branding } from '../model/branding.model.js';
import { BrandingService } from '../service/branding.service.js';
import { logoUrlOf } from '../service/branding.transformer.js';

@Injectable()
export class BrandingFacade {
  constructor(private readonly service: BrandingService) {}

  current(): Promise<Branding> {
    return this.service.current();
  }

  /**
   * The logo path the web uses for this branding (`/uploads/company/<file>`), or `null` when none is
   * set or the stored name is unsafe. Same-origin: a caller that needs an absolute URL (an email)
   * joins it to its own public base URL.
   */
  logoPathOf(branding: Branding): string | null {
    return logoUrlOf(branding.logoFile);
  }
}

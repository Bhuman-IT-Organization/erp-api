import { Global, Module } from '@nestjs/common';
import { SmtpAdapter } from './adapters/email/smtp.adapter.js';
import { EMAIL_PROVIDER } from './ports/email-provider.port.js';

/**
 * Ports and adapters home (BE-16): the one place adapters are wired. Global, so a module's
 * transport injects a port by its token without importing this module (PATTERNS M12). The first
 * port is email: `EMAIL_PROVIDER` is the SMTP adapter (ADR-0049), which reports
 * `configured: false` and opens no connection when SMTP_HOST is absent.
 */
@Global()
@Module({
  providers: [SmtpAdapter, { provide: EMAIL_PROVIDER, useExisting: SmtpAdapter }],
  exports: [EMAIL_PROVIDER],
})
export class IntegrationsModule {}

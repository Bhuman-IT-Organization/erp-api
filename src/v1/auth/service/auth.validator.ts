/**
 * Validator: the zod request schema and the two business refusals (BE-03: expected failures are
 * `AppError`s the shared filter maps; nothing here throws a Nest exception).
 *
 * T-1.3-44: an inactive account answers the same generic `ERP-AUTH-0001` as a wrong password —
 * the reason (`inactive`) is returned separately for the event and the log, never to the client.
 * A two-factor account is refused with `ERP-AUTH-0007` (use the legacy login) because wave 0 does
 * not implement the second factor (0 such rows today; research Q1 point 5).
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import { loginRequestSchema, type LoginRequestDto } from '../dto/auth.dto.js';
import type { LoginFailureReason } from '../events/published.js';
import type { StaffIdentity } from '../model/auth.model.js';

export type LoginRefusalReason = Extract<LoginFailureReason, 'inactive' | 'two_factor'>;

/** Surrounding whitespace on the e-mail is a paste artefact, not a validation failure. */
function trimEmail(body: unknown): unknown {
  if (typeof body !== 'object' || body === null) return body;
  const { email } = body as { email?: unknown };
  return typeof email === 'string' ? { ...body, email: email.trim() } : body;
}

@Injectable()
export class AuthValidator {
  /**
   * Parses the login body; the e-mail is trimmed and lowercased so the lockout key and the
   * lookup use one spelling. Throws `ERP-VALIDATION-0001` (400) with the zod issues.
   */
  parseLoginRequest(body: unknown): LoginRequestDto {
    const parsed = loginRequestSchema.safeParse(trimEmail(body));
    if (!parsed.success) {
      throw new AppError('ERP-VALIDATION-0001', 'Request body is invalid', {
        issues: parsed.error.issues,
      });
    }
    return { ...parsed.data, email: parsed.data.email.trim().toLowerCase() };
  }

  /** Why this account may not log in through the api, or `null` when it may. */
  refusalReason(staff: StaffIdentity): LoginRefusalReason | null {
    if (!staff.active) return 'inactive';
    if (staff.twoFactorEnabled) return 'two_factor';
    return null;
  }

  /** Throws the refusal's `AppError`; returns when the account may log in. */
  assertCanLogin(staff: StaffIdentity): void {
    switch (this.refusalReason(staff)) {
      case 'inactive':
        throw new AppError('ERP-AUTH-0001'); // generic on purpose (T-1.3-44)
      case 'two_factor':
        throw new AppError('ERP-AUTH-0007');
      case null:
        return;
    }
  }
}

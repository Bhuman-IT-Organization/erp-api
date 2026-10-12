/**
 * Transformer: entity → response DTO. Every DTO is built field by field and then parsed through
 * its zod response schema, which strips any key the schema does not name — so a `passwordHash`,
 * a `refreshToken`, a `jti` or a `sid` can never ride along by accident (T-1.3-43). The refresh
 * token reaches the client only as the cookie the controller sets; `sid`/`jti` stay inside the
 * access token.
 */
import { Injectable } from '@nestjs/common';
import {
  loginResponseSchema,
  meResponseSchema,
  type LoginResponseDto,
  type MeResponseDto,
} from '../dto/auth.dto.js';
import type { IssuedTokens, PermissionSnapshot, StaffIdentity } from '../model/auth.model.js';

@Injectable()
export class AuthTransformer {
  toLoginResponse(tokens: IssuedTokens, staff: StaffIdentity, csrfToken: string): LoginResponseDto {
    return loginResponseSchema.parse({
      accessToken: tokens.accessToken,
      tokenType: 'Bearer',
      expiresIn: tokens.expiresIn,
      csrfToken,
      user: {
        staffId: staff.staffId,
        email: staff.email,
        firstName: staff.firstName,
        lastName: staff.lastName,
        isAdmin: staff.isAdmin,
        locale: staff.locale,
      },
    });
  }

  /** `disabledModules` is the deployment's module switch (ADR-0042), passed in by the service. */
  toMeResponse(
    staff: StaffIdentity,
    snapshot: PermissionSnapshot,
    disabledModules: readonly string[],
  ): MeResponseDto {
    return meResponseSchema.parse({
      staffId: staff.staffId,
      email: staff.email,
      firstName: staff.firstName,
      lastName: staff.lastName,
      isAdmin: staff.isAdmin,
      roleId: staff.roleId,
      permissions: [...snapshot.codes],
      locale: staff.locale,
      disabledModules: [...disabledModules],
    });
  }
}

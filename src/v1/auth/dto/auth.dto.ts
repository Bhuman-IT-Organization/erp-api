/**
 * Request/response DTOs and the row schema for the raw `tblstaff_permissions` query (research
 * Q2: the table has no primary key; Prisma ignores it; rows are parsed here, never trusted from
 * the generic). Types are `z.infer` of the schemas; erp-web mirrors `loginRequestSchema` until
 * `@erp/contracts` exists. No DTO carries a password hash, a refresh token or a session record.
 */
import { z } from 'zod';

/** `tblstaff.email` is `varchar(100)`; anything longer can never match a row. */
const EMAIL_MAX_LENGTH = 100;
/** Bounds the bcrypt input (the library reads at most 72 bytes; 200 keeps the error a clean 400). */
const PASSWORD_MAX_LENGTH = 200;

export const loginRequestSchema = z.object({
  email: z.email().max(EMAIL_MAX_LENGTH),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

export const loginResponseSchema = z
  .object({
    accessToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.number().int(),
    csrfToken: z.string(),
    user: z.object({
      staffId: z.number().int(),
      email: z.string(),
      firstName: z.string(),
      lastName: z.string(),
      isAdmin: z.boolean(),
      /** BCP-47 from `tblstaff.default_language`; `null` when unset. The web writes its locale cookie from it. */
      locale: z.string().nullable(),
    }),
  })
  .readonly();

export const meResponseSchema = z
  .object({
    staffId: z.number().int(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    isAdmin: z.boolean(),
    roleId: z.number().int().nullable(),
    permissions: z.array(z.string()),
    locale: z.string().nullable(),
    /** The modules this deployment switches off (ADR-0042); the web hides them. Empty when all are on. */
    disabledModules: z.array(z.string()),
  })
  .readonly();

export const csrfResponseSchema = z.object({ csrfToken: z.string() });

/**
 * `GET /api/v1/auth/legacy-sso` (ADR-0031 `legacy` breaker consumer): `ready` when the legacy
 * system answers 405 to a GET of `/erp_sso/handoff` (module active), `inactive` when it answers
 * 404 (module not activated). Legacy unreachable or the breaker open is a 503 `ERP-UPSTREAM-0001`
 * from the shared filter, not a value here.
 */
export const legacySsoResponseSchema = z.object({ status: z.enum(['ready', 'inactive']) });

/** `GET /.well-known/jwks.json` — public members only; what the legacy `erp_sso` module fetches. */
export const jwksResponseSchema = z.object({
  keys: z.array(
    z.object({
      kty: z.literal('RSA'),
      n: z.string(),
      e: z.string(),
      alg: z.literal('RS256'),
      use: z.literal('sig'),
      kid: z.string(),
    }),
  ),
});

/** One row of `SELECT feature, capability FROM tblstaff_permissions WHERE staff_id = ?` via `$queryRaw`. */
export const staffPermissionRowSchema = z.object({
  feature: z.string(),
  capability: z.string(),
});

export type LoginRequestDto = z.infer<typeof loginRequestSchema>;
export type LoginResponseDto = z.infer<typeof loginResponseSchema>;
export type MeResponseDto = z.infer<typeof meResponseSchema>;
export type CsrfResponseDto = z.infer<typeof csrfResponseSchema>;
export type LegacySsoResponseDto = z.infer<typeof legacySsoResponseSchema>;
export type JwksResponseDto = z.infer<typeof jwksResponseSchema>;
export type StaffPermissionRow = z.infer<typeof staffPermissionRowSchema>;

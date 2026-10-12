/**
 * `GET /.well-known/jwks.json` — the public key set the legacy `erp_sso` module (and any other
 * verifier) fetches to check access tokens by `kid` (ADR-0005). Outside the `api/v1` prefix like
 * the health pair (`UNPREFIXED_ROUTES` in main.ts); Nginx routes the exact path to the api.
 * Public members only: the issuer never materialises the private JWK members (T-1.3-26).
 */
import { Controller, Get, Header } from '@nestjs/common';
import { TIMINGS } from '../../../shared/config/timings.js';
import { WELL_KNOWN_JWKS_PATH } from '../../../shared/http/api-prefix.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import { jwksResponseSchema, type JwksResponseDto } from '../dto/auth.dto.js';
import { TokenIssuer } from '../service/token-issuer.js';

@Controller()
export class JwksController {
  constructor(private readonly issuer: TokenIssuer) {}

  @Get(WELL_KNOWN_JWKS_PATH)
  @Header('Cache-Control', `public, max-age=${String(TIMINGS.auth.jwksCacheMaxAgeS)}`)
  @ApiZod({
    summary: 'Public key set (RS256) for verifying access tokens by kid',
    responses: { [HTTP_STATUS.OK]: jwksResponseSchema },
    security: 'none',
    headers: ['Cache-Control'],
  })
  jwks(): JwksResponseDto {
    return this.issuer.jwks();
  }
}

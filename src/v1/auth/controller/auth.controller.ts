/**
 * HTTP entry for the seven `api/v1/auth` routes. Decorators bind the routes, the handler calls
 * the service and returns its DTO; the only HTTP-shaped work here is the cookies — the
 * refresh token goes out as `erp_refresh` (httpOnly, SameSite=Strict, scoped to the refresh
 * path so no other request ever carries it), the CSRF secret as `erp_csrf` (minted by
 * `reply.generateCsrf()`, whose token is returned in the body for the `x-csrf-token` header),
 * and the secret-free presence flag as `erp_session_present` (httpOnly, SameSite=Lax, `Path=/`)
 * so erp-web's `proxy.ts` can tell a signed-in visitor from an anonymous one (ADR-0032).
 * Controllers hold no logic and never catch: every failure reaches `ProblemDetailsFilter`.
 *
 * CSRF is enforced by the `onRequest` hook in `shared/http/fastify-plugins.ts` for `refresh`,
 * `logout` and `logout-all` (the three POSTs a cookie could ride along on); `login` has no
 * cookie yet, so there is nothing to forge and nothing to check.
 */
import { Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TIMINGS } from '../../../shared/config/timings.js';
import { AppConfig } from '../../../shared/config/app-config.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import {
  AUTH_ROUTES,
  REFRESH_COOKIE,
  SESSION_COOKIES,
  SESSION_PRESENT_COOKIE,
  SESSION_PRESENT_COOKIE_VALUE,
} from '../auth.routes.js';
import {
  csrfResponseSchema,
  legacySsoResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  meResponseSchema,
  type CsrfResponseDto,
  type LegacySsoResponseDto,
  type LoginResponseDto,
  type MeResponseDto,
} from '../dto/auth.dto.js';
import { AuthService } from '../service/auth.service.js';

const MS_PER_SECOND = 1_000;
const SET_COOKIE = 'Set-Cookie';

@Controller(AUTH_ROUTES.base)
export class AuthController {
  constructor(
    private readonly service: AuthService,
    private readonly config: AppConfig,
  ) {}

  @Post(AUTH_ROUTES.login)
  @HttpCode(HTTP_STATUS.OK)
  @ApiZod({
    summary:
      'Log in with e-mail and password; sets the refresh, CSRF and erp_session_present cookies',
    body: loginRequestSchema,
    responses: { [HTTP_STATUS.OK]: loginResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0001', 'ERP-AUTH-0006', 'ERP-AUTH-0007'],
    security: 'none',
    headers: [SET_COOKIE],
  })
  async login(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponseDto> {
    const csrfToken = reply.generateCsrf();
    const { response, refreshToken } = await this.service.login(
      { body: req.body, ip: req.ip, userAgent: req.headers['user-agent'] ?? '' },
      csrfToken,
    );
    this.setSessionCookies(reply, refreshToken);
    return response;
  }

  @Post(AUTH_ROUTES.refresh)
  @HttpCode(HTTP_STATUS.OK)
  @ApiZod({
    summary:
      'Rotate the refresh and erp_session_present cookies (CSRF double submit) and issue a new access token',
    responses: { [HTTP_STATUS.OK]: loginResponseSchema },
    errors: ['ERP-AUTH-0002', 'ERP-AUTH-0003', 'ERP-AUTH-0008'],
    security: 'none',
    headers: [SET_COOKIE],
  })
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponseDto> {
    const csrfToken = reply.generateCsrf();
    const { response, refreshToken } = await this.service.refresh(
      req.cookies[REFRESH_COOKIE],
      csrfToken,
    );
    this.setSessionCookies(reply, refreshToken);
    return response;
  }

  @Post(AUTH_ROUTES.logout)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @ApiZod({
    summary:
      'End this session, revoke the presented access token and clear the refresh and erp_session_present cookies',
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: ['ERP-AUTH-0004', 'ERP-AUTH-0008'],
    headers: [SET_COOKIE],
  })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.service.logout(user);
    this.clearSessionCookies(reply);
  }

  @Post(AUTH_ROUTES.logoutAll)
  @UseGuards(JwtAuthGuard)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @ApiZod({
    summary:
      'End every session of the staff member, invalidate every outstanding access token and clear the refresh and erp_session_present cookies',
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: ['ERP-AUTH-0004', 'ERP-AUTH-0008'],
    headers: [SET_COOKIE],
  })
  async logoutAll(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.service.logoutAll(user);
    this.clearSessionCookies(reply);
  }

  @Get(AUTH_ROUTES.me)
  @UseGuards(JwtAuthGuard)
  @ApiZod({
    summary: 'The signed-in staff member and their permission codes',
    responses: { [HTTP_STATUS.OK]: meResponseSchema },
    errors: ['ERP-AUTH-0004'],
  })
  me(@CurrentUser() user: AuthenticatedUser): Promise<MeResponseDto> {
    return this.service.me(user);
  }

  /** A fresh token for a page that lost its in-memory one (same secret cookie, or a new one). */
  @Get(AUTH_ROUTES.csrf)
  @ApiZod({
    summary: 'A fresh CSRF token for the x-csrf-token header',
    responses: { [HTTP_STATUS.OK]: csrfResponseSchema },
    security: 'none',
    headers: [SET_COOKIE],
  })
  csrf(@Res({ passthrough: true }) reply: FastifyReply): CsrfResponseDto {
    return { csrfToken: reply.generateCsrf() };
  }

  /**
   * Readiness of the legacy `erp_sso` module through the `legacy` breaker. Bearer required: each
   * call may cost a legacy request and reveals legacy's availability (T-1.3-80).
   */
  @Get(AUTH_ROUTES.legacySso)
  @UseGuards(JwtAuthGuard)
  @ApiZod({
    summary: 'Readiness of the legacy erp_sso module through the legacy breaker',
    responses: { [HTTP_STATUS.OK]: legacySsoResponseSchema },
    errors: ['ERP-AUTH-0004', 'ERP-UPSTREAM-0001'],
  })
  legacySso(): Promise<LegacySsoResponseDto> {
    return this.service.legacySso();
  }

  /**
   * Both session cookies leave together (ADR-0032 §Implementation 2): the refresh credential on its
   * own narrow path, and the secret-free presence flag on `/` so erp-web's `proxy.ts` sees it on a
   * page request. Path and SameSite come from `SESSION_COOKIES`, the one list the clearing helper
   * and the refresh-failure `onSend` hook also read (ADR-0037), so neither cookie can drift.
   */
  private setSessionCookies(reply: FastifyReply, refreshToken: string): void {
    const values = {
      [REFRESH_COOKIE]: refreshToken,
      [SESSION_PRESENT_COOKIE]: SESSION_PRESENT_COOKIE_VALUE,
    };
    for (const c of SESSION_COOKIES) {
      void reply.setCookie(c.name, values[c.name], {
        httpOnly: true,
        sameSite: c.sameSite,
        secure: this.config.env.AUTH_COOKIE_SECURE,
        path: c.path,
        maxAge: TIMINGS.auth.refreshTokenTtlMs / MS_PER_SECOND,
      });
    }
  }

  /** The clearing half: each cookie is cleared with its own attributes so the browser matches it. */
  private clearSessionCookies(reply: FastifyReply): void {
    for (const c of SESSION_COOKIES) {
      void reply.clearCookie(c.name, {
        httpOnly: true,
        sameSite: c.sameSite,
        secure: this.config.env.AUTH_COOKIE_SECURE,
        path: c.path,
      });
    }
  }
}

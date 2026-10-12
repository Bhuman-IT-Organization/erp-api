/**
 * Public surface of the module: the facade, its public types, and — the only non-facade export —
 * the HTTP security constants the composition root (`main.ts`) hands to
 * `shared/http/fastify-plugins.ts`, because `shared/` may not import `v1/` and the cookie name,
 * its path, the header and the protected paths are this module's to define.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
import { API_PREFIX } from '../../shared/http/api-prefix.js';
import type { ErrorCode } from '../../shared/errors/error-codes.js';
import type { HttpSecurityOptions } from '../../shared/http/fastify-plugins.js';
import {
  AUTH_ROUTES,
  CSRF_COOKIE,
  CSRF_COOKIE_PATH,
  CSRF_HEADER,
  SESSION_COOKIES,
} from './auth.routes.js';

export { AuthFacade } from './facade/auth.facade.js';
export type { StaffId, StaffIdentity, PermissionSnapshot } from './model/auth.model.js';

/** Full paths (prefix included) so the `onRequest` hook compares against `req.url` directly. */
export const AUTH_HTTP_SECURITY = {
  csrfCookie: { name: CSRF_COOKIE, path: CSRF_COOKIE_PATH },
  csrfHeader: CSRF_HEADER,
  csrfProtectedPaths: [
    `/${API_PREFIX}/${AUTH_ROUTES.base}/${AUTH_ROUTES.refresh}`,
    `/${API_PREFIX}/${AUTH_ROUTES.base}/${AUTH_ROUTES.logout}`,
    `/${API_PREFIX}/${AUTH_ROUTES.base}/${AUTH_ROUTES.logoutAll}`,
  ],
  /** A refresh answered 0002/0003 ended the session: both session cookies are cleared (ADR-0037). */
  sessionEnd: {
    path: `/${API_PREFIX}/${AUTH_ROUTES.base}/${AUTH_ROUTES.refresh}`,
    codes: ['ERP-AUTH-0002', 'ERP-AUTH-0003'] satisfies ErrorCode[],
    cookies: SESSION_COOKIES,
  },
} as const satisfies HttpSecurityOptions;

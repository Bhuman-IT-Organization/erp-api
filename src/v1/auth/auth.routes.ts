/**
 * Route constants: the single source for this module's paths, used by the controller, tests,
 * the cookie scopes and erp-web's auth endpoints. Relative to the global prefix `api/v1`;
 * the JWKS document lives outside it (`WELL_KNOWN_JWKS_PATH`, shared/http/api-prefix.ts).
 */
import { API_PREFIX } from '../../shared/http/api-prefix.js';
import type { SessionCookieSpec } from '../../shared/http/fastify-plugins.js';

export const AUTH_ROUTES = {
  base: 'auth',
  login: 'login',
  refresh: 'refresh',
  logout: 'logout',
  logoutAll: 'logout-all',
  me: 'me',
  csrf: 'csrf',
  /** `GET` readiness probe of the legacy `erp_sso` module (ADR-0031 `legacy` breaker consumer). */
  legacySso: 'legacy-sso',
} as const;

/** The opaque rotating refresh token; `httpOnly; SameSite=Strict`, scoped to `REFRESH_COOKIE_PATH` (ADR-0005). */
export const REFRESH_COOKIE = 'erp_refresh' as const;
/** Secret-free presence flag read only by erp-web's `proxy.ts` (ADR-0032); authorises nothing. */
export const SESSION_PRESENT_COOKIE = 'erp_session_present' as const;
/** The `@fastify/csrf-protection` secret cookie, scoped to `CSRF_COOKIE_PATH`. */
export const CSRF_COOKIE = 'erp_csrf' as const;
/** Header the browser sends the CSRF token back in on `refresh` and `logout*`. */
export const CSRF_HEADER = 'x-csrf-token' as const;

/** `/api/v1/auth/refresh` — derived from the prefix and the route constants so the three never drift. */
export const REFRESH_COOKIE_PATH =
  `/${API_PREFIX}/${AUTH_ROUTES.base}/${AUTH_ROUTES.refresh}` satisfies '/api/v1/auth/refresh';
/** `/api/v1/auth` — the CSRF cookie covers every auth route. */
export const CSRF_COOKIE_PATH = `/${API_PREFIX}/${AUTH_ROUTES.base}` satisfies '/api/v1/auth';
/** `/` — the Next server must receive it on every page request, unlike the refresh cookie (ADR-0005). */
export const SESSION_PRESENT_COOKIE_PATH = '/' as const;
/** The cookie's only value; its presence is the whole message. */
export const SESSION_PRESENT_COOKIE_VALUE = '1' as const;

/**
 * The two session cookies with the attributes they are set with (ADR-0032). One list feeds the
 * controller's setting and clearing helpers and the `onSend` hook that clears both when a refresh
 * ends the session (ADR-0037), so the Path and SameSite of a clearing line cannot drift from the
 * line that set the cookie — a mismatch would leave the cookie in the browser.
 */
export const SESSION_COOKIES = [
  { name: REFRESH_COOKIE, path: REFRESH_COOKIE_PATH, sameSite: 'strict' },
  { name: SESSION_PRESENT_COOKIE, path: SESSION_PRESENT_COOKIE_PATH, sameSite: 'lax' },
] as const satisfies readonly SessionCookieSpec[];

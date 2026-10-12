/**
 * Cookie parsing and double-submit CSRF on the Fastify adapter (`@fastify/cookie`,
 * `@fastify/csrf-protection`).
 *
 * `shared/` never imports `v1/`, so the cookie name, its path, the header and the protected paths
 * arrive as options from the composition root (`main.ts` passes `AUTH_HTTP_SECURITY` from
 * `v1/auth/index.ts`). The CSRF check runs in a Fastify `onRequest` hook rather than a Nest guard:
 * the plugin's own `fastify.csrfProtection` is its documented entry point and it needs the
 * decorated `request.cookies`, which a Nest guard cannot reach without re-parsing. The hook fires
 * only for `POST` to the listed paths (refresh, logout, logout-all) — never for `login`, which
 * carries no cookie yet: the secret cookie is minted by `reply.generateCsrf()` in the login
 * handler and the token travels back in the body, then in the `x-csrf-token` header.
 *
 * A failed check is answered by the plugin with `reply.send(FST_CSRF_* error)`. The adapter's
 * error handler is Nest's, but `FastifyAdapter.mapException` rewraps every `FastifyError` as a
 * bare `HttpException(message, statusCode)` — the `FST_CSRF_*` code is lost before the global
 * filter sees it. So the hook hands the plugin a reply whose `send` converts that error into
 * `AppError('ERP-AUTH-0008')` and passes it to `done`; the adapter forwards an `AppError`
 * untouched and `ProblemDetailsFilter` answers 403 in the standard problem shape.
 * The type augmentations for `reply.setCookie` / `reply.generateCsrf` come from the two imports.
 *
 * A refresh that ENDS the session clears both session cookies in an `onSend` hook (ADR-0037, which
 * amends ADR-0032's lifecycle). It is a hook, not a controller `try`: controllers never catch and
 * the filter answers (BE-08, BE-09), so the hook only adds `Set-Cookie` lines to the response the
 * filter already built. Only a 401 whose problem `code` is in `sessionEnd.codes` (0002/0003)
 * clears: both are reachable only after the CSRF hook above has passed, so a cross-site POST stops
 * at 0008 and cannot sign anyone out, and a 5xx is an outage, not an ended session. The names,
 * paths and SameSite values arrive from the caller because `shared/` imports no `v1/`. Ordering
 * (read in `@fastify/cookie` 11.1.2): once the cookie plugin's own `onSend` has run, a later
 * `reply.clearCookie` serializes at once and APPENDS to the existing `Set-Cookie` header, so this
 * hook, registered after the plugin, keeps the `erp_csrf` line `generateCsrf()` set earlier.
 */
import fastifyCookie from '@fastify/cookie';
import fastifyCsrf from '@fastify/csrf-protection';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyReply } from 'fastify';
import { AppError } from '../errors/app-error.js';
import { ERROR_CODES, type ErrorCode } from '../errors/error-codes.js';

const CSRF_ERROR_PREFIX = 'FST_CSRF';

function isCsrfError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code } = error as { code?: unknown };
  return typeof code === 'string' && code.startsWith(CSRF_ERROR_PREFIX);
}

/** The real reply with `send` replaced: the plugin's failure becomes the hook's error instead of a response. */
function replyObserver(reply: FastifyReply, fail: (error: unknown) => void): FastifyReply {
  const observer = Object.create(reply) as FastifyReply;
  Object.defineProperty(observer, 'send', {
    value: (payload: unknown): FastifyReply => {
      fail(isCsrfError(payload) ? new AppError('ERP-AUTH-0008') : payload);
      return observer;
    },
  });
  return observer;
}

/** One session cookie as it was set, so a clearing line carries the same Path and SameSite. */
export interface SessionCookieSpec {
  readonly name: string;
  readonly path: string;
  readonly sameSite: 'strict' | 'lax';
}

export interface HttpSecurityOptions {
  readonly csrfCookie: { readonly name: string; readonly path: string };
  /** Lower-case header name the client echoes the token in. */
  readonly csrfHeader: string;
  /** Full paths (prefix included) whose `POST` requires the CSRF token. */
  readonly csrfProtectedPaths: readonly string[];
  /** A `POST` to `path` answered 401 with one of `codes` clears `cookies` (ADR-0037). */
  readonly sessionEnd: {
    readonly path: string;
    readonly codes: readonly ErrorCode[];
    readonly cookies: readonly SessionCookieSpec[];
  };
}

/** The problem body's `code`, or `undefined` for anything that is not a problem JSON object. */
function problemCode(payload: unknown): string | undefined {
  let text: string;
  if (typeof payload === 'string') text = payload;
  else if (Buffer.isBuffer(payload)) text = payload.toString('utf8');
  else return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { code } = parsed as { code?: unknown };
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

export interface FastifyPluginOptions {
  /** `Secure` attribute on the CSRF secret cookie (`AUTH_COOKIE_SECURE`). */
  readonly cookieSecure: boolean;
}

export async function registerFastifyPlugins(
  app: NestFastifyApplication,
  security: HttpSecurityOptions,
  opts: FastifyPluginOptions,
): Promise<void> {
  await app.register(fastifyCookie);
  await app.register(fastifyCsrf, {
    sessionPlugin: '@fastify/cookie',
    cookieKey: security.csrfCookie.name,
    cookieOpts: {
      path: security.csrfCookie.path,
      httpOnly: true,
      sameSite: 'strict',
      secure: opts.cookieSecure,
      signed: false,
    },
    getToken: (req) => {
      const value = req.headers[security.csrfHeader];
      return typeof value === 'string' ? value : undefined;
    },
  });
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (req, reply, done) => {
    const path = req.url.split('?')[0] ?? '';
    if (req.method === 'POST' && security.csrfProtectedPaths.includes(path)) {
      fastify.csrfProtection(
        req,
        replyObserver(reply, (error) => {
          done(error instanceof Error ? error : new Error(String(error)));
        }),
        done,
      );
    } else {
      done();
    }
  });
  const { sessionEnd } = security;
  fastify.addHook('onSend', (req, reply, payload, done) => {
    const path = req.url.split('?')[0] ?? '';
    const code = sessionEnd.codes.find((c) => c === problemCode(payload));
    // The status is the code's own (401 for 0002/0003, from ERROR_CODES), never a literal here.
    if (
      req.method === 'POST' &&
      path === sessionEnd.path &&
      code !== undefined &&
      reply.statusCode === ERROR_CODES[code].status
    ) {
      for (const c of sessionEnd.cookies) {
        void reply.clearCookie(c.name, {
          httpOnly: true,
          sameSite: c.sameSite,
          secure: opts.cookieSecure,
          path: c.path,
        });
      }
    }
    done(null, payload);
  });
}

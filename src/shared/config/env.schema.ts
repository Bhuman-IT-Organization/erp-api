// The only file that may read process.env — enforced by the `process.env` `no-restricted-syntax` scope in `eslint.config.mjs` (BE-06).
import { z } from 'zod';

/**
 * Variables only the unit suite (`NODE_ENV=test`) may omit, each with the reason it is required
 * everywhere else.
 */
const REQUIRED_OUTSIDE_TEST = [
  [
    'REDIS_URL',
    'REDIS_URL is required (the auth module stores sessions in Redis, ADR-0005); only NODE_ENV=test may omit it',
  ],
  [
    'LEGACY_BASE_URL',
    "LEGACY_BASE_URL is required (the api's own calls to the legacy system go through the legacy breaker, ADR-0031); only NODE_ENV=test may omit it",
  ],
  [
    'FILE_STORAGE_DIR',
    'FILE_STORAGE_DIR is required (Node stores uploaded files on its own volume, ADR-0041); only NODE_ENV=test may omit it',
  ],
  [
    'PUBLIC_BASE_URL',
    'PUBLIC_BASE_URL is required (email links and the logo are absolute, ADR-0049); only NODE_ENV=test may omit it',
  ],
] as const;

/** The SMTP variables that only make sense together with SMTP_HOST (D-02: all or none). */
const SMTP_DEPENDENT = [
  'SMTP_PORT',
  'SMTP_ENCRYPTION',
  'SMTP_USERNAME',
  'SMTP_PASSWORD',
  'MAIL_FROM_ADDRESS',
  'MAIL_FROM_NAME',
] as const;

/** Required as soon as SMTP_HOST is set; SMTP_USERNAME and SMTP_PASSWORD stay optional (an open relay). */
const SMTP_REQUIRED_WITH_HOST = [
  'SMTP_PORT',
  'SMTP_ENCRYPTION',
  'MAIL_FROM_ADDRESS',
  'MAIL_FROM_NAME',
] as const;

/**
 * The modules a deployment can switch off with MODULES_DISABLED (ADR-0042). A later module appends
 * its name here and its 403 code to `MODULE_DISABLED_CODES` in `modules.ts`, which re-exports
 * these (they live here because this file must not import `modules.ts`: that file imports
 * `AppConfig`, which imports this one). erp-web mirrors the list in `src/config/modules.ts`.
 * No module of this copy is switchable yet, so the list is empty and any non-empty value fails boot.
 */
export const MODULE_NAMES = [] as const;

/** One switchable module's name. */
export type ModuleName = (typeof MODULE_NAMES)[number];

function isModuleName(name: string): name is ModuleName {
  return (MODULE_NAMES as readonly string[]).includes(name);
}

/**
 * Reads MODULES_DISABLED: split on ',', trim, drop empties, de-duplicate, keep the order. An unknown
 * name throws, so a typo fails boot instead of leaving a module silently on (T-4.2-79).
 */
export function parseModulesDisabled(raw: string): readonly ModuleName[] {
  const names: ModuleName[] = [];
  for (const name of raw.split(',').map((part) => part.trim())) {
    if (name === '') continue;
    if (!isModuleName(name)) {
      throw new Error(
        `MODULES_DISABLED names an unknown module: ${name} (known: ${MODULE_NAMES.join(', ') || 'none'})`,
      );
    }
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** True for an http or https origin: no path beyond '/', no query, no fragment. */
function isBareOrigin(value: string): boolean {
  const url = new URL(value);
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  );
}

/** The fields the SMTP refinements read, as the object schema below types them. */
interface SmtpEnv {
  readonly NODE_ENV: 'development' | 'test' | 'production';
  readonly SMTP_HOST?: string | undefined;
  readonly SMTP_PORT?: number | undefined;
  readonly SMTP_ENCRYPTION?: 'ssl' | 'tls' | 'none' | undefined;
  readonly SMTP_USERNAME?: string | undefined;
  readonly SMTP_PASSWORD?: string | undefined;
  readonly MAIL_FROM_ADDRESS?: string | undefined;
  readonly MAIL_FROM_NAME?: string | undefined;
  readonly PUBLIC_BASE_URL?: string | undefined;
}

type AddIssue = (path: string, message: string) => void;

/** SMTP is all or none: SMTP_HOST with its four companions, or nothing (D-02). */
function refineSmtpPresence(env: SmtpEnv, issue: AddIssue): void {
  if (env.SMTP_HOST === undefined) {
    if (SMTP_DEPENDENT.some((key) => env[key] !== undefined)) {
      issue(
        'SMTP_HOST',
        'SMTP_HOST is required when any SMTP_ or MAIL_FROM_ variable is set (D-02: SMTP is all or none)',
      );
    }
  } else {
    for (const key of SMTP_REQUIRED_WITH_HOST.filter((k) => env[k] === undefined)) {
      issue(key, `${key} is required when SMTP_HOST is set (D-02)`);
    }
  }
}

/**
 * The password comes with a username and only with one, production never sends credentials
 * without TLS, and PUBLIC_BASE_URL is a bare origin (ADR-0049, T-4.3-07).
 */
function refineSmtpSecurity(env: SmtpEnv, issue: AddIssue): void {
  if (env.SMTP_USERNAME !== undefined && env.SMTP_PASSWORD === undefined) {
    issue('SMTP_PASSWORD', 'SMTP_PASSWORD is required when SMTP_USERNAME is set');
  }
  if (env.SMTP_USERNAME === undefined && env.SMTP_PASSWORD !== undefined) {
    issue('SMTP_PASSWORD', 'SMTP_PASSWORD is set without SMTP_USERNAME');
  }
  if (
    env.NODE_ENV === 'production' &&
    env.SMTP_ENCRYPTION === 'none' &&
    env.SMTP_USERNAME !== undefined
  ) {
    issue(
      'SMTP_ENCRYPTION',
      'SMTP_ENCRYPTION=none with SMTP_USERNAME would send credentials in clear; production requires ssl or tls (ADR-0049)',
    );
  }
  if (env.PUBLIC_BASE_URL !== undefined && !isBareOrigin(env.PUBLIC_BASE_URL)) {
    issue(
      'PUBLIC_BASE_URL',
      'PUBLIC_BASE_URL must be http or https with no path, query or fragment',
    );
  }
}

/** True when the queue database is auth's or the cache's (REDIS_URL's path; no path is db 0). */
function queueDatabaseClashes(env: {
  QUEUE_REDIS_DB: number;
  AUTH_REDIS_DB: number;
  REDIS_URL?: string | undefined;
}): boolean {
  const cacheDb =
    env.REDIS_URL === undefined ? 0 : Number(new URL(env.REDIS_URL).pathname.slice(1));
  return env.QUEUE_REDIS_DB === env.AUTH_REDIS_DB || env.QUEUE_REDIS_DB === cacheDb;
}

/**
 * Every environment variable erp-api understands, with its type and default.
 * This schema is the documentation of the environment: there is no `.env` file in this
 * repository (ADR-0014). Values are rendered by erp-infra into `env/local/api.host.env`
 * (host runs) and `env/local/api.env` (Compose).
 *
 * Env holds deployment-varying values only: URLs, secrets, flags, the pool budget. TTLs and
 * timeouts are code — `src/shared/config/timings.ts` (ADR-0031 §1).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    /**
     * mysql://user:pw@host:port/db — locally always 127.0.0.1:33061 (the legacy-local stack).
     * erp-infra may render `connection_limit` (the environment's pool budget); when it is absent
     * `PrismaService` appends `POOL.db.api` and the `TIMINGS.db` timeouts (ADR-0031 §4).
     */
    DATABASE_URL: z.url(),
    /**
     * The ownership guard (src/shared/db/ownership-guard.ts) rejects writes to tables not owned
     * by `node`. `off` is accepted only in production (erp-docs
     * 03-architecture/05-strangler-fig-migration.md: the runtime guard is the dev/uat second line;
     * CI is the first).
     */
    OWNERSHIP_GUARD: z.enum(['enforce', 'off']).default('enforce'),
    /**
     * redis://host:port/db — locally 127.0.0.1:63791 on the host, redis:6379 inside Compose.
     * Required outside `NODE_ENV=test`: the auth module stores sessions in Redis (ADR-0005), so a
     * process without Redis must refuse to boot rather than fail on the first login (T-1.3-11).
     * Only the unit suite may omit it; then no client is created and no `redis` probe is registered.
     */
    REDIS_URL: z.url().optional(),
    /**
     * Origin the api uses for its OWN HTTP calls to the legacy system (`http://legacy:80` in
     * Compose, `http://127.0.0.1:8080` on the host; rendered by erp-infra). Every call goes
     * through the `legacy` breaker (ADR-0031 §3). Never used for the browser's handoff, which
     * stays browser → Nginx → legacy. Required outside `NODE_ENV=test`.
     */
    LEGACY_BASE_URL: z.url().optional(),
    /**
     * Logical Redis database for auth keys (sessions, lockouts, versions). The session store
     * opens its own ioredis client with `{ db: AUTH_REDIS_DB }`; the cache client stays on the
     * database in REDIS_URL (`/0`). ADR-0005: one client per purpose.
     */
    AUTH_REDIS_DB: z.coerce.number().int().min(0).max(15).default(1),
    /**
     * Logical Redis database for BullMQ queues, their dead-letter queues and repeatable-job locks
     * (BE-14: db 2 under the `bull` prefix). Refused when it equals AUTH_REDIS_DB or the cache
     * database in REDIS_URL: a queue sharing auth's database could evict or collide with sessions
     * (T-4.2-33).
     */
    QUEUE_REDIS_DB: z.coerce.number().int().min(0).max(15).default(2),
    /**
     * Which pool budget this process takes from `POOL.db` (ADR-0031 §4): `api` for `main.ts`,
     * `worker` for `worker.ts`. `PrismaService` appends that `connection_limit` only when the
     * rendered DATABASE_URL carries none; the environment's budget wins.
     */
    DB_POOL_ROLE: z.enum(['api', 'worker']).default('api'),
    /**
     * The modules this deployment switches off (ADR-0042, Phase 4.2 P-01): a comma-separated list
     * of `MODULE_NAMES`, default empty, so every module is on. A switched-off module's api answers
     * its 403 code and `/me` names it so the web hides it. An unknown name fails boot rather than
     * leaving a module silently on. Nothing records who switched it or when; it is the
     * deployment's own value, and nothing outside the system reads or writes it.
     */
    MODULES_DISABLED: z
      .string()
      .default('')
      .transform((raw, ctx) => {
        try {
          return parseModulesDisabled(raw);
        } catch (error) {
          ctx.addIssue({ code: 'custom', message: (error as Error).message });
          return z.NEVER;
        }
      }),
    /**
     * base64 of a PKCS8 PEM (RS256 private key). Rendered per machine by erp-infra into
     * `env/local/api*.env` from `env/local/auth-jwt-private.pem`; never committed. The schema only
     * requires a non-empty string; the token issuer decodes it (ADR-0005).
     */
    AUTH_JWT_PRIVATE_KEY_PEM: z.string().min(1),
    /** `iss` claim of every access token and the value the guard verifies against. */
    AUTH_JWT_ISSUER: z.string().min(1).default('erp-api'),
    /** `aud` claim of every access token and the value the guard verifies against. */
    AUTH_JWT_AUDIENCE: z.string().min(1).default('erp-web'),
    /**
     * `Secure` attribute on the refresh and CSRF cookies. Default `true`; the local template renders
     * `false` because the local stack is plain http (research open question 7; T-1.3-10).
     */
    AUTH_COOKIE_SECURE: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),
    /**
     * The SMTP server mail is sent through (D-02: SMTP is deployment configuration, rendered by
     * erp-infra, never in the database or in git; ADR-0014, ADR-0049). Absent: mail is not
     * configured, and the email adapter reports `configured: false` and opens no connection. Set:
     * SMTP_PORT, SMTP_ENCRYPTION, MAIL_FROM_ADDRESS and MAIL_FROM_NAME are required too.
     */
    SMTP_HOST: z.string().min(1).max(253).optional(),
    /** The SMTP server's port (D-02, ADR-0049); locally Mailpit's 1025 (Compose) or 11025 (host). */
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    /**
     * Perfex's words for the transport security (D-02, ADR-0049): `ssl` implicit TLS, `tls`
     * STARTTLS required, `none` no TLS required. Production refuses `none` together with
     * SMTP_USERNAME (credentials in clear, T-4.3-07).
     */
    SMTP_ENCRYPTION: z.enum(['ssl', 'tls', 'none']).optional(),
    /** The SMTP login (D-02, ADR-0049); absent for a relay without authentication. */
    SMTP_USERNAME: z.string().min(1).max(255).optional(),
    /**
     * The SMTP password, a secret (D-02, ADR-0014: sops-encrypted outside local): required with
     * SMTP_USERNAME and refused without it; never logged, never in a response (ADR-0049, T-4.3-06).
     */
    SMTP_PASSWORD: z.string().min(1).max(1024).optional(),
    /** The From address of every email, one per deployment (D-02, D-09, ADR-0049). */
    MAIL_FROM_ADDRESS: z.email().optional(),
    /** The From display name of every email, one per deployment (D-02, D-09, ADR-0049). */
    MAIL_FROM_NAME: z.string().trim().min(1).max(100).optional(),
    /**
     * The deployment's browser origin (`http://localhost:8088` locally): email links, the logo
     * and the Message-ID host are made absolute with it (ADR-0049, RESEARCH C6). An http or https
     * origin with no path, query or fragment. Required outside `NODE_ENV=test`.
     */
    PUBLIC_BASE_URL: z.url().optional(),
    /**
     * Overrides `TIMINGS.breaker.volumeThreshold` so the local stack proof (plan 01.3-09) can trip
     * a breaker with few calls. Exists for that proof only; refused when NODE_ENV=production
     * (ADR-0031, T-1.3-68).
     */
    RESILIENCE_BREAKER_VOLUME_THRESHOLD: z.coerce.number().int().min(1).optional(),
    /** Overrides `TIMINGS.breaker.halfOpenAfterMs` for the same proof; refused in production. */
    RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS: z.coerce.number().int().min(100).optional(),
    /**
     * Serves the Swagger UI at `/api/v1/docs` and the document at `/api/v1/openapi.json`
     * (`shared/http/openapi.ts`, BE-23). Default `true` outside production and `false` in it — a
     * public host never exposes its route map (T-2-26); the transform below applies the default
     * because it depends on NODE_ENV. When disabled neither route exists (404).
     */
    API_DOCS_ENABLED: z.stringbool().optional(),
    /**
     * Node's own file storage (ADR-0041, Phase 4.2 D-17): the directory `VolumeStorage` writes
     * under, with tus staging in its `.tus` folder. erp-infra renders `/var/lib/erp/files` for the
     * container (the files volume) and `../erp-infra/.local/files` for host runs. Required outside
     * `NODE_ENV=test`, like REDIS_URL; a unit app without it gets a storage that refuses every call.
     */
    FILE_STORAGE_DIR: z.string().min(1).optional(),
    /** The largest upload in bytes (P-11, default 64 MB); a purpose may be stricter, never looser. */
    UPLOAD_MAX_BYTES: z.coerce.number().int().min(1).max(1_073_741_824).default(67_108_864),
    /** Files per save the screens allow (P-11, default 10, as Perfex allows). */
    UPLOAD_MAX_FILES: z.coerce.number().int().min(1).max(50).default(10),
  })
  .superRefine((env, ctx) => {
    if (env.OWNERSHIP_GUARD === 'off' && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['OWNERSHIP_GUARD'],
        message: 'OWNERSHIP_GUARD=off is allowed only when NODE_ENV=production',
      });
    }
    if (queueDatabaseClashes(env)) {
      ctx.addIssue({
        code: 'custom',
        path: ['QUEUE_REDIS_DB'],
        message:
          'QUEUE_REDIS_DB must differ from AUTH_REDIS_DB and from the cache database in REDIS_URL (BE-14: queues on db 2)',
      });
    }
    if (env.NODE_ENV !== 'test') {
      for (const [key, message] of REQUIRED_OUTSIDE_TEST.filter(([k]) => env[k] === undefined)) {
        ctx.addIssue({ code: 'custom', path: [key], message });
      }
    }
    if (env.NODE_ENV === 'production') {
      for (const key of [
        'RESILIENCE_BREAKER_VOLUME_THRESHOLD',
        'RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS',
      ] as const) {
        if (env[key] !== undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message:
              'RESILIENCE_BREAKER_* overrides exist for the local stack proof only (ADR-0031); production uses TIMINGS.breaker',
          });
        }
      }
    }
    const issue: AddIssue = (path, message) => {
      ctx.addIssue({ code: 'custom', path: [path], message });
    };
    refineSmtpPresence(env, issue);
    refineSmtpSecurity(env, issue);
  })
  .transform((env) => ({
    ...env,
    API_DOCS_ENABLED: env.API_DOCS_ENABLED ?? env.NODE_ENV !== 'production',
  }));

export type Env = z.infer<typeof envSchema>;

/** Parses and validates the environment. Throws a ZodError on a bad or missing variable. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

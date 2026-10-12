/**
 * "Every endpoint documented" as a test (erp-docs 02-coding-rules/05-backend.md BE-23, threat
 * T-2-28): the whole
 * `V1Module` (every controller registered in `v1.module.ts` — a module added there is covered
 * automatically) plus the shared health controller boot in-process with docs enabled; the route
 * table comes from Fastify's `onRoute` hook (the same source every `<m>.controller.e2e.spec.ts`
 * uses for the ADR-0030 assertion) and the document from `/api/v1/openapi.json`. Every non-HEAD
 * route must have an operation; every operation a 2xx response with a schema (or an explicit
 * 204 without one) and `x-request-id`; every problem+json `code` must be in `ERROR_CODES`; and
 * two builds must serialise to the same bytes. No database, Redis or network: `PrismaService` is
 * constructed against the stub URL and never queried; `RedisService` has no client without
 * `REDIS_URL`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IntegrationsModule } from '../../integrations/integrations.module.js';
import { CacheModule } from '../../shared/cache/cache.module.js';
import { DbModule } from '../../shared/db/db.module.js';
import { ERROR_CODES } from '../../shared/errors/error-codes.js';
import { PROBLEM_CONTENT_TYPE } from '../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../shared/http/api-prefix.js';
import { IdempotencyModule } from '../../shared/http/interceptors/idempotency.module.js';
import { exportPrintRowsSchema } from '../../shared/http/export.js';
import {
  DOCS_PATH,
  OPENAPI_PATH,
  OPENAPI_VERSION,
  buildOpenApiDocument,
  zodToSchema,
  type OpenApiDocument,
} from '../../shared/http/openapi.js';
import { PDF_CONTENT_TYPE } from '../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../shared/http/xlsx.js';
import { REQUEST_ID_HEADER } from '../../shared/logger/request-context.js';
import { QueueModule } from '../../shared/queue/queue.module.js';
import { createAuthTestApp, type AuthTestApp } from '../auth/__tests__/create-auth-test-app.js';
import {
  createIdentityTestApp,
  type IdentityTestApp,
} from '../identity/__tests__/create-identity-test-app.js';
import { V1Module } from '../v1.module.js';

const OPENAPI_URL = `/${API_PREFIX}/${OPENAPI_PATH}`;
const DOCS_URL = `/${API_PREFIX}/${DOCS_PATH}`;
const HTTP_OK = 200;
const HTTP_FIRST_REDIRECT = 300;

interface ResponseEntry {
  readonly headers?: Record<string, unknown>;
  readonly content?: Record<
    string,
    { schema?: { allOf?: { properties?: Record<string, { enum?: unknown[] }> }[] } }
  >;
}
interface Operation {
  readonly summary?: string;
  readonly responses: Record<string, ResponseEntry>;
}

/** Fastify `:id` → OpenAPI `{id}`. */
const toOpenApiPath = (url: string): string => url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');

/**
 * The documentation routes themselves are not operations: they are `SwaggerModule`'s own
 * handlers and static assets (`/api/v1/docs`, `/api/v1/docs/*`, `/api/v1/openapi.json`), not
 * part of the API surface a client codes against.
 */
const isDocsRoute = (url: string): boolean => url === OPENAPI_URL || url.startsWith(DOCS_URL);

/**
 * Plan 04.1.1-02: what a list export's 200 documents, read from the document: its media types in
 * order, the CSV and print rows schemas and the header names. Compared whole with
 * `EXPORT_SUCCESS`, so a case reads one `expect`.
 */
function exportSuccessOf(document: OpenApiDocument, path: string): unknown {
  const operation = (document.paths[path] as Record<string, Operation> | undefined)?.get;
  const ok = operation?.responses['200'];
  return {
    summary: typeof operation?.summary,
    mediaTypes: Object.keys(ok?.content ?? {}),
    csv: ok?.content?.['text/csv']?.schema,
    print: ok?.content?.['application/json']?.schema,
    headers: Object.keys(ok?.headers ?? {}).sort(),
  };
}

/** CSV (a string), Excel and PDF (binary: no schema in OpenAPI 3.1), then the print rows. */
const EXPORT_SUCCESS = {
  summary: 'string',
  mediaTypes: ['text/csv', XLSX_CONTENT_TYPE, PDF_CONTENT_TYPE, 'application/json'],
  csv: { type: 'string' },
  print: zodToSchema(exportPrintRowsSchema, 'output'),
  headers: ['Cache-Control', 'Content-Disposition', REQUEST_ID_HEADER].sort(),
};

describe('every registered route is in the OpenAPI document (BE-23)', () => {
  let ctx: AuthTestApp;
  let served: OpenApiDocument;

  beforeAll(async () => {
    // The globals AppModule gives V1Module: the queue as a producer (no REDIS_URL: nothing connects)
    // and the email port (no SMTP_HOST: not configured), which v1/mail injects since plan 04.3-06;
    // and the idempotency store, which v1/mail's keyed handlers resolve since plan 04.3-07.
    ctx = await createAuthTestApp({
      imports: [
        DbModule,
        CacheModule,
        IdempotencyModule,
        QueueModule.forRoot({ runWorkers: false }),
        IntegrationsModule,
        V1Module,
      ],
      docs: true,
    });
    const res = await ctx.app.inject({ method: 'GET', url: OPENAPI_URL });
    expect(res.statusCode).toBe(HTTP_OK);
    served = JSON.parse(res.payload) as OpenApiDocument;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('serves a 3.1 document that equals buildOpenApiDocument(app) byte for byte, twice', () => {
    expect(served.openapi).toBe(OPENAPI_VERSION);
    const first = JSON.stringify(buildOpenApiDocument(ctx.app));
    expect(first).toBe(JSON.stringify(buildOpenApiDocument(ctx.app)));
    expect(first).toBe(JSON.stringify(served));
  });

  it('every non-HEAD route under /api/v1/ or in UNPREFIXED_ROUTES has an operation (docs routes excluded)', () => {
    const unprefixed = new Set(UNPREFIXED_ROUTES.map((route) => `/${route}`));
    const routes = ctx.routeTable.filter((r) => r.method !== 'HEAD' && !isDocsRoute(r.url));
    expect(routes.length).toBeGreaterThanOrEqual(10);
    const undocumented = routes
      .filter((r) => r.url.startsWith(`/${API_PREFIX}/`) || unprefixed.has(r.url))
      .filter((r) => {
        // SwaggerModule emits a bare operation for every Nest route; only @ApiZod gives it a summary.
        const item = served.paths[toOpenApiPath(r.url)] as Record<string, Operation> | undefined;
        return typeof item?.[r.method.toLowerCase()]?.summary !== 'string';
      })
      .map((r) => `${r.method} ${r.url}`);
    expect(
      undocumented,
      `undocumented routes — add @ApiZod({ … }) to the handler: ${undocumented.join(', ')}`,
    ).toEqual([]);
    // Every documented path is a registered route, too (the document never claims a route that does not exist).
    const registered = new Set(
      routes.map((r) => `${r.method.toLowerCase()} ${toOpenApiPath(r.url)}`),
    );
    for (const [path, item] of Object.entries(served.paths)) {
      for (const method of Object.keys(item)) {
        expect(
          registered.has(`${method} ${path}`),
          `${method} ${path} is documented but not registered`,
        ).toBe(true);
      }
    }
  });

  it("every operation has a 2xx response with an application/json schema (or an explicit 204 without a body, or the export kind's text/csv string) and x-request-id on every response", () => {
    for (const [path, item] of Object.entries(served.paths)) {
      for (const [method, operation] of Object.entries(item as Record<string, Operation>)) {
        const where = `${method.toUpperCase()} ${path}`;
        const statuses = Object.keys(operation.responses).map(Number);
        const success = statuses.filter((s) => s >= HTTP_OK && s < HTTP_FIRST_REDIRECT);
        expect(success, `${where}: no 2xx response — @ApiZod responses`).not.toEqual([]);
        for (const status of success) {
          const entry = operation.responses[String(status)];
          // A `produces: 'export'` handler (every list export) documents its CSV as a string beside the print rows schema, as the identity block reads it.
          const schema =
            entry?.content?.['application/json']?.schema ?? entry?.content?.['text/csv']?.schema;
          if (status === 204)
            expect(entry?.content, `${where}: 204 carries no body`).toBeUndefined();
          else
            expect(
              schema,
              `${where}: ${String(status)} has no application/json schema`,
            ).toBeDefined();
        }
        for (const [status, entry] of Object.entries(operation.responses)) {
          expect(entry.headers, `${where}: ${status} lacks ${REQUEST_ID_HEADER}`).toHaveProperty(
            REQUEST_ID_HEADER,
          );
        }
      }
    }
  });

  it('the expense categories export documents its 200 as CSV, xlsx, PDF and print rows (plan 04.1.1-02)', () => {
    const path = '/api/v1/expense-categories/export';
    expect(exportSuccessOf(served, path), path).toEqual(EXPORT_SUCCESS);
  });

  it('the generated example-item export documents its 200 as CSV, xlsx, PDF and print rows (plan 04.1.1-02)', () => {
    const path = '/api/v1/example-item/export';
    expect(exportSuccessOf(served, path), path).toEqual(EXPORT_SUCCESS);
  });

  it('every problem+json response enumerates codes that exist in ERROR_CODES', () => {
    let problems = 0;
    for (const [path, item] of Object.entries(served.paths)) {
      for (const [method, operation] of Object.entries(item as Record<string, Operation>)) {
        for (const [status, entry] of Object.entries(operation.responses)) {
          const schema = entry.content?.[PROBLEM_CONTENT_TYPE]?.schema;
          if (schema === undefined) continue;
          problems += 1;
          const codes = schema.allOf?.[1]?.properties?.code?.enum ?? [];
          expect(codes.length, `${method} ${path} ${status}: empty code enum`).toBeGreaterThan(0);
          for (const code of codes) {
            const known = typeof code === 'string' && code in ERROR_CODES;
            expect(known, `${method} ${path} ${status}: unknown code ${String(code)}`).toBe(true);
            if (!known) continue;
            expect(ERROR_CODES[code as keyof typeof ERROR_CODES].status).toBe(Number(status));
          }
        }
      }
    }
    expect(problems).toBeGreaterThan(5);
  });

  it('the UI answers at /api/v1/docs and neither docs path is in UNPREFIXED_ROUTES', async () => {
    const ui = await ctx.app.inject({ method: 'GET', url: DOCS_URL });
    expect(ui.statusCode).toBe(HTTP_OK);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(ctx.routes).toContain(OPENAPI_URL);
    expect(ctx.routes).toContain(DOCS_URL);
    expect([...UNPREFIXED_ROUTES].some((r) => r.includes('docs') || r.includes('openapi'))).toBe(
      false,
    );
  });
});

/**
 * Plan 03.2-05 found that the block above never saw `v1/identity`: `createAuthTestApp` replaces
 * `IdentityModule` with a facade-only fake (no controller), so none of the identity routes was in
 * that document. This block builds the document over the identity module's own in-process app and
 * applies the same checks, plus the exports' four-media-type 200 (`@ApiZod({ produces: 'export' })`).
 */
describe('every v1/identity route is in the OpenAPI document (BE-23)', () => {
  let ctx: IdentityTestApp;
  let document: OpenApiDocument;

  beforeAll(async () => {
    ctx = await createIdentityTestApp();
    document = buildOpenApiDocument(ctx.app);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('every identity route has an operation with a summary, and every documented path is registered', () => {
    const urls = [...new Set(ctx.routes)].filter((url) =>
      url.startsWith(`/${API_PREFIX}/identity`),
    );
    expect(urls.length).toBeGreaterThanOrEqual(10);
    const documented = new Set(Object.keys(document.paths));
    const missing = urls.filter((url) => !documented.has(toOpenApiPath(url)));
    expect(missing, `undocumented identity routes: ${missing.join(', ')}`).toEqual([]);
    for (const [path, item] of Object.entries(document.paths)) {
      expect(urls.map(toOpenApiPath), `${path} is documented but not registered`).toContain(path);
      for (const [method, operation] of Object.entries(item as Record<string, Operation>)) {
        expect(typeof operation.summary, `${method} ${path} has no summary`).toBe('string');
      }
    }
  });

  it("every identity operation has a 2xx with a JSON schema, an explicit 204, or the export kind's text/csv string; x-request-id everywhere", () => {
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(item as Record<string, Operation>)) {
        const where = `${method.toUpperCase()} ${path}`;
        const success = Object.keys(operation.responses)
          .map(Number)
          .filter((s) => s >= HTTP_OK && s < HTTP_FIRST_REDIRECT);
        expect(success, `${where}: no 2xx response`).not.toEqual([]);
        for (const status of success) {
          const content = operation.responses[String(status)]?.content;
          if (status === 204) expect(content, `${where}: 204 carries no body`).toBeUndefined();
          else
            expect(
              content?.['application/json']?.schema ?? content?.['text/csv']?.schema,
              `${where}: ${String(status)} has no schema`,
            ).toBeDefined();
        }
        for (const [status, entry] of Object.entries(operation.responses)) {
          expect(entry.headers, `${where}: ${status} lacks ${REQUEST_ID_HEADER}`).toHaveProperty(
            REQUEST_ID_HEADER,
          );
        }
      }
    }
  });

  it('the two exports document their 200 as CSV, xlsx, PDF and print rows (plan 04.1.1-02)', () => {
    for (const path of ['/api/v1/identity/members/export', '/api/v1/identity/roles/export']) {
      expect(exportSuccessOf(document, path), path).toEqual(EXPORT_SUCCESS);
    }
  });
});

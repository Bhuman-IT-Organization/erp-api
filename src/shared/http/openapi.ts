/**
 * API documentation as a generated artefact (erp-docs 02-coding-rules/05-backend.md BE-23).
 * A handler declares
 * `@ApiZod({ summary, body?, query?, params?, responses, errors?, security?, headers?, produces? })` once,
 * naming the zod schemas that already validate the wire; the JSON Schema of each is derived with
 * zod 4's `z.toJSONSchema()` — never written a second time, so the document cannot disagree with
 * the code (threat T-2-27). `@nestjs/swagger` turns the metadata into the OpenAPI 3.1 document and
 * serves the Swagger UI; `setupApiDocs` builds the document once at boot (T-2-30) and only when
 * `API_DOCS_ENABLED` is true — off by default in production, so a public host never exposes its
 * route map (T-2-26). Every error response is `application/problem+json` with the `ProblemDetails`
 * schema and the `code` enum of the codes the handler declares; `x-request-id` is documented on
 * every response. `openapi-covers-routes.spec.ts` fails when a registered route has no operation.
 */
import type { INestApplication } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  SwaggerModule,
  type ComponentsObject,
  type ContentObject,
  type HeadersObject,
  type InfoObject,
  type PathsObject,
  type ReferenceObject,
  type SchemaObject,
  type TagObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from '../errors/error-codes.js';
import { PROBLEM_CONTENT_TYPE } from '../errors/problem-details.filter.js';
import { REQUEST_ID_HEADER } from '../logger/request-context.js';
import { exportPrintRowsSchema } from './export.js';
import { PDF_CONTENT_TYPE } from './pdf.js';
import { HTTP_STATUS, isSuccessStatus } from './status.js';
import { XLSX_CONTENT_TYPE } from './xlsx.js';

/** `GET /api/v1/openapi.json` — the document (under `API_PREFIX`). */
export const OPENAPI_PATH = 'openapi.json' as const;
/** `GET /api/v1/docs` — the Swagger UI (under `API_PREFIX`). */
export const DOCS_PATH = 'docs' as const;
export const OPENAPI_VERSION = '3.1.0' as const;
/** `components.securitySchemes` key; applied to every operation unless `security: 'none'`. */
export const BEARER_SECURITY_SCHEME = 'bearer' as const;
export const PROBLEM_DETAILS_SCHEMA_NAME = 'ProblemDetails' as const;
const PROBLEM_DETAILS_REF = `#/components/schemas/${PROBLEM_DETAILS_SCHEMA_NAME}`;
const API_ZOD_METADATA = 'erp:api-zod';
const JSON_CONTENT_TYPE = 'application/json';
const CSV_CONTENT_TYPE = 'text/csv';

/** The wire shape of every error, exactly as `ProblemDetailsFilter` emits it (`issues` only for ERP-VALIDATION-0001). */
export const problemDetailsSchema = z
  .object({
    type: z.literal('about:blank'),
    status: z.number().int(),
    title: z.string(),
    detail: z.string(),
    code: z.string(),
    issues: z.unknown().optional(),
  })
  .meta({
    description:
      'RFC 9457 problem details; `code` is the ERP-* catalog entry (`ERP-HTTP-<status>` for a stray framework exception)',
  });

export interface ApiZodOptions {
  readonly summary: string;
  readonly body?: z.ZodType;
  readonly query?: z.ZodType;
  readonly params?: z.ZodType;
  /**
   * Status → response schema (`application/json`); `null` documents an empty body (204). At least
   * one 2xx is required by `openapi-covers-routes.spec.ts`; a non-2xx here is the rare JSON body
   * that is NOT a problem (health's 503 report) — every `AppError` goes in `errors`.
   */
  readonly responses: Readonly<Record<number, z.ZodType | null>>;
  /** Codes this handler can raise → the `code` enum of its problem+json responses, grouped by status. */
  readonly errors?: readonly ErrorCode[];
  /** `'bearer'` (default) applies the bearer security scheme; `'none'` marks a public route. */
  readonly security?: 'bearer' | 'none';
  /** Extra headers of the `responses` entries besides `x-request-id` (`Set-Cookie`, `Cache-Control`, …); problem responses carry `x-request-id` only. */
  readonly headers?: readonly string[];
  /**
   * `'export'` for a list export (plan 04.1.1-02, ADR-0043): one 200 documented as CSV (a string),
   * Excel and PDF (binary bodies, so no schema in OpenAPI 3.1) and the print rows
   * (`application/json`, `exportPrintRowsSchema`) instead of one `application/json` body, and
   * `responses` may omit it (a 200 entry there is replaced). Errors stay `application/problem+json`.
   */
  readonly produces?: 'export';
}

export interface OpenApiDocument {
  readonly openapi: typeof OPENAPI_VERSION;
  readonly info: InfoObject;
  readonly paths: PathsObject;
  readonly components: ComponentsObject;
  readonly tags?: TagObject[];
}

/** JSON Schema (draft 2020-12, what OpenAPI 3.1 embeds) of a zod schema; `$schema` stripped. */
export function zodToSchema(schema: z.ZodType, io: 'input' | 'output'): SchemaObject {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', unrepresentable: 'any', io });
  return Object.fromEntries(Object.entries(json).filter(([key]) => key !== '$schema'));
}

/** The options a handler was decorated with; `undefined` for an undocumented handler. */
export function apiZodOptionsOf(handler: object): ApiZodOptions | undefined {
  return Reflect.getMetadata(API_ZOD_METADATA, handler) as ApiZodOptions | undefined;
}

function responseHeaders(extra: readonly string[]): HeadersObject {
  const headers: HeadersObject = {
    [REQUEST_ID_HEADER]: {
      description: 'Request id, minted or echoed; travels in this header only, never in a body',
      schema: { type: 'string' },
    },
  };
  for (const name of extra) headers[name] = { schema: { type: 'string' } };
  return headers;
}

/** One `@ApiQuery` / `@ApiParam` per property of an object schema (`required` from the JSON Schema). */
function parameterDecorators(
  schema: z.ZodType,
  decorate: (options: {
    name: string;
    required: boolean;
    schema: SchemaObject;
    description?: string;
  }) => MethodDecorator,
  alwaysRequired: boolean,
): MethodDecorator[] {
  const json = zodToSchema(schema, 'input');
  const required = new Set(Array.isArray(json.required) ? json.required : []);
  return Object.entries(json.properties ?? {}).map(([name, property]) => {
    const propertySchema = property as SchemaObject;
    return decorate({
      name,
      required: alwaysRequired || required.has(name),
      schema: propertySchema,
      ...(propertySchema.description === undefined
        ? {}
        : { description: propertySchema.description }),
    });
  });
}

function jsonContent(schema: z.ZodType): ContentObject {
  return { [JSON_CONTENT_TYPE]: { schema: zodToSchema(schema, 'output') } };
}

/** A CSV body is a string on the wire; its columns are the handler's contract, stated in its README. */
function csvContent(): ContentObject {
  return { [CSV_CONTENT_TYPE]: { schema: { type: 'string' } } };
}

/**
 * A list export answers one of four bodies, chosen by its `format` query (ADR-0043): CSV text, an
 * Excel or PDF file (binary, so the media type carries no schema), or the print rows as JSON.
 */
function exportContent(): ContentObject {
  return {
    ...csvContent(),
    [XLSX_CONTENT_TYPE]: {},
    [PDF_CONTENT_TYPE]: {},
    ...jsonContent(exportPrintRowsSchema),
  };
}

function problemContent(codes: readonly ErrorCode[]): ContentObject {
  const withCodeEnum: SchemaObject = {
    allOf: [
      { $ref: PROBLEM_DETAILS_REF } satisfies ReferenceObject,
      { type: 'object', properties: { code: { type: 'string', enum: [...codes] } } },
    ],
  };
  return { [PROBLEM_CONTENT_TYPE]: { schema: withCodeEnum } };
}

function groupByStatus(codes: readonly ErrorCode[]): Map<number, ErrorCode[]> {
  const groups = new Map<number, ErrorCode[]>();
  for (const code of codes) {
    const { status } = ERROR_CODES[code];
    groups.set(status, [...(groups.get(status) ?? []), code]);
  }
  return groups;
}

/**
 * Stores the options as metadata on the handler and applies the `@nestjs/swagger` decorators
 * built from `z.toJSONSchema` (once, at class definition — never per request).
 */
export function ApiZod(options: ApiZodOptions): MethodDecorator {
  const successHeaders = responseHeaders(options.headers ?? []);
  const problemHeaders = responseHeaders([]);
  const decorators: MethodDecorator[] = [ApiOperation({ summary: options.summary })];
  if (options.body !== undefined) {
    decorators.push(ApiBody({ required: true, schema: zodToSchema(options.body, 'input') }));
  }
  if (options.query !== undefined) {
    decorators.push(...parameterDecorators(options.query, ApiQuery, false));
  }
  if (options.params !== undefined) {
    decorators.push(...parameterDecorators(options.params, ApiParam, true));
  }
  if (options.produces === 'export') {
    decorators.push(
      ApiResponse({
        status: HTTP_STATUS.OK,
        description: 'Success (CSV, Excel or PDF download, or print rows)',
        headers: successHeaders,
        content: exportContent(),
      }),
    );
  }
  for (const [statusText, schema] of Object.entries(options.responses)) {
    const status = Number(statusText);
    if (options.produces !== undefined && status === HTTP_STATUS.OK) continue;
    decorators.push(
      ApiResponse({
        status,
        description:
          schema === null
            ? 'No content'
            : isSuccessStatus(status)
              ? 'Success'
              : 'Same body shape as the success response',
        headers: successHeaders,
        ...(schema === null ? {} : { content: jsonContent(schema) }),
      }),
    );
  }
  for (const [status, codes] of groupByStatus(options.errors ?? [])) {
    decorators.push(
      ApiResponse({
        status,
        description: codes.map((code) => `${code}: ${ERROR_CODES[code].title}`).join('; '),
        headers: problemHeaders,
        content: problemContent(codes),
      }),
    );
  }
  if ((options.security ?? 'bearer') === 'bearer') {
    decorators.push(ApiBearerAuth(BEARER_SECURITY_SCHEME));
  }
  return (target, propertyKey, descriptor) => {
    Reflect.defineMetadata(API_ZOD_METADATA, options, descriptor.value as object);
    for (const decorate of decorators) decorate(target, propertyKey, descriptor);
  };
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `paths` keys, each path item's method keys and each operation's keys in a stable order. */
function sortPaths(paths: PathsObject): PathsObject {
  const out: Record<string, unknown> = {};
  for (const [path, item] of Object.entries(sortedRecord<unknown>(paths))) {
    if (!isRecord(item)) continue;
    const sortedItem = sortedRecord(item);
    for (const [method, operation] of Object.entries(sortedItem)) {
      if (isRecord(operation)) sortedItem[method] = sortedRecord(operation);
    }
    out[path] = sortedItem;
  }
  return out as PathsObject;
}

/** `SwaggerModule.createDocument` plus the shared components, with a deterministic key order. */
export function buildOpenApiDocument(app: INestApplication): OpenApiDocument {
  const document = SwaggerModule.createDocument(app, {
    openapi: OPENAPI_VERSION,
    info: {
      title: 'erp-api',
      version: 'v1',
      description:
        'Generated from the zod DTOs that validate every request and response (erp-docs 02-coding-rules/05-backend.md BE-23). Errors are application/problem+json.',
    },
    components: {
      schemas: { [PROBLEM_DETAILS_SCHEMA_NAME]: zodToSchema(problemDetailsSchema, 'output') },
      securitySchemes: {
        [BEARER_SECURITY_SCHEME]: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  });
  const components = document.components ?? {};
  return {
    openapi: OPENAPI_VERSION,
    info: document.info,
    paths: sortPaths(document.paths),
    components: {
      ...components,
      ...(components.schemas === undefined ? {} : { schemas: sortedRecord(components.schemas) }),
    },
    ...(document.tags === undefined ? {} : { tags: document.tags }),
  };
}

/**
 * No-op when disabled (neither path exists → 404). Otherwise builds the document once and serves
 * the UI at `/api/v1/docs` and the JSON at `/api/v1/openapi.json`. Call after `setGlobalPrefix`
 * and before `init`/`listen` (the UI's static assets are a Fastify plugin).
 */
export function setupApiDocs(app: INestApplication, enabled: boolean): void {
  if (!enabled) return;
  const document = buildOpenApiDocument(app);
  SwaggerModule.setup(DOCS_PATH, app, document, {
    useGlobalPrefix: true,
    jsonDocumentUrl: OPENAPI_PATH,
    raw: ['json'],
    customSiteTitle: 'erp-api',
  });
}

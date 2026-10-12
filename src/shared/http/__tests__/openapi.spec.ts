/**
 * The OpenAPI helper on a two-handler probe controller inside a real Nest + Fastify app: the JSON
 * Schema is derived from zod (never hand-written), `@ApiZod` metadata round-trips, problem+json
 * responses carry the declared `code` enum, the disabled mode registers no route (T-2-26) and the
 * enabled mode serves the document and the UI under the prefix.
 */
import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_PREFIX } from '../api-prefix.js';
import { exportPrintRowsSchema } from '../export.js';
import {
  ApiZod,
  BEARER_SECURITY_SCHEME,
  DOCS_PATH,
  OPENAPI_PATH,
  OPENAPI_VERSION,
  PROBLEM_DETAILS_SCHEMA_NAME,
  apiZodOptionsOf,
  buildOpenApiDocument,
  problemDetailsSchema,
  setupApiDocs,
  zodToSchema,
} from '../openapi.js';
import { PDF_CONTENT_TYPE } from '../pdf.js';
import { HTTP_STATUS } from '../status.js';
import { XLSX_CONTENT_TYPE } from '../xlsx.js';

const itemSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  parentId: z.number().int().nullable(),
  kind: z.enum(['a', 'b']),
  tags: z.array(z.string()),
});
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(HTTP_STATUS.OK).default(1),
  cursor: z.string().optional(),
});
const idParamsSchema = z.object({ id: z.string().min(1) });

@Controller('probe')
class ProbeController {
  @Get()
  @ApiZod({
    summary: 'list',
    query: listQuerySchema,
    responses: { [HTTP_STATUS.OK]: z.object({ data: z.array(itemSchema) }) },
    errors: ['ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-VALIDATION-0001'],
  })
  list(): { data: never[] } {
    return { data: [] };
  }

  @Post(':id')
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @ApiZod({
    summary: 'touch',
    params: idParamsSchema,
    body: itemSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    security: 'none',
    headers: ['Set-Cookie'],
  })
  touch(): void {
    /* nothing */
  }
}

interface Operation {
  readonly summary?: string;
  readonly security?: unknown[];
  readonly parameters?: { name: string; in: string; required?: boolean; schema: unknown }[];
  readonly requestBody?: { required?: boolean; content: Record<string, { schema: unknown }> };
  readonly responses: Record<
    string,
    {
      headers?: Record<string, unknown>;
      content?: Record<string, { schema: { allOf?: unknown[] } }>;
    }
  >;
}

async function createProbeApp(docsEnabled: boolean): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.setGlobalPrefix(API_PREFIX);
  setupApiDocs(app, docsEnabled);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('zodToSchema', () => {
  it('derives optional, nullable, enum and array fields into draft 2020-12 JSON Schema without $schema', () => {
    const schema = zodToSchema(itemSchema, 'output');
    expect(schema).not.toHaveProperty('$schema');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['id', 'parentId', 'kind', 'tags']);
    expect(schema.properties?.label).toEqual({ type: 'string' });
    expect(schema.properties?.parentId).toMatchObject({
      anyOf: [expect.objectContaining({ type: 'integer' }), { type: 'null' }],
    });
    expect(schema.properties?.kind).toEqual({ type: 'string', enum: ['a', 'b'] });
    expect(schema.properties?.tags).toEqual({ type: 'array', items: { type: 'string' } });
  });

  it('the problem-details schema is the filter output: type, status, title, detail, code required, issues optional', () => {
    const schema = zodToSchema(problemDetailsSchema, 'output');
    expect(schema.required).toEqual(['type', 'status', 'title', 'detail', 'code']);
    expect(Object.keys(schema.properties ?? {})).toEqual([
      'type',
      'status',
      'title',
      'detail',
      'code',
      'issues',
    ]);
    expect(schema.properties?.type).toEqual({ type: 'string', const: 'about:blank' });
  });
});

describe('@ApiZod', () => {
  it('stores its options as metadata on the handler', () => {
    const { list, touch } = ProbeController.prototype as unknown as Record<string, object>;
    const options = apiZodOptionsOf(list ?? {});
    expect(options?.summary).toBe('list');
    expect(options?.query).toBe(listQuerySchema);
    expect(options?.errors).toEqual(['ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-VALIDATION-0001']);
    expect(apiZodOptionsOf(touch ?? {})?.security).toBe('none');
  });
});

describe('buildOpenApiDocument', () => {
  let app: NestFastifyApplication;
  afterEach(async () => {
    await app.close();
  });

  it('is 3.1, holds the ProblemDetails schema and the bearer scheme, and is byte-stable across builds', async () => {
    app = await createProbeApp(false);
    const first = buildOpenApiDocument(app);
    expect(first.openapi).toBe(OPENAPI_VERSION);
    expect(first.components.schemas?.[PROBLEM_DETAILS_SCHEMA_NAME]).toBeDefined();
    expect(first.components.securitySchemes?.[BEARER_SECURITY_SCHEME]).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    expect(JSON.stringify(buildOpenApiDocument(app))).toBe(JSON.stringify(first));
    expect(Object.keys(first.paths)).toEqual(['/api/v1/probe', '/api/v1/probe/{id}']);
  });

  it('query and params become parameters with the zod-derived schema; the body is required application/json', async () => {
    app = await createProbeApp(false);
    const { paths } = buildOpenApiDocument(app);
    const list = paths['/api/v1/probe']?.get as Operation | undefined;
    expect(list?.summary).toBe('list');
    expect(list?.parameters?.map((p) => [p.name, p.in, p.required])).toEqual([
      ['limit', 'query', false],
      ['cursor', 'query', false],
    ]);
    expect(list?.parameters?.[0]?.schema).toMatchObject({
      type: 'integer',
      minimum: 1,
      default: 1,
    });
    expect(list?.security).toEqual([{ [BEARER_SECURITY_SCHEME]: [] }]);

    const touch = paths['/api/v1/probe/{id}']?.post as Operation | undefined;
    expect(touch?.parameters?.map((p) => [p.name, p.in, p.required])).toEqual([
      ['id', 'path', true],
    ]);
    expect(touch?.requestBody?.required).toBe(true);
    expect(touch?.requestBody?.content['application/json']?.schema).toEqual(
      zodToSchema(itemSchema, 'input'),
    );
    expect(touch?.security).toBeUndefined();
  });

  it('every declared code becomes a problem+json response with the code enum; x-request-id on every response; extra headers on the success only', async () => {
    app = await createProbeApp(false);
    const { paths } = buildOpenApiDocument(app);
    const list = paths['/api/v1/probe']?.get as Operation;
    expect(Object.keys(list.responses).sort()).toEqual(['200', '400', '401', '403']);
    const unauthorized = list.responses['401']?.content?.['application/problem+json']?.schema;
    expect(unauthorized?.allOf).toEqual([
      { $ref: `#/components/schemas/${PROBLEM_DETAILS_SCHEMA_NAME}` },
      { type: 'object', properties: { code: { type: 'string', enum: ['ERP-AUTH-0004'] } } },
    ]);
    for (const response of Object.values(list.responses)) {
      expect(response.headers).toHaveProperty('x-request-id');
    }
    const touch = paths['/api/v1/probe/{id}']?.post as Operation;
    expect(touch.responses['204']?.content).toBeUndefined();
    expect(touch.responses['204']?.headers).toHaveProperty('Set-Cookie');
  });
});

describe('setupApiDocs', () => {
  let app: NestFastifyApplication;
  afterEach(async () => {
    await app.close();
  });

  it('disabled: neither the document nor the UI is a route (404)', async () => {
    app = await createProbeApp(false);
    const json = await app.inject({ method: 'GET', url: `/${API_PREFIX}/${OPENAPI_PATH}` });
    const ui = await app.inject({ method: 'GET', url: `/${API_PREFIX}/${DOCS_PATH}` });
    expect(json.statusCode).toBe(404);
    expect(ui.statusCode).toBe(404);
  });

  it('enabled: /api/v1/openapi.json is the 3.1 document and /api/v1/docs is the Swagger UI', async () => {
    app = await createProbeApp(true);
    const json = await app.inject({ method: 'GET', url: `/${API_PREFIX}/${OPENAPI_PATH}` });
    expect(json.statusCode).toBe(200);
    expect(json.headers['content-type']).toContain('application/json');
    const document = JSON.parse(json.payload) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(document.openapi).toBe(OPENAPI_VERSION);
    expect(Object.keys(document.paths)).toEqual(['/api/v1/probe', '/api/v1/probe/{id}']);
    const ui = await app.inject({ method: 'GET', url: `/${API_PREFIX}/${DOCS_PATH}` });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(ui.payload).toContain('swagger-ui');
  });
});

/** Plan 04.1.1-02: a list export declares `produces: 'export'`: CSV, Excel, PDF or print rows. */
@Controller('export-probe')
class ExportProbeController {
  @Get()
  @ApiZod({
    summary: 'export',
    query: listQuerySchema,
    produces: 'export',
    responses: {},
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004'],
    headers: ['Content-Disposition', 'Cache-Control'],
  })
  exportAll(): string {
    return '';
  }
}

describe("@ApiZod({ produces: 'export' })", () => {
  let app: NestFastifyApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('stores produces in the metadata', () => {
    const { exportAll } = ExportProbeController.prototype as unknown as Record<string, object>;
    expect(apiZodOptionsOf(exportAll ?? {})?.produces).toBe('export');
  });

  it('documents one 200 as CSV, Excel, PDF and print rows, in that order, with the declared headers; errors stay problem+json', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ExportProbeController],
    }).compile();
    const exportApp = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app = exportApp;
    exportApp.setGlobalPrefix(API_PREFIX);
    await exportApp.init();
    const { paths } = buildOpenApiDocument(exportApp);
    const operation = paths['/api/v1/export-probe']?.get as Operation | undefined;
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual(['200', '400', '401']);
    const ok = operation?.responses['200'];
    expect(Object.keys(ok?.content ?? {})).toEqual([
      'text/csv',
      XLSX_CONTENT_TYPE,
      PDF_CONTENT_TYPE,
      'application/json',
    ]);
    expect(ok?.content?.['text/csv']?.schema).toEqual({ type: 'string' });
    // OpenAPI 3.1: a binary body carries no schema.
    expect(ok?.content?.[XLSX_CONTENT_TYPE]).toEqual({});
    expect(ok?.content?.[PDF_CONTENT_TYPE]).toEqual({});
    expect(ok?.content?.['application/json']?.schema).toEqual(
      zodToSchema(exportPrintRowsSchema, 'output'),
    );
    expect(ok?.headers).toHaveProperty('x-request-id');
    expect(ok?.headers).toHaveProperty('Content-Disposition');
    expect(ok?.headers).toHaveProperty('Cache-Control');
    expect(Object.keys(operation?.responses['400']?.content ?? {})).toEqual([
      'application/problem+json',
    ]);
  });
});

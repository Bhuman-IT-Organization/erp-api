import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProblemDetailsFilter } from '../../../shared/errors/problem-details.filter.js';
import { DOMAIN_EVENT_PUBLISHER } from '../../../shared/events/domain-event.publisher.js';
import { EventsModule } from '../../../shared/events/events.module.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthenticatedUser,
} from '../../../shared/http/auth/access-token-verifier.js';
import { registerRequestId } from '../../../shared/http/request-id.js';
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { SettingsFacade } from '../../settings/index.js';
import { SettingsModule } from '../../settings/settings.module.js';
import type { TodoListRequest, TodoRow } from '../model/todo.model.js';
import { TodoRepository } from '../repository/todo.repository.js';
import { TodoService } from '../service/todo.service.js';
import { TodoModule } from '../todo.module.js';
import { TODO_ROUTES } from '../todo.routes.js';

const HTTP = {
  ok: 200,
  created: 201,
  noContent: 204,
  bad: 400,
  unauthorized: 401,
  notFound: 404,
};

const LIST = `/${API_PREFIX}/${TODO_ROUTES.base}`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;

const TEST_BEARERS = {
  admin: 'todo-admin',
  member: 'todo-member',
} as const;

const TEST_NOW = new Date('2026-11-05T10:00:00.000Z');

const userOf = (staffId: number, isAdmin: boolean): AuthenticatedUser => ({
  staffId,
  sessionId: `sid-${String(staffId)}`,
  jti: `jti-${String(staffId)}`,
  isAdmin,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
});

const USERS: Readonly<Record<string, AuthenticatedUser>> = {
  [TEST_BEARERS.admin]: userOf(1, true),
  [TEST_BEARERS.member]: userOf(2, false),
};

class TodoTestVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return Promise.resolve(USERS[token] ?? null);
  }

  hasPermission(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useValue: new TodoTestVerifier(),
    },
  ],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class TodoTestVerifierModule {}

@Module({
  providers: [
    {
      provide: SettingsFacade,
      useValue: {
        getOption: vi.fn().mockResolvedValue('UTC'),
      },
    },
  ],
  exports: [SettingsFacade],
})
class TodoTestSettingsModule {}

function createTodoRow(
  id: number,
  staffId: number,
  description: string,
  overrides: Partial<TodoRow> = {},
): TodoRow {
  return {
    id,
    staffId,
    description,
    dateAdded: TEST_NOW,
    finished: false,
    dateFinished: null,
    itemOrder: id,
    ...overrides,
  };
}

function createRepository() {
  const rows: TodoRow[] = [createTodoRow(1, 1, 'Admin todo'), createTodoRow(2, 2, 'Member todo')];

  let nextId = 3;

  const repository = {
    list: vi.fn((staffId: number, request: TodoListRequest) => {
      const matching = rows
        .filter(
          (row) => row.staffId === staffId && row.finished === (request.status === 'finished'),
        )
        .filter((row) => {
          if (request.cursor === null) return true;

          const cursor = request.cursor;

          if (cursor.itemOrder === null) {
            return row.itemOrder !== null || row.id > cursor.todoid;
          }

          return (
            (row.itemOrder !== null && row.itemOrder > cursor.itemOrder) ||
            (row.itemOrder === cursor.itemOrder && row.id > cursor.todoid)
          );
        })
        .sort((a, b) => {
          if (a.itemOrder === null && b.itemOrder !== null) return -1;
          if (a.itemOrder !== null && b.itemOrder === null) return 1;

          return (a.itemOrder ?? 0) - (b.itemOrder ?? 0) || a.id - b.id;
        });

      return {
        items: matching.slice(0, request.limit),
        total: rows.filter(
          (row) => row.staffId === staffId && row.finished === (request.status === 'finished'),
        ).length,
        hasMore: matching.length > request.limit,
      };
    }),

    findById: vi.fn((staffId: number, id: number) => {
      return rows.find((row) => row.staffId === staffId && row.id === id) ?? null;
    }),

    create: vi.fn((input: { staffId: number; description: string; dateAdded: Date }) => {
      const row = createTodoRow(nextId++, input.staffId, input.description, {
        dateAdded: input.dateAdded,
        itemOrder: rows.filter((item) => item.staffId === input.staffId).length + 1,
      });
      rows.push(row);
      return row;
    }),

    updateDescription: vi.fn((staffId: number, id: number, description: string) => {
      const index = rows.findIndex((row) => row.staffId === staffId && row.id === id);
      if (index < 0) return null;

      const row = rows[index];
      if (!row) return null;

      const updated = { ...row, description };
      rows[index] = updated;
      return updated;
    }),

    setFinished: vi.fn(
      (staffId: number, id: number, finished: boolean, dateFinished: Date | null) => {
        const index = rows.findIndex((row) => row.staffId === staffId && row.id === id);
        if (index < 0) return null;

        const row = rows[index];
        if (!row) return null;

        const updated = { ...row, finished, dateFinished };
        rows[index] = updated;
        return updated;
      },
    ),

    remove: vi.fn((staffId: number, id: number) => {
      const index = rows.findIndex((row) => row.staffId === staffId && row.id === id);
      if (index < 0) return false;

      rows.splice(index, 1);
      return true;
    }),

    countUnfinished: vi.fn((staffId: number) => {
      return rows.filter((row) => row.staffId === staffId && !row.finished).length;
    }),
  };

  return {
    repository: repository as unknown as TodoRepository,
    rows,
  };
}

describe('TodoController (Fastify inject)', () => {
  let app: NestFastifyApplication | undefined;
  let rows: TodoRow[];
  let repository: ReturnType<typeof createRepository>['repository'];

  const publish = vi.fn().mockResolvedValue(undefined);
  const logger = {
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const bearer = (token: string) => ({
    authorization: `Bearer ${token}`,
  });

  function getApp(): NestFastifyApplication {
    if (!app) {
      throw new Error('Test application was not initialized');
    }

    return app;
  }

  beforeAll(async () => {
    const fake = createRepository();
    repository = fake.repository;
    rows = fake.rows;

    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, EventsModule, TodoTestVerifierModule, TodoModule],
    })
      .overrideModule(SettingsModule)
      .useModule(TodoTestSettingsModule)
      .overrideProvider(TodoRepository)
      .useValue(repository)
      .overrideProvider(DOMAIN_EVENT_PUBLISHER)
      .useValue({ publish })
      .overrideProvider(LoggerService)
      .useValue(logger)
      .compile();

    moduleRef.get(TodoService).now = () => TEST_NOW;

    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    registerRequestId(getApp());
    getApp().setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED_ROUTES] });
    getApp().useGlobalFilters(new ProblemDetailsFilter(logger as unknown as LoggerService));

    await getApp().init();
    await getApp().getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    rows.splice(
      0,
      rows.length,
      createTodoRow(1, 1, 'Admin todo'),
      createTodoRow(2, 2, 'Member todo'),
    );

    publish.mockClear();
    vi.clearAllMocks();
  });

  it('returns 401 without a valid bearer', async () => {
    const response = await getApp().inject({
      method: 'GET',
      url: `${LIST}?status=unfinished`,
    });

    expect(response.statusCode).toBe(HTTP.unauthorized);
  });

  it('allows a signed-in non-admin member to create a todo', async () => {
    const response = await getApp().inject({
      method: 'POST',
      url: LIST,
      headers: bearer(TEST_BEARERS.member),
      payload: { description: 'Prepare report' },
    });

    expect(response.statusCode).toBe(HTTP.created);
    expect(JSON.parse(response.payload)).toMatchObject({
      description: 'Prepare report',
      finished: false,
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('lists only the signed-in member todos', async () => {
    const response = await getApp().inject({
      method: 'GET',
      url: `${LIST}?status=unfinished`,
      headers: bearer(TEST_BEARERS.member),
    });

    expect(response.statusCode).toBe(HTTP.ok);

    const body = JSON.parse(response.payload) as {
      data: { description: string }[];
      meta: { total: number };
    };

    expect(body.data.map((item) => item.description)).toContain('Member todo');
    expect(body.data.map((item) => item.description)).not.toContain('Admin todo');
    expect(body.meta.total).toBe(1);
  });

  it('does not allow a member to read another member todo', async () => {
    const response = await getApp().inject({
      method: 'GET',
      url: record(1),
      headers: bearer(TEST_BEARERS.member),
    });

    expect(response.statusCode).toBe(HTTP.notFound);
  });

  it('updates the description of the member todo', async () => {
    const response = await getApp().inject({
      method: 'PATCH',
      url: record(2),
      headers: bearer(TEST_BEARERS.member),
      payload: { description: 'Updated member todo' },
    });

    expect(response.statusCode).toBe(HTTP.ok);
    const body = JSON.parse(response.payload) as { description: string };
    expect(body.description).toBe('Updated member todo');
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('does not update another member todo', async () => {
    const originalRow = rows.find((row) => row.id === 1);
    if (originalRow === undefined) throw new Error('Admin todo fixture not found');
    const original = { ...originalRow };

    const response = await getApp().inject({
      method: 'PATCH',
      url: record(1),
      headers: bearer(TEST_BEARERS.member),
      payload: { description: 'Unauthorized update' },
    });

    expect(response.statusCode).toBe(HTTP.notFound);
    expect(response.headers['content-type']).toContain('application/problem+json');

    const body = JSON.parse(response.payload) as { code: string };
    expect(body.code).toBe('ERP-CORE-0004');
    expect(rows.find((row) => row.id === 1)).toEqual(original);
  });

  it('finishes and reopens the member todo', async () => {
    const finished = await getApp().inject({
      method: 'PATCH',
      url: `${record(2)}/finished`,
      headers: bearer(TEST_BEARERS.member),
      payload: { finished: true },
    });

    expect(finished.statusCode).toBe(HTTP.ok);
    expect((JSON.parse(finished.payload) as { finished: boolean }).finished).toBe(true);

    const reopened = await getApp().inject({
      method: 'PATCH',
      url: `${record(2)}/finished`,
      headers: bearer(TEST_BEARERS.member),
      payload: { finished: false },
    });

    expect(reopened.statusCode).toBe(HTTP.ok);
    expect((JSON.parse(reopened.payload) as { finished: boolean }).finished).toBe(false);
  });

  it('does not finish or reopen another member todo', async () => {
    const originalRow = rows.find((row) => row.id === 1);
    if (originalRow === undefined) throw new Error('Admin todo fixture not found');
    const original = { ...originalRow };

    const response = await getApp().inject({
      method: 'PATCH',
      url: `${record(1)}/finished`,
      headers: bearer(TEST_BEARERS.member),
      payload: { finished: true },
    });

    expect(response.statusCode).toBe(HTTP.notFound);
    expect(response.headers['content-type']).toContain('application/problem+json');

    const body = JSON.parse(response.payload) as { code: string };
    expect(body.code).toBe('ERP-CORE-0004');
    expect(rows.find((row) => row.id === 1)).toEqual(original);
  });

  it('rejects an invalid create body', async () => {
    const response = await getApp().inject({
      method: 'POST',
      url: LIST,
      headers: bearer(TEST_BEARERS.member),
      payload: { description: '   ', staffid: 1 },
    });

    expect(response.statusCode).toBe(HTTP.bad);
  });

  it('returns 204 when the member deletes their own todo', async () => {
    const created = await getApp().inject({
      method: 'POST',
      url: LIST,
      headers: bearer(TEST_BEARERS.member),
      payload: { description: 'Delete this todo' },
    });

    const id = (JSON.parse(created.payload) as { id: string }).id;

    const deleted = await getApp().inject({
      method: 'DELETE',
      url: record(id),
      headers: bearer(TEST_BEARERS.member),
    });

    expect(deleted.statusCode).toBe(HTTP.noContent);
    expect(deleted.payload).toBe('');
  });

  it('does not delete another member todo', async () => {
    const response = await getApp().inject({
      method: 'DELETE',
      url: record(1),
      headers: bearer(TEST_BEARERS.member),
    });

    expect(response.statusCode).toBe(HTTP.notFound);
    expect(rows.some((row) => row.id === 1)).toBe(true);
  });
});

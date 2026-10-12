/**
 * DepartmentsRepository over a stub client: what it asks the database, not what the database answers
 * (the int spec proves that against the local mirror). The stub records every delegate call and
 * every tagged `$queryRaw` (its SQL text with `?` for each hole, and its bound values), and answers
 * the `information_schema` probe from a settable list of present columns with their `DATA_TYPE`, so
 * these cases prove the shapes the module depends on: D-51's runtime discovery (a missing line runs
 * no statement and counts 0, a present one is counted, with no code change between the two), exact
 * matching (integers as numbers, an integer line on a text column as bytes, comma lists and JSON
 * lists element by element), a self-parent never a child, the probe's names only in the bound
 * values, fail closed, the credential guard's allow-list on every row-returning call (D-48), no
 * write method at all (the table is Perfex's), the bounded `findAll` and the keyset list. The stub
 * delegate has only read methods, so a write would throw.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import {
  DEPARTMENTS_FACADE_MAX_ROWS,
  type DepartmentsListRequest,
} from '../model/departments.model.js';
import {
  DEPARTMENT_COLUMNS,
  DEPARTMENT_REFERENCES,
  DepartmentsRepository,
  idsInJson,
  idsInList,
  referenceKey,
} from '../repository/departments.repository.js';
import { NO_DEPARTMENT_USAGE } from '../service/departments.transformer.js';

/** The repository's constructor parameter, named without importing the database layer. */
type ClientHolder = ConstructorParameters<typeof DepartmentsRepository>[0];

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface PresentColumn {
  readonly t: string;
  readonly c: string;
  readonly d: string;
}

const PROBE = 'information_schema.COLUMNS';

/** Every register line present, an integer line as `int` and a list line as `text`. */
const ALL_PRESENT: readonly PresentColumn[] = DEPARTMENT_REFERENCES.map((reference) => ({
  t: reference.table,
  c: reference.column,
  d: reference.match === 'integerId' ? 'int' : 'text',
}));

/** The `table.column` a usage statement reads. */
function readKey(sql: string): string {
  const match = /^SELECT r\.(\w+) AS (?:id|v)\b.*? FROM (\w+) r /s.exec(sql);
  return match === null ? '' : `${match[2] ?? ''}.${match[1] ?? ''}`;
}

/** A bound `Prisma.join(...)` arrives as one value holding its own `values`. */
function isJoined(value: unknown): value is { values: unknown[] } {
  return (
    typeof value === 'object' && value !== null && 'values' in value && Array.isArray(value.values)
  );
}

function flatten(values: readonly unknown[]): unknown[] {
  return values.flatMap((value) => (isJoined(value) ? value.values : [value]));
}

/** One stored row as the delegate answers it through the six columns. */
function stored(departmentid: number, name = 'Sales') {
  return {
    departmentid,
    name,
    hidefromclient: false,
    calendar_id: null,
    manager_id: 0,
    parent_id: 0,
  };
}

interface StubOptions {
  /** What the probe answers (a live array: a case may push to it between two calls). */
  readonly columns?: PresentColumn[] | Error;
  /** What a usage statement answers per `table.column`; an `Error` rejects; absent answers `[]`. */
  readonly raw?: Readonly<Record<string, unknown>>;
  readonly rows?: readonly unknown[];
  readonly first?: unknown;
  readonly counts?: readonly number[];
}

function stub(options: StubOptions = {}) {
  const raw: RawCall[] = [];
  const calls: { method: string; args: unknown }[] = [];
  const counts = [...(options.counts ?? [])];
  const record =
    <T>(method: string, answer: () => Promise<T>) =>
    (args: unknown): Promise<T> => {
      calls.push({ method, args });
      return answer();
    };
  const delegate = {
    findMany: record('findMany', () => Promise.resolve(options.rows ?? [])),
    count: record('count', () => Promise.resolve(counts.shift() ?? 0)),
    findFirst: record('findFirst', () => Promise.resolve(options.first ?? null)),
  };
  const client = {
    tbldepartments: delegate,
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
      const sql = strings.join('?');
      raw.push({ sql, values: flatten(values) });
      if (sql.includes(PROBE)) {
        const columns = options.columns ?? ALL_PRESENT;
        return columns instanceof Error ? Promise.reject(columns) : Promise.resolve(columns);
      }
      const answer = options.raw?.[readKey(sql)] ?? [];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  const repository = new DepartmentsRepository({ client } as unknown as ClientHolder);
  return { repository, raw, calls };
}

function request(overrides: Partial<DepartmentsListRequest> = {}): DepartmentsListRequest {
  return { search: null, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const usageStatements = (raw: readonly RawCall[]): RawCall[] =>
  raw.filter((call) => !call.sql.includes(PROBE));

describe('DepartmentsRepository: the register (D-51, discovered at runtime as D-28)', () => {
  it('usageByDepartment([]) issues nothing: no probe, no statement', async () => {
    const { repository, raw, calls } = stub();
    expect((await repository.usageByDepartment([])).size).toBe(0);
    expect(raw).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('D-51: a missing column counts 0 and raises no error; a present column is counted', async () => {
    const columns: PresentColumn[] = [{ t: 'tblpur_orders', c: 'department', d: 'int' }];
    const { repository, raw } = stub({
      columns,
      raw: {
        'tblpur_orders.department': [{ id: 7, n: 2n }],
        'tbltickets.department': [{ id: 7, n: 3n }],
      },
    });

    const before = await repository.usageByDepartment([7, 9]);
    expect(raw).toHaveLength(2);
    expect(raw[0]?.sql).toContain(PROBE);
    expect(readKey(raw[1]?.sql ?? '')).toBe('tblpur_orders.department');
    expect(before.get(7)).toEqual({ ...NO_DEPARTMENT_USAGE, purchaseOrders: 2 });
    expect(before.get(9)).toEqual(NO_DEPARTMENT_USAGE);

    // tbltickets.department appears: no code change here.
    columns.push({ t: 'tbltickets', c: 'department', d: 'int' });
    raw.length = 0;
    const after = await repository.usageByDepartment([7, 9]);
    expect(usageStatements(raw).map((call) => readKey(call.sql))).toEqual([
      'tbltickets.department',
      'tblpur_orders.department',
    ]);
    expect(after.get(7)).toEqual({ ...NO_DEPARTMENT_USAGE, tickets: 3, purchaseOrders: 2 });
  });

  it('D-51: integers match exactly', async () => {
    const { repository, raw } = stub({
      columns: [
        { t: 'tbltickets', c: 'department', d: 'int' },
        { t: 'tblpur_request', c: 'department', d: 'varchar' },
      ],
      raw: {
        'tbltickets.department': [
          { id: 7, n: 2n },
          { id: 0, n: 5n },
          { id: 8, n: 5n },
          { id: 9n, n: 1 },
        ],
        'tblpur_request.department': [
          { id: '7', n: 3n },
          { id: '07', n: 5n },
          { id: '7 ', n: 5n },
          { id: ' 7', n: 5n },
          { id: '0', n: 5n },
        ],
      },
    });
    const usage = await repository.usageByDepartment([7, 9]);
    const byKey = new Map(usageStatements(raw).map((call) => [readKey(call.sql), call]));

    expect(byKey.get('tbltickets.department')?.sql).toBe(
      'SELECT r.department AS id, COUNT(*) AS n FROM tbltickets r WHERE r.department IN (?) GROUP BY r.department',
    );
    expect(byKey.get('tbltickets.department')?.values).toEqual([7, 9]);
    expect(byKey.get('tblpur_request.department')?.sql).toBe(
      'SELECT r.department AS id, COUNT(*) AS n FROM tblpur_request r WHERE CAST(r.department AS BINARY) IN (?) GROUP BY r.department',
    );
    expect(byKey.get('tblpur_request.department')?.values).toEqual(['7', '9']);

    expect(usage.get(7)).toEqual({ ...NO_DEPARTMENT_USAGE, tickets: 2, purchaseRequests: 3 });
    expect(usage.get(9)).toEqual({ ...NO_DEPARTMENT_USAGE, tickets: 1 });
  });

  it('D-51: a comma list matches whole elements only', async () => {
    const { repository, raw } = stub({
      columns: [{ t: 'tblwork_shift', c: 'department', d: 'varchar' }],
      raw: {
        'tblwork_shift.department': [
          { v: '3,7,9' },
          { v: '7' },
          { v: '7,7' },
          { v: '17,27' },
          { v: '7 ,8' },
          { v: '70' },
          { v: ' 7' },
          { v: '07' },
        ],
      },
    });
    const usage = await repository.usageByDepartment([7, 9]);
    expect(usage.get(7)?.workShifts).toBe(3);
    expect(usage.get(9)?.workShifts).toBe(1);
    const statements = usageStatements(raw);
    expect(statements).toHaveLength(1);
    expect(statements[0]?.sql).toBe(
      "SELECT r.department AS v FROM tblwork_shift r WHERE r.department IS NOT NULL AND r.department <> ''",
    );
    expect(statements[0]?.values).toEqual([]);

    // One statement per list line whatever the page size.
    raw.length = 0;
    await repository.usageByDepartment(Array.from({ length: 40 }, (_, index) => index + 1));
    expect(usageStatements(raw)).toHaveLength(1);
  });

  it('a list element is compared as text, never trimmed or cast', () => {
    const idTexts = new Map([
      ['7', 7],
      ['9', 9],
    ]);
    expect([...idsInList('3,7,9', idTexts)]).toEqual([7, 9]);
    expect([...idsInList('7,7', idTexts)]).toEqual([7]);
    expect([...idsInList('7 , 9', idTexts)]).toEqual([]);
    expect([...idsInList('7.0', idTexts)]).toEqual([]);
  });

  it('D-51: a JSON list matches whole elements only', async () => {
    const { repository, raw } = stub({
      columns: [{ t: 'tblhr_procedure_retire_manage', c: 'department', d: 'varchar' }],
      raw: {
        'tblhr_procedure_retire_manage.department': [
          { v: '[7]' },
          { v: '["7"]' },
          { v: '[7, "7", 9]' },
          { v: '["17"]' },
          { v: '[70]' },
          { v: '[[7]]' },
          { v: '{"a":7}' },
          { v: '"7"' },
          { v: '7' },
          { v: '[7' },
          { v: '[" 7"]' },
          { v: '[7.5]' },
        ],
      },
    });
    const usage = await repository.usageByDepartment([7, 9]);
    expect(usage.get(7)?.retirementProcedures).toBe(3);
    expect(usage.get(9)?.retirementProcedures).toBe(1);
    expect(usageStatements(raw)).toHaveLength(1);
    expect(usageStatements(raw)[0]?.sql).not.toMatch(/JSON_/);
  });

  it('a JSON element counts only as the number id or its decimal text', () => {
    const idTexts = new Map([['7', 7]]);
    expect([...idsInJson('[7, "7"]', idTexts)]).toEqual([7]);
    expect([...idsInJson('[7.0]', idTexts)]).toEqual([7]);
    expect([...idsInJson('["7.0"]', idTexts)]).toEqual([]);
    expect([...idsInJson('[true, null, {}, [7]]', idTexts)]).toEqual([]);
    expect([...idsInJson('not json', idTexts)]).toEqual([]);
  });

  it('D-51: a department naming itself as parent is not a child', async () => {
    const { repository, raw } = stub({
      columns: [{ t: 'tbldepartments', c: 'parent_id', d: 'int' }],
      raw: { 'tbldepartments.parent_id': [{ id: 7, n: 2n }] },
    });
    const usage = await repository.usageByDepartment([7]);
    const [statement] = usageStatements(raw);
    expect(statement?.sql).toBe(
      'SELECT r.parent_id AS id, COUNT(r.departmentid) AS n FROM tbldepartments r WHERE r.parent_id IN (?) AND r.departmentid <> r.parent_id GROUP BY r.parent_id',
    );
    expect(statement?.sql).not.toContain('*');
    expect(usage.get(7)?.childDepartments).toBe(2);
  });

  it.each(DEPARTMENT_REFERENCES)(
    'a use on $table.$column lands in the $group group',
    async (reference) => {
      const answer = reference.match === 'integerId' ? [{ id: 3, n: 1n }] : [{ v: '[3]' }];
      const listAnswer = reference.match === 'idList' ? [{ v: '3' }] : answer;
      const { repository } = stub({ raw: { [referenceKey(reference)]: listAnswer } });
      const usage = (await repository.usageByDepartment([3])).get(3);
      expect(usage).toEqual({ ...NO_DEPARTMENT_USAGE, [reference.group]: 1 });
    },
  );

  it('one statement per present line, every one in the same read', async () => {
    const { repository, raw } = stub();
    await repository.usageByDepartment([7, 9]);
    expect(raw).toHaveLength(1 + DEPARTMENT_REFERENCES.length);
    expect(usageStatements(raw).map((call) => readKey(call.sql))).toEqual(
      DEPARTMENT_REFERENCES.map(referenceKey),
    );
  });

  it('the probe binds every register table and column name: none is SQL text', async () => {
    const { repository, raw } = stub();
    const present = await repository.presentReferences();
    expect([...present.keys()]).toEqual(DEPARTMENT_REFERENCES.map(referenceKey));
    expect(raw).toHaveLength(1);
    const [probe] = raw;
    expect(probe?.sql).toBe(
      'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND COLUMN_NAME IN (?)',
    );
    for (const reference of DEPARTMENT_REFERENCES) {
      expect(probe?.values).toContain(reference.table);
      expect(probe?.values).toContain(reference.column);
      expect(probe?.sql).not.toContain(reference.table);
    }
  });

  it('the probe matches a line exactly, in any letter case, and only a declared pair', async () => {
    const { repository } = stub({
      columns: [
        { t: 'TBLTICKETS', c: 'DEPARTMENT', d: 'INT' },
        { t: 'tbltickets', c: 'departments', d: 'text' },
        { t: 'tblwork_shift', c: 'department_id', d: 'text' },
      ],
    });
    expect([...(await repository.presentReferences())]).toEqual([['tbltickets.department', 'int']]);
  });

  it('fails closed: a rejecting probe rejects the call', async () => {
    const { repository } = stub({ columns: new Error('information_schema unavailable') });
    await expect(repository.usageByDepartment([7])).rejects.toThrow(
      'information_schema unavailable',
    );
  });

  it('fails closed: a rejecting statement rejects the call', async () => {
    const { repository } = stub({
      raw: { 'tblday_off.department': new Error('lock wait timeout') },
    });
    await expect(repository.usageByDepartment([7])).rejects.toThrow('lock wait timeout');
  });

  it('a malformed answer row or probe row is refused, never read as zero', async () => {
    const row = stub({ raw: { 'tbltickets.department': [{ id: 7 }] } });
    await expect(row.repository.usageByDepartment([7])).rejects.toThrow();
    const list = stub({ raw: { 'tblday_off.department': [{ value: '7' }] } });
    await expect(list.repository.usageByDepartment([7])).rejects.toThrow();
    const probe = stub({ columns: [{ t: 'tbltickets', c: 'department' } as PresentColumn] });
    await expect(probe.repository.presentReferences()).rejects.toThrow();
  });
});

describe('DepartmentsRepository: tbldepartments through the typed delegate, six columns only (D-48)', () => {
  it('every row-returning call selects DEPARTMENT_COLUMNS', async () => {
    const { repository, calls } = stub({ rows: [stored(1)], first: stored(1), counts: [1] });
    await repository.list(request());
    await repository.findById(1);
    await repository.findAll();
    await repository.findByIds([1]);
    const rowCalls = calls.filter((call) => call.method !== 'count');
    expect(rowCalls.map((call) => call.method)).toEqual([
      'findMany',
      'findFirst',
      'findMany',
      'findMany',
    ]);
    for (const call of rowCalls) {
      expect((call.args as { select: unknown }).select, call.method).toBe(DEPARTMENT_COLUMNS);
    }
  });

  it('has no write method: tbldepartments is Perfex-owned and Node only reads it', () => {
    const methods = Object.getOwnPropertyNames(DepartmentsRepository.prototype);
    for (const write of ['create', 'update', 'remove', 'delete', 'upsert']) {
      expect(methods, write).not.toContain(write);
    }
  });

  it('findAll reads the name then the id ascending and refuses MAX + 1 rows, never truncating', async () => {
    const rows = Array.from({ length: DEPARTMENTS_FACADE_MAX_ROWS + 1 }, (_, index) =>
      stored(index + 1),
    );
    const { repository, calls } = stub({ rows });
    await expect(repository.findAll()).rejects.toBeInstanceOf(AppError);
    expect(calls[0]?.args).toMatchObject({
      orderBy: [{ name: 'asc' }, { departmentid: 'asc' }],
      take: DEPARTMENTS_FACADE_MAX_ROWS + 1,
    });
    const ok = stub({ rows: rows.slice(0, 2) });
    expect((await ok.repository.findAll()).map((row) => row.id)).toEqual([1, 2]);
  });

  it('findByIds([]) reads nothing; otherwise one read of the ids', async () => {
    const none = stub();
    expect(await none.repository.findByIds([])).toEqual([]);
    expect(none.calls).toEqual([]);
    const { repository, calls } = stub({ rows: [stored(3)] });
    expect((await repository.findByIds([3, 99])).map((row) => row.id)).toEqual([3]);
    expect(calls[0]?.args).toMatchObject({ where: { departmentid: { in: [3, 99] } } });
  });

  it('findById parses the six columns: a stored 0 or NULL manager or parent is none', async () => {
    const { repository } = stub({
      first: { ...stored(4, 'Accounts'), calendar_id: 'c', manager_id: null, parent_id: 2 },
    });
    expect(await repository.findById(4)).toEqual({
      id: 4,
      name: 'Accounts',
      hideFromClient: false,
      calendarId: 'c',
      managerId: null,
      parentId: 2,
    });
    expect(await stub().repository.findById(4)).toBeNull();
  });

  it('list: the name ascending by default, the id breaking ties, q over the name, the calendar id and an id', async () => {
    const { repository, calls } = stub({ rows: [stored(1)], counts: [1] });
    const page = await repository.list(request({ search: '12' }));
    expect(page.total).toBe(1);
    expect(page.rangeStart).toBe(1);
    expect(calls[0]?.args).toMatchObject({
      where: {
        OR: [
          { name: { contains: '12' } },
          { calendar_id: { contains: '12' } },
          { departmentid: 12 },
        ],
      },
      orderBy: [{ name: 'asc' }, { departmentid: 'asc' }],
      take: 25,
    });
    const large = stub();
    await large.repository.list(request({ search: '99999999999' }));
    expect((large.calls[0]?.args as { where: { OR: unknown[] } }).where.OR).toHaveLength(2);
  });

  it('list by id pages on departmentid', async () => {
    const { repository, calls } = stub();
    await repository.list(
      request({
        sortField: 'id',
        cursor: { sort: 'id', key: [5, 5], direction: 'after' },
      }),
    );
    expect(calls[0]?.args).toMatchObject({
      where: {
        AND: [{}, { OR: [{ departmentid: { gt: 5 } }, { departmentid: { gt: 5 } }] }],
      },
      orderBy: [{ departmentid: 'asc' }, { departmentid: 'asc' }],
    });
  });

  it.each([
    [
      'asc',
      'after',
      'cal',
      { OR: [{ calendar_id: { gt: 'cal' } }, { calendar_id: 'cal', departmentid: { gt: 4 } }] },
    ],
    [
      'asc',
      'before',
      'cal',
      {
        OR: [
          { calendar_id: null },
          { calendar_id: { lt: 'cal' } },
          { calendar_id: 'cal', departmentid: { lt: 4 } },
        ],
      },
    ],
    [
      'asc',
      'after',
      false,
      { OR: [{ calendar_id: { not: null } }, { calendar_id: null, departmentid: { gt: 4 } }] },
    ],
    ['asc', 'before', false, { calendar_id: null, departmentid: { lt: 4 } }],
    [
      'desc',
      'after',
      'cal',
      {
        OR: [
          { calendar_id: null },
          { calendar_id: { lt: 'cal' } },
          { calendar_id: 'cal', departmentid: { lt: 4 } },
        ],
      },
    ],
    ['desc', 'after', false, { calendar_id: null, departmentid: { lt: 4 } }],
  ] as const)(
    'the calendar id keyset, NULL first ascending: %s %s from %j',
    async (order, direction, value, expected) => {
      const { repository, calls } = stub();
      await repository.list(
        request({
          sortField: 'calendarId',
          order,
          cursor: { sort: 'calendarId', key: [value, 4], direction },
        }),
      );
      expect((calls[0]?.args as { where: { AND: unknown[] } }).where.AND[1]).toEqual(expected);
    },
  );

  it('a page carries a NULL calendar id in its cursor as false', async () => {
    const { repository } = stub({ rows: [stored(4), stored(5)], counts: [3, 0] });
    const page = await repository.list(request({ sortField: 'calendarId', limit: 2 }));
    expect(page.nextCursor).toBe(encodeCursor('calendarId', [false, 5], 'after'));
  });

  it('count uses the list match without a cursor', async () => {
    const { repository, calls } = stub({ counts: [3] });
    expect(await repository.count(request({ search: 'Sa' }))).toBe(3);
    expect(calls[0]?.args).toEqual({
      where: { OR: [{ name: { contains: 'Sa' } }, { calendar_id: { contains: 'Sa' } }] },
    });
  });
});

/**
 * The transformer: the wire record built field by field from the six read columns (the calendar id
 * `''` for NULL, the manager and the parent as text or `null`, their names only beside an id), the
 * list envelope, the export row and the facade's picker shape; and D-47: the response carries
 * exactly the declared keys, and a row poisoned with the eight ticket-mailbox keys and a sentinel
 * leaks neither a key nor the sentinel through any output of this file.
 */
import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { DepartmentRow } from '../model/departments.model.js';
import {
  DEPARTMENTS_EXPORT_CELLS,
  DepartmentsTransformer,
  NO_DEPARTMENT_USAGE,
  NO_NAMES,
  toDepartmentName,
  toExportRow,
  toResponse,
} from '../service/departments.transformer.js';

const ROW: DepartmentRow = {
  id: 7,
  name: 'Sales',
  hideFromClient: true,
  calendarId: null,
  managerId: 11,
  parentId: 2,
};

const STAFF = [{ key: 'staffMembers', noun: 'staff member', count: 3 }];

describe('DepartmentsTransformer: the record', () => {
  it('builds the wire record from the six columns, the names and the counts', () => {
    expect(
      toResponse(ROW, { ...NO_DEPARTMENT_USAGE, tickets: 2 }, STAFF, {
        managerName: 'Grace Hopper',
        parentName: 'Support',
      }),
    ).toEqual({
      id: '7',
      name: 'Sales',
      hideFromClient: true,
      calendarId: '',
      managerId: '11',
      managerName: 'Grace Hopper',
      parentId: '2',
      parentName: 'Support',
      usage: { ...NO_DEPARTMENT_USAGE, tickets: 2 },
      registeredUsage: { staffMembers: 3 },
    });
  });

  it('a department with no manager and no parent shows null for both, whatever the names say', () => {
    const response = toResponse(
      { ...ROW, managerId: null, parentId: null, calendarId: 'cal' },
      NO_DEPARTMENT_USAGE,
      [],
      { managerName: 'stale', parentName: 'stale' },
    );
    expect(response).toMatchObject({
      calendarId: 'cal',
      managerId: null,
      managerName: null,
      parentId: null,
      parentName: null,
      registeredUsage: {},
    });
  });

  it('an unknown manager or parent keeps its id and shows a null name', () => {
    expect(toResponse(ROW, NO_DEPARTMENT_USAGE, [], NO_NAMES)).toMatchObject({
      managerId: '11',
      managerName: null,
      parentId: '2',
      parentName: null,
    });
  });

  it('the list envelope carries each row, zeros for an id without counts, and both limits', () => {
    const list = new DepartmentsTransformer().toListResponse(
      [ROW],
      new Map(),
      new Map(),
      new Map(),
      { nextCursor: 'n', prevCursor: null, total: 1, rangeStart: 1 },
    );
    expect(list.data[0]?.usage).toEqual(NO_DEPARTMENT_USAGE);
    expect(list.meta).toEqual({
      nextCursor: 'n',
      prevCursor: null,
      total: 1,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });
});

describe('DepartmentsTransformer: the export and the picker', () => {
  it('the export row is the id, the name and the calendar id as text', () => {
    const row = toExportRow(ROW);
    expect(row).toEqual({ id: '7', name: 'Sales', calendarId: '' });
    expect(Object.keys(DEPARTMENTS_EXPORT_CELLS)).toEqual(['id', 'name', 'calendarId']);
    expect(DEPARTMENTS_EXPORT_CELLS.calendarId.value({ ...row, calendarId: 'c' })).toBe('c');
  });

  it('the picker shape is the id and the name', () => {
    expect(toDepartmentName(ROW)).toEqual({ departmentId: 7, name: 'Sales' });
  });
});

/** The eight ticket-mailbox columns (D-47) and the sentinel a poisoned row carries in each. */
const MAILBOX_KEYS = [
  'imap_username',
  'email',
  'email_from_header',
  'host',
  'password',
  'encryption',
  'folder',
  'delete_after_import',
] as const;
const SENTINEL = 'zz-mailbox-sentinel';
const POISON = Object.fromEntries(MAILBOX_KEYS.map((key) => [key, SENTINEL]));

/** The exact keys of a record on the wire. */
const RECORD_KEYS = [
  'calendarId',
  'hideFromClient',
  'id',
  'managerId',
  'managerName',
  'name',
  'parentId',
  'parentName',
  'registeredUsage',
  'usage',
];

describe('D-47: no mailbox column leaves the transformer', () => {
  it('D-47: a response carries exactly the declared keys', () => {
    expect(Object.keys(toResponse(ROW, NO_DEPARTMENT_USAGE, STAFF, NO_NAMES)).sort()).toEqual(
      RECORD_KEYS,
    );
    expect(Object.keys(toResponse(ROW, NO_DEPARTMENT_USAGE, STAFF, NO_NAMES).usage).sort()).toEqual(
      Object.keys(NO_DEPARTMENT_USAGE).sort(),
    );
  });

  it('D-47: a row poisoned with mailbox keys leaks nothing', () => {
    const row: DepartmentRow = { ...ROW, ...POISON };
    const usage = { ...NO_DEPARTMENT_USAGE, tickets: 1, ...POISON } as typeof NO_DEPARTMENT_USAGE;
    const registered = [{ ...STAFF[0], ...POISON } as (typeof STAFF)[number]];
    const names = { managerName: 'Grace Hopper', parentName: 'Support', ...POISON };
    const exported = toExportRow(row);
    const outputs: unknown[] = [
      toResponse(row, usage, registered, names),
      new DepartmentsTransformer().toListResponse(
        [row],
        new Map([[row.id, usage]]),
        new Map([[row.id, registered]]),
        new Map([[row.id, names]]),
        { nextCursor: null, prevCursor: null, total: 1, rangeStart: 1, ...POISON },
      ),
      exported,
      Object.values(DEPARTMENTS_EXPORT_CELLS).map((cell) => cell.value(exported)),
      toDepartmentName(row),
    ];
    const text = JSON.stringify(outputs);
    expect(text).not.toContain(SENTINEL);
    for (const key of MAILBOX_KEYS) expect(text).not.toMatch(new RegExp(String.raw`\b${key}\b`));
  });

  it('the export cells are exactly id, name and calendarId', () => {
    expect(Object.keys(DEPARTMENTS_EXPORT_CELLS)).toEqual(['id', 'name', 'calendarId']);
    expect(Object.keys(toExportRow({ ...ROW, ...POISON })).sort()).toEqual([
      'calendarId',
      'id',
      'name',
    ]);
  });
});

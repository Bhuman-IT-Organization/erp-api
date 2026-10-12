/**
 * IdentityValidator: BE-19's grammar through `parseListQuery` with the module's allowed-field list,
 * the refusals this module adds on top of it (a sort field outside the list's keyset allowlist, a
 * compound sort, a keyset cursor that is not one of this list's — and, on the audit log only, a
 * cursor that is not a decimal id), and the `:id` parse. Every refusal is `ERP-VALIDATION-0001` (400).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import {
  IdentityValidator,
  MEMBER_SORT_FIELDS,
  ROLE_SORT_FIELDS,
} from '../service/identity.validator.js';

const validator = new IdentityValidator();

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error.code : 'not-an-AppError';
  }
  return 'did-not-throw';
}

describe('IdentityValidator.parseMemberParams', () => {
  it('coerces a numeric id', () => {
    expect(validator.parseMemberParams({ id: '7' })).toEqual({ id: 7 });
  });

  it.each([{ id: 'abc' }, { id: '0' }, { id: '-3' }, {}])(
    'refuses %j with ERP-VALIDATION-0001',
    (params) => {
      expect(codeOf(() => validator.parseMemberParams(params))).toBe('ERP-VALIDATION-0001');
    },
  );
});

describe('IdentityValidator.parseMemberListQuery', () => {
  it('defaults limit and cursor and finds no filter in an empty query', () => {
    const { query, search, sortField, order, cursor } = validator.parseMemberListQuery({});
    expect(query.limit).toBe(LIST_QUERY_LIMITS.default);
    expect(query.cursor).toBeNull();
    expect(query.filters).toEqual([]);
    expect(search).toBeNull();
    expect(sortField).toBe('staffId');
    expect(order).toBe('asc');
    expect(cursor).toBeNull();
  });

  it('reads the flat bracket keys Fastify delivers', () => {
    const { query } = validator.parseMemberListQuery({
      'filter[active]': '1',
      'filter[email][like]': 'seed',
    });
    expect(query.filters).toEqual([
      { field: 'active', op: 'eq', value: '1' },
      { field: 'email', op: 'like', value: 'seed' },
    ]);
  });

  it('reads ?q= and decodes the opaque keyset cursor', () => {
    const raw = encodeCursor('staffId', [12, 12], 'after');
    const { query, search, cursor } = validator.parseMemberListQuery({ q: 'Seed', cursor: raw });
    expect(search).toBe('Seed');
    expect(query.cursor).toBe(raw);
    expect(cursor).toEqual({ sort: 'staffId', key: [12, 12], direction: 'after' });
  });

  it('accepts sort=staffId and sort=-staffId', () => {
    const parsed = validator.parseMemberListQuery({ sort: '-staffId' });
    expect(parsed.query.sort).toEqual([{ field: 'staffId', direction: 'desc' }]);
    expect(parsed.sortField).toBe('staffId');
    expect(parsed.order).toBe('desc');
  });

  it('pins the member sort allowlist: every keyset-able listed column, never Role or Last login (D-41)', () => {
    expect([...MEMBER_SORT_FIELDS]).toEqual(['staffId', 'firstName', 'email', 'active']);
  });

  it.each([
    ['email', 'email', 'asc'],
    ['-firstName', 'firstName', 'desc'],
    ['active', 'active', 'asc'],
    ['-email', 'email', 'desc'],
  ] as const)('accepts sort=%s', (sort, field, order) => {
    const parsed = validator.parseMemberListQuery({ sort });
    expect(parsed.sortField).toBe(field);
    expect(parsed.order).toBe(order);
  });

  it('decodes a cursor minted for the same sort, and refuses one minted for another', () => {
    const email = encodeCursor('email', ['seed-2@example.invalid', 2], 'before');
    expect(validator.parseMemberListQuery({ sort: 'email', cursor: email }).cursor).toEqual({
      sort: 'email',
      key: ['seed-2@example.invalid', 2],
      direction: 'before',
    });
    expect(codeOf(() => validator.parseMemberListQuery({ sort: 'firstName', cursor: email }))).toBe(
      'ERP-VALIDATION-0001',
    );
  });

  it.each([
    ['an unknown filter field', { 'filter[password]': 'x' }],
    ['an unknown operator', { 'filter[active][matches]': '1' }],
    ['an offset paging key', { page: '2' }],
    ['a limit below the minimum', { limit: '0' }],
    ['a limit above the maximum', { limit: '501' }],
    ['a cursor that is not a keyset cursor', { cursor: 'abc' }],
    ['a bare decimal cursor (the pre-3.2 member cursor)', { cursor: '12' }],
    [
      'a cursor whose value is the wrong kind for its sort',
      { sort: 'firstName', cursor: encodeCursor('firstName', [7, 7], 'after') },
    ],
    ['a listed field the keyset does not sort (Role id)', { sort: 'roleId' }],
    ['the Role name column (a join, D-41)', { sort: 'roleName' }],
    ['the Last login column (nullable, D-41)', { sort: 'lastLogin' }],
    ['a compound sort', { sort: 'firstName,email' }],
    ['a q longer than the bound', { q: 'x'.repeat(101) }],
  ])('refuses %s with ERP-VALIDATION-0001', (_case, query) => {
    expect(codeOf(() => validator.parseMemberListQuery(query))).toBe('ERP-VALIDATION-0001');
  });
});

describe('IdentityValidator.parseAuditListQuery', () => {
  it('keeps the audit log on its numeric cursor', () => {
    expect(validator.parseAuditListQuery({ cursor: '12' }).cursor).toBe('12');
  });

  it.each([
    ['a non-numeric cursor', { cursor: 'abc' }],
    ['a member-list keyset cursor', { cursor: encodeCursor('staffId', [12, 12], 'after') }],
    ['a sort field the keyset cannot express', { sort: 'actorStaffId' }],
  ])('refuses %s with ERP-VALIDATION-0001', (_case, query) => {
    expect(codeOf(() => validator.parseAuditListQuery(query))).toBe('ERP-VALIDATION-0001');
  });
});

describe('IdentityValidator role parses', () => {
  it('coerces the role :id and refuses a non-positive one', () => {
    expect(validator.parseRoleParams({ id: '10' })).toEqual({ id: 10 });
    expect(codeOf(() => validator.parseRoleParams({ id: '0' }))).toBe('ERP-VALIDATION-0001');
  });

  it('parses the roles list query with the default limit and the two allowed fields', () => {
    const { query, sortField, order, cursor, search } = validator.parseRoleListQuery({
      'filter[name]': 'Support',
    });
    expect(query.limit).toBe(LIST_QUERY_LIMITS.default);
    expect(query.filters).toEqual([{ field: 'name', op: 'eq', value: 'Support' }]);
    expect([sortField, order, cursor, search]).toEqual(['roleId', 'asc', null, null]);
    expect(validator.parseRoleListQuery({ sort: '-roleId' }).query.sort).toEqual([
      { field: 'roleId', direction: 'desc' },
    ]);
  });

  it('pins the roles sort allowlist and accepts sort=name and sort=-name', () => {
    expect([...ROLE_SORT_FIELDS]).toEqual(['roleId', 'name']);
    expect(validator.parseRoleListQuery({ sort: 'name' }).sortField).toBe('name');
    expect(validator.parseRoleListQuery({ sort: '-name' }).order).toBe('desc');
  });

  it('reads ?q= on roles, capped at 100 characters like the members list', () => {
    expect(validator.parseRoleListQuery({ q: 'war' }).search).toBe('war');
    expect(codeOf(() => validator.parseRoleListQuery({ q: 'x'.repeat(101) }))).toBe(
      'ERP-VALIDATION-0001',
    );
  });

  it('refuses a field outside the roles allowlist, a compound sort and a bad cursor', () => {
    expect(codeOf(() => validator.parseRoleListQuery({ 'filter[email]': 'x' }))).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(codeOf(() => validator.parseRoleListQuery({ sort: 'name,roleId' }))).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(codeOf(() => validator.parseRoleListQuery({ sort: 'memberCount' }))).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(codeOf(() => validator.parseRoleListQuery({ cursor: 'nope' }))).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(
      codeOf(() =>
        validator.parseRoleListQuery({
          sort: 'name',
          cursor: encodeCursor('roleId', [10, 10], 'after'),
        }),
      ),
    ).toBe('ERP-VALIDATION-0001');
    expect(codeOf(() => validator.parseRoleListQuery({ page: '2' }))).toBe('ERP-VALIDATION-0001');
  });

  it('parses the role bodies strictly: an unknown key is a 400, permissions default to []', () => {
    expect(validator.parseCreateRoleBody({ name: 'Support' })).toEqual({
      name: 'Support',
      permissions: [],
    });
    expect(codeOf(() => validator.parseCreateRoleBody({ name: 'Support', roleId: 3 }))).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(codeOf(() => validator.parseCreateRoleBody({ name: '' }))).toBe('ERP-VALIDATION-0001');
    expect(validator.parseUpdateRoleBody({ applyToMembers: true })).toEqual({
      applyToMembers: true,
    });
    expect(codeOf(() => validator.parseUpdateRoleBody({ update_staff_permissions: true }))).toBe(
      'ERP-VALIDATION-0001',
    );
  });
});

describe('IdentityValidator export list requests (04.1.1: the core parses the export parameters)', () => {
  it('parses a member export as the list request with no cursor and a batch of LIST_QUERY_LIMITS.max', () => {
    const list = validator.parseMemberExportList({ q: 'Seed', sort: '-email', format: 'pdf' });
    expect(list).toMatchObject({
      search: 'Seed',
      sortField: 'email',
      order: 'desc',
      cursor: null,
    });
    expect(list.query.limit).toBe(LIST_QUERY_LIMITS.max);
    expect(list.query.cursor).toBeNull();
  });

  it.each([
    { sort: 'lastLogin' },
    { sort: 'firstName,email' },
    { q: 'x'.repeat(101) },
    { 'filter[password]': 'x' },
  ])('refuses a member export query %j with ERP-VALIDATION-0001', (query) => {
    expect(codeOf(() => validator.parseMemberExportList(query))).toBe('ERP-VALIDATION-0001');
  });

  it('parses a role export as the roles list request from the first row', () => {
    const list = validator.parseRoleExportList({ 'filter[name]': 'Seed' });
    expect(list.query.filters).toEqual([{ field: 'name', op: 'eq', value: 'Seed' }]);
    expect(list.query.limit).toBe(LIST_QUERY_LIMITS.max);
    expect(list.cursor).toBeNull();
    expect(codeOf(() => validator.parseRoleExportList({ sort: 'memberCount' }))).toBe(
      'ERP-VALIDATION-0001',
    );
  });
});

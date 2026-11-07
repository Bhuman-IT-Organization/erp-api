import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import {
  KNOWLEDGE_BASE_COLOR_MAX,
  KNOWLEDGE_BASE_GROUP_NAME_MAX,
  KNOWLEDGE_BASE_GROUP_ORDER_MAX,
  KNOWLEDGE_BASE_GROUP_ORDER_MIN,
  KNOWLEDGE_BASE_SEARCH_MAX,
  toSlug,
} from '../dto/knowledge-base-groups.dto.js';
import {
  KNOWLEDGE_BASE_GROUPS_SORT_FIELDS,
  KnowledgeBaseGroupsValidator,
} from '../service/knowledge-base-groups.validator.js';

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

function firstIssue(fn: () => unknown): { path: readonly unknown[]; message: string } | undefined {
  const error = thrown(fn);
  expect(error.code).toBe('ERP-VALIDATION-0001');
  expect(error.status).toBe(400);
  const issues = error.extras?.issues;
  expect(Array.isArray(issues)).toBe(true);
  return (issues as readonly { path: readonly unknown[]; message: string }[])[0];
}

const refusedOn = (fn: () => unknown): unknown => firstIssue(fn)?.path;

describe('KnowledgeBaseGroupsValidator: list groups query', () => {
  const validator = new KnowledgeBaseGroupsValidator();

  it('defaults to groupOrder ascending, default limit, no cursor and no search', () => {
    expect(KNOWLEDGE_BASE_GROUPS_SORT_FIELDS).toContain('groupOrder');
    expect(validator.parseListGroupsQuery({})).toEqual({
      search: null,
      sortField: 'groupOrder',
      order: 'asc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.default,
    });
  });

  it('reads q, sort and cursor', () => {
    const cursor = encodeCursor('name', ['General', 1], 'after');
    expect(validator.parseListGroupsQuery({ q: 'gen', sort: 'name', limit: '25', cursor })).toEqual(
      {
        search: 'gen',
        sortField: 'name',
        order: 'asc',
        cursor: { sort: 'name', key: ['General', 1], direction: 'after' },
        limit: 25,
      },
    );
  });

  it('refuses invalid queries', () => {
    expect(refusedOn(() => validator.parseListGroupsQuery({ sort: 'name,-id' }))).toEqual(['sort']);
    expect(thrown(() => validator.parseListGroupsQuery({ 'filter[name]': 'x' })).code).toBe(
      'ERP-VALIDATION-0001',
    );
    expect(
      refusedOn(() =>
        validator.parseListGroupsQuery({ q: 'x'.repeat(KNOWLEDGE_BASE_SEARCH_MAX + 1) }),
      ),
    ).toEqual(['q']);
    expect(
      refusedOn(() =>
        validator.parseListGroupsQuery({
          cursor: encodeCursor('id', ['not-a-number', 1], 'after'),
          sort: 'id',
        }),
      ),
    ).toEqual(['cursor']);
  });
});

describe('KnowledgeBaseGroupsValidator: group params', () => {
  const validator = new KnowledgeBaseGroupsValidator();

  it('reads positive integer id', () => {
    expect(validator.parseGroupParams({ id: '5' })).toEqual({ id: 5 });
  });

  it.each([['abc'], ['0'], ['-1'], ['1.5']])('refuses invalid id %s', (id) => {
    expect(refusedOn(() => validator.parseGroupParams({ id }))).toEqual(['id']);
  });
});

describe('KnowledgeBaseGroupsValidator: group bodies', () => {
  const validator = new KnowledgeBaseGroupsValidator();

  it('validates create group body: name required, 191 max length, color 10 max', () => {
    expect(
      validator.parseCreateGroupBody({
        name: '  General  ',
        color: '#03a9f4',
        description: 'Desc',
        groupOrder: 1,
        disabled: false,
      }),
    ).toEqual({
      name: 'General',
      color: '#03a9f4',
      description: 'Desc',
      groupOrder: 1,
      disabled: false,
    });

    const maxName = 'a'.repeat(KNOWLEDGE_BASE_GROUP_NAME_MAX);
    expect(validator.parseCreateGroupBody({ name: maxName })).toEqual({ name: maxName });
  });

  it('refuses name longer than 191 characters', () => {
    expect(
      refusedOn(() =>
        validator.parseCreateGroupBody({ name: 'a'.repeat(KNOWLEDGE_BASE_GROUP_NAME_MAX + 1) }),
      ),
    ).toEqual(['name']);
  });

  it('refuses color longer than 10 characters', () => {
    expect(
      refusedOn(() =>
        validator.parseCreateGroupBody({
          name: 'Valid',
          color: '1'.repeat(KNOWLEDGE_BASE_COLOR_MAX + 1),
        }),
      ),
    ).toEqual(['color']);
  });

  it('validates groupOrder bounds and refuses decimal or out-of-range values', () => {
    // Valid bounds
    expect(
      validator.parseCreateGroupBody({
        name: 'Valid',
        groupOrder: KNOWLEDGE_BASE_GROUP_ORDER_MIN,
      }).groupOrder,
    ).toBe(KNOWLEDGE_BASE_GROUP_ORDER_MIN);

    expect(
      validator.parseCreateGroupBody({
        name: 'Valid',
        groupOrder: KNOWLEDGE_BASE_GROUP_ORDER_MAX,
      }).groupOrder,
    ).toBe(KNOWLEDGE_BASE_GROUP_ORDER_MAX);

    // Decimal order
    expect(
      refusedOn(() => validator.parseCreateGroupBody({ name: 'Valid', groupOrder: 1.5 })),
    ).toEqual(['groupOrder']);

    // Below min
    expect(
      refusedOn(() =>
        validator.parseCreateGroupBody({
          name: 'Valid',
          groupOrder: KNOWLEDGE_BASE_GROUP_ORDER_MIN - 1,
        }),
      ),
    ).toEqual(['groupOrder']);

    // Above max
    expect(
      refusedOn(() =>
        validator.parseCreateGroupBody({
          name: 'Valid',
          groupOrder: KNOWLEDGE_BASE_GROUP_ORDER_MAX + 1,
        }),
      ),
    ).toEqual(['groupOrder']);
  });

  it('refuses active or extra keys (strict)', () => {
    const error1 = thrown(() =>
      validator.parseCreateGroupBody({
        name: 'Valid',
        active: true,
      }),
    );
    expect(error1.code).toBe('ERP-VALIDATION-0001');
    expect(JSON.stringify(error1.extras?.issues)).toContain('active');

    const error2 = thrown(() =>
      validator.parseUpdateGroupBody({
        name: 'Valid',
        active: true,
      }),
    );
    expect(error2.code).toBe('ERP-VALIDATION-0001');
    expect(JSON.stringify(error2.extras?.issues)).toContain('active');
  });

  it('validates groupSlug on edit: refuses empty, null, or punctuation-only slugs', () => {
    // Valid groupSlug
    expect(
      validator.parseUpdateGroupBody({
        groupSlug: 'custom-slug',
      }),
    ).toEqual({ groupSlug: 'custom-slug' });

    // Empty string
    expect(
      refusedOn(() =>
        validator.parseUpdateGroupBody({
          groupSlug: '',
        }),
      ),
    ).toEqual(['groupSlug']);

    // Whitespace only
    expect(
      refusedOn(() =>
        validator.parseUpdateGroupBody({
          groupSlug: '   ',
        }),
      ),
    ).toEqual(['groupSlug']);

    // Punctuation only (slugifies to empty)
    expect(
      refusedOn(() =>
        validator.parseUpdateGroupBody({
          groupSlug: '!!!',
        }),
      ),
    ).toEqual(['groupSlug']);
  });

  it('refuses empty object on update', () => {
    expect(() => validator.parseUpdateGroupBody({})).toThrow(AppError);
  });
});

describe('toSlug', () => {
  it('turns punctuation into hyphens, e.g. Q&A -> q-a', () => {
    expect(toSlug('Q&A')).toBe('q-a');
    expect(toSlug('Hello, World!')).toBe('hello-world');
    expect(toSlug('General & Billing')).toBe('general-billing');
    expect(toSlug('   --Leading and trailing--   ')).toBe('leading-and-trailing');
  });

  it('slugifies punctuation-only strings to empty', () => {
    expect(toSlug('!!!')).toBe('');
    expect(toSlug('---')).toBe('');
    expect(toSlug('')).toBe('');
  });
});

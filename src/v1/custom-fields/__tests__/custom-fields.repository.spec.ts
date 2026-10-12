/**
 * CustomFieldsRepository over a stub client: what it asks the database, not what the database
 * answers (the int spec proves that against the local mirror). The value counts are ONE `groupBy`
 * on `fieldid` over all the ids (zeros for an id no row names, no query for no ids, a failing read
 * rejects); the list narrows by `fieldto` and searches the name or the slug; and the class offers
 * reads only (`tblcustomfields` and `tblcustomfieldsvalues` are Perfex's).
 */
import { describe, expect, it } from 'vitest';
import { CustomFieldsRepository, keysetPredicate } from '../repository/custom-fields.repository.js';

type ClientHolder = ConstructorParameters<typeof CustomFieldsRepository>[0];

function stub(groupBy: () => Promise<unknown> = () => Promise.resolve([])) {
  const calls: { method: string; args: unknown }[] = [];
  const record =
    (method: string, answer: () => Promise<unknown>) =>
    (args: unknown): Promise<unknown> => {
      calls.push({ method, args });
      return answer();
    };
  const client = {
    tblcustomfields: {
      findMany: record('findMany', () => Promise.resolve([])),
      count: record('count', () => Promise.resolve(0)),
    },
    tblcustomfieldsvalues: { groupBy: record('values.groupBy', groupBy) },
  };
  const repository = new CustomFieldsRepository({ client } as unknown as ClientHolder);
  return { repository, calls };
}

describe('CustomFieldsRepository (stub client)', () => {
  it('valuesCountOf issues no query for no ids', async () => {
    const { repository, calls } = stub();
    expect(await repository.valuesCountOf([])).toEqual(new Map());
    expect(calls).toEqual([]);
  });

  it('valuesCountOf is one groupBy on fieldid over every id, zeros for an id no row names', async () => {
    const { repository, calls } = stub(() => Promise.resolve([{ fieldid: 4, _count: { id: 3 } }]));
    expect([...(await repository.valuesCountOf([4, 5]))]).toEqual([
      [4, 3],
      [5, 0],
    ]);
    expect(calls).toEqual([
      {
        method: 'values.groupBy',
        args: { by: ['fieldid'], where: { fieldid: { in: [4, 5] } }, _count: { id: true } },
      },
    ]);
  });

  it('a failing count rejects (fail closed)', async () => {
    const { repository } = stub(() => Promise.reject(new Error('down')));
    await expect(repository.valuesCountOf([1])).rejects.toThrow('down');
  });

  it('count narrows by fieldto and searches the name or the slug', async () => {
    const { repository, calls } = stub();
    await repository.count({
      search: 'x',
      fieldto: ['items'],
      sortField: 'id',
      order: 'asc',
      cursor: null,
      limit: 1,
    });
    expect(calls[0]?.args).toEqual({
      where: {
        AND: [
          { OR: [{ name: { contains: 'x' } }, { slug: { contains: 'x' } }] },
          { fieldto: { in: ['items'] } },
        ],
      },
    });
  });

  it('exposes no write method: both tables are Perfex-owned', () => {
    const { repository } = stub();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(repository)).filter(
      (name) => name !== 'constructor',
    );
    expect(methods.sort()).toEqual([
      'count',
      'definitionsOf',
      'findById',
      'list',
      'valuesCountOf',
      'valuesOf',
    ]);
  });

  it('the keyset predicate takes a NULL clause only on the nullable columns (fieldto, field_order)', () => {
    const before = (column: string, value: string | number) =>
      keysetPredicate(column, { sort: 'name', key: [value, 9], direction: 'before' }, 'asc');
    expect(before('name', 'm')).toEqual({
      OR: [{ name: { lt: 'm' } }, { name: 'm', id: { lt: 9 } }],
    });
    expect(before('field_order', 2)).toEqual({
      OR: [{ field_order: null }, { field_order: { lt: 2 } }, { field_order: 2, id: { lt: 9 } }],
    });
    expect(
      keysetPredicate('fieldto', { sort: 'fieldto', key: [false, 4], direction: 'after' }, 'asc'),
    ).toEqual({
      OR: [{ fieldto: null, id: { gt: 4 } }, { fieldto: { not: null } }],
    });
  });
});

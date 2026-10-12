/**
 * SettingsRepository over a stub client: what it asks the database, not what the database answers
 * (the int spec proves that against the local mirror). One typed `findMany` with the names bound in
 * an `in`, the two columns, oldest id first; a row that does not parse is refused.
 */
import { describe, expect, it } from 'vitest';
import { SettingsRepository } from '../repository/settings.repository.js';

/** The repository's constructor parameter, named without importing the database layer. */
type ClientHolder = ConstructorParameters<typeof SettingsRepository>[0];

function stub(rows: readonly unknown[] = []) {
  const calls: unknown[] = [];
  const client = {
    tbloptions: {
      findMany: (args: unknown): Promise<readonly unknown[]> => {
        calls.push(args);
        return Promise.resolve(rows);
      },
    },
  };
  const repository = new SettingsRepository({ client } as unknown as ClientHolder);
  return { repository, calls };
}

describe('SettingsRepository.findByNames', () => {
  it('reads tbloptions once: the names bound in an `in`, name and value only, oldest id first', async () => {
    const { repository, calls } = stub([{ name: 'companyname', value: 'Company One' }]);
    await expect(repository.findByNames(['companyname', 'dateformat'])).resolves.toEqual([
      { name: 'companyname', value: 'Company One' },
    ]);
    expect(calls).toEqual([
      {
        where: { name: { in: ['companyname', 'dateformat'] } },
        select: { name: true, value: true },
        orderBy: { id: 'asc' },
      },
    ]);
  });

  it('refuses a row whose value is not a string', async () => {
    const { repository } = stub([{ name: 'companyname', value: 42 }]);
    await expect(repository.findByNames(['companyname'])).rejects.toThrow();
  });

  it('has no write method: findByNames is the only one', () => {
    expect(Object.getOwnPropertyNames(SettingsRepository.prototype).sort()).toEqual([
      'constructor',
      'findByNames',
    ]);
  });
});

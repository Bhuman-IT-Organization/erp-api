/**
 * ExpenseCategoriesRepository against the local mirror (DATABASE_URL from
 * ../erp-infra/env/local/api.host.env).
 *
 * `tblexpenses_categories` is node-owned since plan 04.1-02, so the ownership guard admits the
 * writes this spec makes through the typed delegate. The three usage reads run for real: the two
 * grouped counts over `tblexpenses` and `tblacc_expense_category_mappings`, and the petty-cash
 * presence probe, which answers false on the local copy (the table-ABSENT path of D-15; the
 * PRESENT path is proven with a stubbed client in `expense-categories.repository.spec.ts`).
 *
 * Everything this spec writes it creates itself and deletes again: rows whose name starts with
 * `MARKER`, removed before the run (a leftover of a crashed run) and after it. No seeded row is
 * touched, no Perfex-owned table is written, no table is created or dropped, and no value from the
 * local data is read into an assertion: every expected value below is one this spec wrote.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type {
  ExpenseCategoriesListRequest,
  ExpenseCategoriesPage,
  ExpenseCategory,
} from '../model/expense-categories.model.js';
import {
  EXPENSE_CATEGORIES_PETTY_CASH_TABLE,
  ExpenseCategoriesRepository,
} from '../repository/expense-categories.repository.js';

/** Every row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-04.1-04-category';
/** A token only one of this spec's descriptions holds: `q` finds that row by its description. */
const DESCRIPTION_TOKEN = 'int-spec-04.1-04-description-token';
/** A two-line description in the stored form Perfex's `nl2br` writes. */
const STORED_TWO_LINES = 'Line one<br />\nline two';

function request(
  overrides: Partial<ExpenseCategoriesListRequest> = {},
): ExpenseCategoriesListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: ExpenseCategoriesPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)(
  'ExpenseCategoriesRepository against the local mirror',
  () => {
    const service = new PrismaService(new AppConfig(), new HealthService());
    const repository = new ExpenseCategoriesRepository(service);
    let a: ExpenseCategory;
    let b: ExpenseCategory;
    let c: ExpenseCategory;
    /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
    let missingId = 0;

    const cleanup = () =>
      service.client.tblexpenses_categories.deleteMany({
        where: { name: { startsWith: MARKER } },
      });

    beforeAll(async () => {
      await cleanup();
      a = await repository.create({ name: `${MARKER}-a`, description: STORED_TWO_LINES });
      b = await repository.create({ name: `${MARKER}-b`, description: '' });
      c = await repository.create({ name: `${MARKER}-c`, description: DESCRIPTION_TOKEN });
      const ghost = await repository.create({ name: `${MARKER}-ghost`, description: '' });
      missingId = ghost.id;
      await repository.remove(ghost.id);
    });

    afterAll(async () => {
      await cleanup();
      await service.client.$disconnect();
    });

    it('create answers the database id; findById returns the stored description byte for byte', async () => {
      expect(a.id).toBeGreaterThan(0);
      expect(await repository.findById(a.id)).toEqual({
        id: a.id,
        name: `${MARKER}-a`,
        description: STORED_TWO_LINES,
      });
      expect(await repository.findById(missingId)).toBeNull();
    });

    it('list with q = the marker returns exactly the three, in name order both ways', async () => {
      const ascending = await repository.list(request());
      expect(ids(ascending)).toEqual([a.id, b.id, c.id]);
      expect(ascending.total).toBe(3);
      expect(ascending.rangeStart).toBe(1);
      expect(ascending.nextCursor).toBeNull();
      expect(ascending.prevCursor).toBeNull();
      expect(ids(await repository.list(request({ order: 'desc' })))).toEqual([c.id, b.id, a.id]);
      expect(await repository.count(request())).toBe(3);
    });

    it('pages with limit 2: its next cursor returns the third, its previous cursor the first two', async () => {
      const first = await repository.list(request({ limit: 2 }));
      expect(ids(first)).toEqual([a.id, b.id]);
      const next = decodeCursor(first.nextCursor, 'name');
      expect(next).not.toBeNull();
      const second = await repository.list(request({ limit: 2, cursor: next }));
      expect(ids(second)).toEqual([c.id]);
      expect(second.rangeStart).toBe(3);
      expect(second.nextCursor).toBeNull();
      const back = await repository.list(
        request({ limit: 2, cursor: decodeCursor(second.prevCursor, 'name') }),
      );
      expect(ids(back)).toEqual([a.id, b.id]);
      expect(back.rangeStart).toBe(1);
    });

    it('q matching only a description finds that row', async () => {
      const page = await repository.list(request({ search: DESCRIPTION_TOKEN }));
      expect(ids(page)).toEqual([c.id]);
    });

    it('update changes a name; a missing id answers null', async () => {
      expect(await repository.update(b.id, { name: `${MARKER}-b2` })).toEqual({
        id: b.id,
        name: `${MARKER}-b2`,
        description: '',
      });
      expect(await repository.update(missingId, { name: `${MARKER}-nobody` })).toBeNull();
      expect(await repository.findById(missingId)).toBeNull();
    });

    it('usageByCategory reads the real sources: zeros for a new category (the petty-cash table absent)', async () => {
      const usage = await repository.usageByCategory([a.id, c.id]);
      expect([...usage.entries()]).toEqual([
        [a.id, { expenses: 0, accountingMappings: 0, pettyCashAdvances: 0 }],
        [c.id, { expenses: 0, accountingMappings: 0, pettyCashAdvances: 0 }],
      ]);
    });

    it('the presence probe answers true for tblexpenses and false for the petty-cash table on the local copy (D-15)', async () => {
      expect(await repository.tablePresent('tblexpenses')).toBe(true);
      expect(await repository.tablePresent(EXPENSE_CATEGORIES_PETTY_CASH_TABLE)).toBe(false);
    });

    it('remove answers true, then the row is gone, then remove answers false', async () => {
      expect(await repository.remove(c.id)).toBe(true);
      expect(await repository.findById(c.id)).toBeNull();
      expect(await repository.remove(c.id)).toBe(false);
    });
  },
);

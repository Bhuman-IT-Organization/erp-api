/**
 * PaymentModesRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * `tblpayment_modes` is node-owned since plan 04.1-22, so the ownership guard admits the writes this
 * spec makes through the typed delegate. The real probe is compared with a direct read of
 * `information_schema.COLUMNS` for the eight candidates (computed here, never hard-coded, so this
 * spec stays true when a column appears); every present usage statement runs against the real
 * schema and equals an independent count (the column read through its typed delegate for the ids'
 * text, then counted with an exact JavaScript string comparison); the exact-text expression is
 * checked on bound literals; Perfex's description storage and the seven columns are read back byte
 * for byte.
 *
 * Everything this spec writes it creates itself and deletes again: `tblpayment_modes` rows whose
 * name starts with `MARKER`, removed before the run (a leftover of a crashed run) and after it. No
 * other table is written (the referencing tables are Perfex's and its modules': the guard refuses
 * them), no seeded row is touched, and no value from the local data is read into an assertion
 * message: ids and counts are compared, never printed, and every name asserted is one this spec
 * wrote.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { PAYMENT_MODES_NAME_MAX } from '../dto/payment-modes.dto.js';
import type {
  NewPaymentMode,
  PaymentModeRow,
  PaymentModesListRequest,
  PaymentModesPage,
  PaymentModeUsage,
} from '../model/payment-modes.model.js';
import {
  PAYMENT_MODE_REFERENCES,
  PaymentModesRepository,
  referenceKey,
} from '../repository/payment-modes.repository.js';
import {
  NO_PAYMENT_MODE_USAGE,
  toStoredDescription,
} from '../service/payment-modes.transformer.js';

/** Every row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-04.1-23-pm';

/** A two-line description as the form sends it, with markup, so Perfex's tag branch runs. */
const TWO_LINES = 'Line <b>one</b>\r\nline two';

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const oneCountSchema = z.tuple([z.object({ n: numberSchema })]);
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);
const equalSchema = z.tuple([z.object({ same: numberSchema })]);
const idsSchema = z.array(z.object({ id: z.number().int() }));
const textColumnSchema = z.array(z.record(z.string(), z.string().nullable()));

function request(overrides: Partial<PaymentModesListRequest> = {}): PaymentModesListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: PaymentModesPage): number[] => page.items.map((row) => row.id);

const input = (suffix: string, overrides: Partial<NewPaymentMode> = {}): NewPaymentMode => ({
  name: `${MARKER}-${suffix}`,
  description: '',
  active: true,
  showOnPdf: 0,
  selectedByDefault: 0,
  invoicesOnly: 0,
  expensesOnly: 0,
  ...overrides,
});

describe.skipIf(!process.env.DATABASE_URL)(
  'PaymentModesRepository against the local mirror',
  () => {
    const service = new PrismaService(new AppConfig(), new HealthService());
    const repository = new PaymentModesRepository(service);
    const client = service.client;
    let a: PaymentModeRow;
    let b: PaymentModeRow;
    let c: PaymentModeRow;
    /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
    let missingId = 0;

    const cleanup = () =>
      client.tblpayment_modes.deleteMany({ where: { name: { startsWith: MARKER } } });

    /**
     * Each candidate's column read through its typed delegate for the given texts, as stored: the
     * independent twin of the repository's statement (the `in` compares under the column's collation,
     * a superset; the exact match is done in JavaScript).
     */
    const readers: Readonly<Record<keyof PaymentModeUsage, (texts: string[]) => Promise<unknown>>> =
      {
        invoicePayments: (texts) =>
          client.tblinvoicepaymentrecords.findMany({
            where: { paymentmode: { in: texts } },
            select: { paymentmode: true },
          }),
        expenses: (texts) =>
          client.tblexpenses.findMany({
            where: { paymentmode: { in: texts } },
            select: { paymentmode: true },
          }),
        creditNoteRefunds: (texts) =>
          client.tblcreditnote_refunds.findMany({
            where: { payment_mode: { in: texts } },
            select: { payment_mode: true },
          }),
        purchaseInvoicePayments: (texts) =>
          client.tblpur_invoice_payment.findMany({
            where: { paymentmode: { in: texts } },
            select: { paymentmode: true },
          }),
        purchaseOrderPayments: (texts) =>
          client.tblpur_order_payment.findMany({
            where: { paymentmode: { in: texts } },
            select: { paymentmode: true },
          }),
        debitNoteRefunds: (texts) =>
          client.tblpur_debits_refunds.findMany({
            where: { payment_mode: { in: texts } },
            select: { payment_mode: true },
          }),
        fixedEquipmentRefunds: (texts) =>
          client.tblfe_refunds.findMany({
            where: { payment_mode: { in: texts } },
            select: { payment_mode: true },
          }),
        orderReturnRefunds: (texts) =>
          client.tblwh_order_returns_refunds.findMany({
            where: { payment_mode: { in: texts } },
            select: { payment_mode: true },
          }),
      };

    /** Whether the connected schema has `table.column`, read directly (the probe's independent twin). */
    async function hasColumn(table: string, column: string): Promise<boolean> {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${column}`;
      return oneCountSchema.parse(rows)[0].n > 0;
    }

    beforeAll(async () => {
      await cleanup();
      c = await repository.create(input('c'));
      a = await repository.create(
        input('a <b>', {
          description: toStoredDescription(TWO_LINES),
          active: false,
          showOnPdf: 1,
          invoicesOnly: 1,
          expensesOnly: 1,
        }),
      );
      b = await repository.create(input('b', { selectedByDefault: 1 }));
      const ghost = await repository.create(input('ghost'));
      missingId = ghost.id;
      await repository.remove(ghost.id);
    });

    afterAll(async () => {
      await cleanup();
      await service.client.$disconnect();
    });

    it("create answers the database id; findById returns the row byte for byte with Perfex's description storage", async () => {
      expect(a.id).toBeGreaterThan(0);
      const stored = toStoredDescription(TWO_LINES);
      // The first line ends in a closing tag, so Perfex gives it no <br />.
      expect(stored).toBe('Line <b>one</b>\nline two<br />\n');
      expect(await repository.findById(a.id)).toEqual({
        id: a.id,
        name: `${MARKER}-a <b>`,
        description: stored,
        active: false,
        showOnPdf: 1,
        selectedByDefault: 0,
        invoicesOnly: 1,
        expensesOnly: 1,
      });
      expect(await repository.findById(b.id)).toMatchObject({
        active: true,
        showOnPdf: 0,
        selectedByDefault: 1,
        invoicesOnly: 0,
        expensesOnly: 0,
      });
      expect(await repository.findById(missingId)).toBeNull();
    });

    it('update rewrites all seven columns; a missing id is null', async () => {
      const patch = input('b2', {
        description: toStoredDescription('one\ntwo'),
        active: false,
        showOnPdf: 1,
        selectedByDefault: 0,
        invoicesOnly: 1,
        expensesOnly: 0,
      });
      const updated = await repository.update(b.id, patch);
      expect(updated).toEqual({ id: b.id, ...patch });
      expect(await repository.findById(b.id)).toEqual(updated);
      expect(await repository.update(missingId, input('nobody'))).toBeNull();
      // Back to the name order the paging case expects: a, b, c.
      await repository.update(b.id, input('b', { selectedByDefault: 1 }));
    });

    it('setActive flips active only; a second call with the same value answers true (the row matched); a missing id is false', async () => {
      const before = await repository.findById(c.id);
      expect(await repository.setActive(c.id, false)).toBe(true);
      expect(await repository.findById(c.id)).toEqual({ ...before, active: false });
      expect(await repository.setActive(c.id, false)).toBe(true);
      expect(await repository.setActive(c.id, true)).toBe(true);
      expect(await repository.findById(c.id)).toEqual(before);
      expect(await repository.setActive(missingId, true)).toBe(false);
    });

    it('three marker names page with limit 1 both ways under q, by name, by the id and by active', async () => {
      const first = await repository.list(request({ limit: 1 }));
      expect(ids(first)).toEqual([a.id]);
      expect(first.total).toBe(3);
      const second = await repository.list(
        request({ limit: 1, cursor: decodeCursor(first.nextCursor, 'name') }),
      );
      expect(ids(second)).toEqual([b.id]);
      const third = await repository.list(
        request({ limit: 1, cursor: decodeCursor(second.nextCursor, 'name') }),
      );
      expect(ids(third)).toEqual([c.id]);
      expect(third.nextCursor).toBeNull();
      expect(third.rangeStart).toBe(3);
      const back = await repository.list(
        request({ limit: 1, cursor: decodeCursor(third.prevCursor, 'name') }),
      );
      expect(ids(back)).toEqual([b.id]);
      const byId = await repository.list(request({ sortField: 'id', order: 'desc' }));
      expect(ids(byId)).toEqual([b.id, a.id, c.id]);

      // active: a is inactive, b and c active; ascending reads false first, ties on the id.
      const byActive = await repository.list(request({ sortField: 'active' }));
      expect(ids(byActive)).toEqual([a.id, c.id, b.id]);
      const walk: number[] = [];
      let cursor: string | null = null;
      do {
        const page: PaymentModesPage = await repository.list(
          request({ sortField: 'active', limit: 1, cursor: decodeCursor(cursor, 'active') }),
        );
        walk.push(...ids(page));
        cursor = page.nextCursor;
      } while (cursor !== null);
      expect(walk).toEqual([a.id, c.id, b.id]);
      const down = await repository.list(request({ sortField: 'active', order: 'desc', limit: 2 }));
      expect(ids(down)).toEqual([b.id, c.id]);
      const downNext = await repository.list(
        request({
          sortField: 'active',
          order: 'desc',
          limit: 2,
          cursor: decodeCursor(down.nextCursor, 'active'),
        }),
      );
      expect(ids(downNext)).toEqual([a.id]);
      const downBack = await repository.list(
        request({
          sortField: 'active',
          order: 'desc',
          limit: 2,
          cursor: decodeCursor(downNext.prevCursor, 'active'),
        }),
      );
      expect(ids(downBack)).toEqual([b.id, c.id]);
      expect(await repository.count(request())).toBe(3);
    });

    it('q matches the description and an id; an all-digit q up to INT runs', async () => {
      expect(ids(await repository.list(request({ search: 'line two' })))).toContain(a.id);
      expect(ids(await repository.list(request({ search: String(c.id) })))).toContain(c.id);
      await expect(repository.count(request({ search: '2147483647' }))).resolves.toBeTypeOf(
        'number',
      );
    });

    it('CHARACTER_MAXIMUM_LENGTH of tblpayment_modes.name equals PAYMENT_MODES_NAME_MAX', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblpayment_modes' AND COLUMN_NAME = 'name'`;
      expect(lengthSchema.parse(rows)[0].len).toBe(PAYMENT_MODES_NAME_MAX);
    });

    it('presentReferences equals a direct read of information_schema.COLUMNS; every absent candidate is simply not in it', async () => {
      const found = await Promise.all(
        PAYMENT_MODE_REFERENCES.map(async (reference) =>
          (await hasColumn(reference.table, reference.column)) ? [referenceKey(reference)] : [],
        ),
      );
      const expected = new Set(found.flat());
      const present = await repository.presentReferences();
      expect([...present].sort()).toEqual([...expected].sort());
    });

    it('usageByPaymentMode over every id runs every present statement and equals exact-text counts', async () => {
      const everyId = idsSchema
        .parse(await client.tblpayment_modes.findMany({ select: { id: true } }))
        .map((row) => row.id);
      const texts = everyId.map(String);
      const present = await repository.presentReferences();
      const usage = await repository.usageByPaymentMode(everyId);
      expect([...usage.keys()].sort((x, y) => x - y)).toEqual([...everyId].sort((x, y) => x - y));

      for (const reference of PAYMENT_MODE_REFERENCES) {
        const expected = new Map<number, number>(everyId.map((id) => [id, 0]));
        if (present.has(referenceKey(reference))) {
          const rows = textColumnSchema.parse(await readers[reference.group](texts));
          for (const row of rows) {
            const value = row[reference.column] ?? null;
            const id = everyId.find((candidate) => String(candidate) === value);
            if (id !== undefined) expected.set(id, (expected.get(id) ?? 0) + 1);
          }
        }
        const actual = new Map(everyId.map((id) => [id, usage.get(id)?.[reference.group] ?? -1]));
        expect(actual, reference.group).toEqual(expected);
      }
    });

    it('the marker rows are used by nothing: zeros in all eight groups', async () => {
      const usage = await repository.usageByPaymentMode([a.id, c.id]);
      expect([...usage.entries()]).toEqual([
        [a.id, NO_PAYMENT_MODE_USAGE],
        [c.id, NO_PAYMENT_MODE_USAGE],
      ]);
    });

    it.each([
      ['7', '7', 1],
      ['7 ', '7', 0],
      ['07', '7', 0],
      ['stripe', '7', 0],
      [' 7', '7', 0],
    ])(
      'the exact-text comparison on bound literals: %j against %j is %d',
      async (left, right, same) => {
        const rows = await client.$queryRaw<
          unknown[]
        >`SELECT CAST(${left} AS BINARY) = CAST(${right} AS BINARY) AS same`;
        expect(equalSchema.parse(rows)[0].same).toBe(same);
      },
    );

    it('listAll and findByIds read the marker rows as stored', async () => {
      const own = (await repository.listAll())
        .filter((row) => row.name.startsWith(MARKER))
        .map((row) => row.id);
      expect(own).toEqual([a.id, b.id, c.id]);
      const picked = await repository.findByIds([c.id, missingId, a.id]);
      expect(picked.map((row) => row.id).sort((x, y) => x - y)).toEqual(
        [a.id, c.id].sort((x, y) => x - y),
      );
    });

    it('remove answers true, then the row is gone, then false; 0 marker rows remain after the cleanup', async () => {
      expect(await repository.remove(c.id)).toBe(true);
      expect(await repository.findById(c.id)).toBeNull();
      expect(await repository.remove(c.id)).toBe(false);
      await cleanup();
      expect(await client.tblpayment_modes.count({ where: { name: { startsWith: MARKER } } })).toBe(
        0,
      );
    });
  },
);

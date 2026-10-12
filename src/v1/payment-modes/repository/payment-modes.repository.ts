/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the one table it writes (ADR-0029; `ownership.json` since plan 04.1-22, W2A-04):
 *   `tblpayment_modes`    node: the seven columns of Perfex's form, `name` (`VARCHAR(100)`),
 *                         `description` (`MEDIUMTEXT`, stored as Perfex's `nl2br_save_html`
 *                         writes it), `active` (`TINYINT(1)`) and the four `INT` boxes
 *                         `show_on_pdf`, `selected_by_default`, `invoices_only`, `expenses_only`;
 *                         `id` is assigned by the database. A create and an update write all seven
 *                         (Perfex's edit rewrites every field); the switch writes `active` only.
 *                         Every read and write goes through the typed delegate, which the ownership
 *                         guard admits because the register names `node`. No show-to-client column
 *                         exists, and none is written (D-35).
 *
 * `PAYMENT_MODE_REFERENCES`: what refers to a payment mode, read for the delete refusal (D-33) and
 * each row's usage. A DECLARED candidate list (plan 04.1-22's eight transactional columns), each a
 * Perfex or Perfex-module column, read only and never written:
 *
 *   group                    owner (register)     table.column
 *   invoicePayments          unattributed         tblinvoicepaymentrecords.paymentmode   VARCHAR(40)
 *   expenses                 perfex-core          tblexpenses.paymentmode                VARCHAR(50)
 *   creditNoteRefunds        unattributed         tblcreditnote_refunds.payment_mode     VARCHAR(40)
 *   purchaseInvoicePayments  purchase             tblpur_invoice_payment.paymentmode     LONGTEXT
 *   purchaseOrderPayments    purchase             tblpur_order_payment.paymentmode       LONGTEXT
 *   debitNoteRefunds         purchase             tblpur_debits_refunds.payment_mode     VARCHAR(40)
 *   fixedEquipmentRefunds    fixed_equipment      tblfe_refunds.payment_mode             VARCHAR(40)
 *   orderReturnRefunds       purchase             tblwh_order_returns_refunds.payment_mode VARCHAR(40)
 *
 * Why text, compared exactly: every one of these columns is text because it also holds an online
 * gateway's id (`stripe`, `paypal`), so a payment mode counts only where the column holds its id's
 * decimal text EXACTLY: `CAST(r.<column> AS BINARY)` compares the bytes, so no collation folds case
 * or pads spaces and no numeric conversion reads `' 7'`, `'7 '` or `'07'` as 7. The ids are bound as
 * decimal text, never as numbers, and an answer row is kept only when its id is exactly a page id's
 * decimal text.
 *
 * Never counted, and never named in a statement: configuration. The accounting mappings
 * (`tblacc_payment_mode_mappings.payment_mode_id`, `tblacc_expense_category_mapping_details.
 * payment_mode_id`) and the "allowed" lists (`tblinvoices.allowed_payment_modes`, serialized;
 * `tblfe_cart.allowed_payment_modes`): Perfex allows deleting a mapped or allowed mode, so they do
 * not block a delete (D-33).
 *
 * The runtime probe (D-28, applied by D-33): before every usage read, ONE statement over
 * `information_schema.COLUMNS` (the candidate table and column names BOUND, never SQL text) answers
 * which candidates exist in the connected schema; only those run, and a missing one counts 0 and
 * raises no error. It is never cached: a module's table may be absent from one install and present
 * in another, and when a later slice adds or migrates a column this module counts it with no code
 * change. This module never adds a column to any table (the standing rule: never patch Perfex).
 *
 * Each present candidate is ONE tagged `$queryRaw` over all the ids at once, the table and column
 * names literal SQL text and the ids bound with `Prisma.join` (no unsafe or raw-text variant, and no
 * write keyword: the ownership guard reads one as a write):
 *   SELECT r.<c> AS id, COUNT(*) AS n FROM <table> r WHERE CAST(r.<c> AS BINARY) IN (<ids>)
 *   GROUP BY r.<c>
 *
 * Fail closed: an error from the probe or from any statement is not caught, so `usageByPaymentMode`
 * rejects. The list then answers its retryable error and a delete is refused, never allowed on a
 * count nobody could read (D-33). The service adds the other half: an answer without the id refuses.
 *
 * The `active` sort: Prisma's Boolean filter has `equals` and `not` only, so the shared
 * `keysetWhere` (`gt`/`lt`) cannot page on it; `activeKeyset` writes the same predicate with
 * equality (a boolean has one value beyond `false` and none beyond `true`).
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import {
  encodeCursor,
  keysetWhere,
  type DecodedCursor,
  type KeyValue,
} from '../../../shared/http/keyset.js';
import {
  PAYMENT_MODES_FACADE_MAX_ROWS,
  type NewPaymentMode,
  type PaymentModeRow,
  type PaymentModesListRequest,
  type PaymentModesPage,
  type PaymentModesSortField,
  type PaymentModeUsage,
} from '../model/payment-modes.model.js';
import { NO_PAYMENT_MODE_USAGE } from '../service/payment-modes.transformer.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The largest value of MySQL's signed `INT` (the id column): a longer all-digit `q` is not an id. */
const MAX_INT_ID = 2_147_483_647;

/** A page id's decimal text: what an answer row's id must be, exactly, to count. */
const DECIMAL_ID = /^[1-9][0-9]*$/;

/** The eight columns of the table; nothing else is selected. */
const COLUMNS = {
  id: true,
  name: true,
  description: true,
  active: true,
  show_on_pdf: true,
  selected_by_default: true,
  invoices_only: true,
  expenses_only: true,
} as const;

const rowSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    description: z.string().nullable(),
    active: z.boolean(),
    show_on_pdf: z.number().int(),
    selected_by_default: z.number().int(),
    invoices_only: z.number().int(),
    expenses_only: z.number().int(),
  })
  .transform((row): PaymentModeRow => ({
    id: row.id,
    name: row.name,
    description: row.description,
    active: row.active,
    showOnPdf: row.show_on_pdf,
    selectedByDefault: row.selected_by_default,
    invoicesOnly: row.invoices_only,
    expensesOnly: row.expenses_only,
  }));
const rowsSchema = z.array(rowSchema);

/** `COUNT(*)` arrives from MySQL as a bigint; a driver may hand a number. */
const countSchema = z.union([z.bigint(), z.number().int()]).transform(Number);
/** A usage answer: the column's stored text (exactly a page id's, by the statement) and its count. */
const usageRowsSchema = z.array(z.object({ id: z.string(), n: countSchema }));
const presentColumnsSchema = z.array(z.object({ t: z.string(), c: z.string() }));

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];
type UsageGroup = keyof PaymentModeUsage;
type RawClient = PrismaService['client'];

/** One payment mode's counts while the answers are summed into them. */
type MutableUsage = Record<UsageGroup, number>;

/** One candidate of D-33: the group it counts toward, where it lives, its statement. */
export interface PaymentModeReference {
  readonly group: UsageGroup;
  readonly table: string;
  readonly column: string;
  /** The tagged statement over the ids bound as decimal text: rows `{ id, n }`. */
  readonly count: (client: RawClient, ids: Prisma.Sql) => Promise<unknown>;
}

/**
 * The declared candidates of D-33 (plan 04.1-22's eight transactional columns). A column a later
 * finding adds joins here in the same shape; the probe decides at every read whether it runs.
 */
export const PAYMENT_MODE_REFERENCES: readonly PaymentModeReference[] = Object.freeze([
  {
    group: 'invoicePayments',
    table: 'tblinvoicepaymentrecords',
    column: 'paymentmode',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.paymentmode AS id, COUNT(*) AS n FROM tblinvoicepaymentrecords r WHERE CAST(r.paymentmode AS BINARY) IN (${ids}) GROUP BY r.paymentmode`,
  },
  {
    group: 'expenses',
    table: 'tblexpenses',
    column: 'paymentmode',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.paymentmode AS id, COUNT(*) AS n FROM tblexpenses r WHERE CAST(r.paymentmode AS BINARY) IN (${ids}) GROUP BY r.paymentmode`,
  },
  {
    group: 'creditNoteRefunds',
    table: 'tblcreditnote_refunds',
    column: 'payment_mode',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.payment_mode AS id, COUNT(*) AS n FROM tblcreditnote_refunds r WHERE CAST(r.payment_mode AS BINARY) IN (${ids}) GROUP BY r.payment_mode`,
  },
  {
    group: 'purchaseInvoicePayments',
    table: 'tblpur_invoice_payment',
    column: 'paymentmode',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.paymentmode AS id, COUNT(*) AS n FROM tblpur_invoice_payment r WHERE CAST(r.paymentmode AS BINARY) IN (${ids}) GROUP BY r.paymentmode`,
  },
  {
    group: 'purchaseOrderPayments',
    table: 'tblpur_order_payment',
    column: 'paymentmode',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.paymentmode AS id, COUNT(*) AS n FROM tblpur_order_payment r WHERE CAST(r.paymentmode AS BINARY) IN (${ids}) GROUP BY r.paymentmode`,
  },
  {
    group: 'debitNoteRefunds',
    table: 'tblpur_debits_refunds',
    column: 'payment_mode',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.payment_mode AS id, COUNT(*) AS n FROM tblpur_debits_refunds r WHERE CAST(r.payment_mode AS BINARY) IN (${ids}) GROUP BY r.payment_mode`,
  },
  {
    group: 'fixedEquipmentRefunds',
    table: 'tblfe_refunds',
    column: 'payment_mode',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.payment_mode AS id, COUNT(*) AS n FROM tblfe_refunds r WHERE CAST(r.payment_mode AS BINARY) IN (${ids}) GROUP BY r.payment_mode`,
  },
  {
    group: 'orderReturnRefunds',
    table: 'tblwh_order_returns_refunds',
    column: 'payment_mode',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.payment_mode AS id, COUNT(*) AS n FROM tblwh_order_returns_refunds r WHERE CAST(r.payment_mode AS BINARY) IN (${ids}) GROUP BY r.payment_mode`,
  },
]);

/** The key a candidate answers by: `table.column`, as declared. */
export function referenceKey(reference: Pick<PaymentModeReference, 'table' | 'column'>): string {
  return `${reference.table}.${reference.column}`;
}

/** `?q=`: the name or the description contains it; an all-digit `q` that fits the id column also matches the id. */
function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }, { description: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_INT_ID) or.push({ id: Number(search) });
  return { OR: or };
}

function keyOf(row: PaymentModeRow, sortField: PaymentModesSortField): Key {
  if (sortField === 'name') return [row.name, row.id];
  if (sortField === 'active') return [row.active, row.id];
  return [row.id, row.id];
}

/**
 * `keysetWhere` for the boolean `active` column, with equality only (Prisma's Boolean filter has
 * no `gt` or `lt`): the rows whose flag lies beyond the cursor's (`true` beyond `false` going up,
 * `false` beyond `true` going down; none beyond the last), or that share it with an id beyond.
 */
function activeKeyset(
  cursor: DecodedCursor<PaymentModesSortField>,
  order: 'asc' | 'desc',
): WhereValue {
  const op = (order === 'asc') === (cursor.direction === 'after') ? 'gt' : 'lt';
  const [value, id] = cursor.key;
  const beyond = op === 'gt' ? value === false : value === true;
  const same = { active: value, id: { [op]: id } };
  return { OR: beyond ? [{ active: op === 'gt' }, same] : [same] };
}

/** The predicate "rows strictly after (or before) the cursor row", per sort column. */
function keysetOf(
  sortField: PaymentModesSortField,
  cursor: DecodedCursor<PaymentModesSortField>,
  order: 'asc' | 'desc',
): WhereValue {
  return sortField === 'active'
    ? activeKeyset(cursor, order)
    : keysetWhere(sortField, 'id', cursor, order);
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: PaymentModesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: PaymentModesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<PaymentModesPage, 'items'> {
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) {
    return { nextCursor: null, prevCursor: null, total, rangeStart: 0 };
  }
  const rangeStart = before + 1;
  return {
    nextCursor:
      rangeStart - 1 + keys.length < total ? encodeCursor(sortField, last, 'after') : null,
    prevCursor: rangeStart > 1 ? encodeCursor(sortField, first, 'before') : null,
    total,
    rangeStart,
  };
}

/**
 * Adds one statement's `{ id, n }` rows to the group's count of each payment mode it names: a row
 * counts only when its id is exactly a page id's decimal text (`'7'` for 7; never `'07'`, `'7 '`,
 * a gateway id or another id).
 *
 * @complexity O(n) over the answer's rows
 */
function addCounts(totals: Map<number, MutableUsage>, group: UsageGroup, answer: unknown): void {
  for (const { id, n } of usageRowsSchema.parse(answer)) {
    const counts = DECIMAL_ID.test(id) ? totals.get(Number(id)) : undefined;
    if (counts !== undefined) counts[group] += n;
  }
}

/** Prisma's P2025, read from the error's `code` so no Prisma class leaves this file. */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}

/** The seven columns a create or an update writes, from the stored-form input. */
function dataOf(input: NewPaymentMode) {
  return {
    name: input.name,
    description: input.description,
    active: input.active,
    show_on_pdf: input.showOnPdf,
    selected_by_default: input.selectedByDefault,
    invoices_only: input.invoicesOnly,
    expenses_only: input.expensesOnly,
  };
}

@Injectable()
export class PaymentModesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One keyset page ordered by `(sort column, id)`, then `total` (the match without the cursor)
   * and the rank of the first row, both through `count`, exactly as the cost-centers list.
   */
  async list(request: PaymentModesListRequest): Promise<PaymentModesPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblpayment_modes.findMany({
      where: cursor === null ? match : { AND: [match, keysetOf(sortField, cursor, order)] },
      orderBy: [{ [sortField]: read }, { id: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblpayment_modes.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblpayment_modes.count({
            where: {
              AND: [
                match,
                keysetOf(sortField, { sort: sortField, key: first, direction: 'before' }, order),
              ],
            },
          }),
    ]);
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  /** The list's own match without the cursor: what the export counts before it reads a row. */
  count(request: PaymentModesListRequest): Promise<number> {
    return this.prisma.client.tblpayment_modes.count({ where: matchOf(request.search) });
  }

  /** One row in its stored form, or `null` when the id is missing. */
  async findById(id: number): Promise<PaymentModeRow | null> {
    const row = await this.prisma.client.tblpayment_modes.findFirst({
      where: { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** Inserts a row with the seven columns; the database assigns the id. */
  async create(input: NewPaymentMode): Promise<PaymentModeRow> {
    const row = await this.prisma.client.tblpayment_modes.create({
      data: dataOf(input),
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  /** Rewrites all seven columns, as Perfex's edit does; `null` when the id is missing (Prisma P2025). */
  async update(id: number, patch: NewPaymentMode): Promise<PaymentModeRow | null> {
    try {
      const row = await this.prisma.client.tblpayment_modes.update({
        where: { id },
        data: dataOf(patch),
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * The switch: writes `active` and nothing else; `true` when a row matched the id. Whether MySQL
   * counts a row whose flag was already so is the driver's; the service reads the row first and
   * never relies on it.
   */
  async setActive(id: number, active: boolean): Promise<boolean> {
    const { count } = await this.prisma.client.tblpayment_modes.updateMany({
      where: { id },
      data: { active },
    });
    return count > 0;
  }

  /** Deletes a row; `false` when nothing was deleted (the id was missing). */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tblpayment_modes.deleteMany({ where: { id } });
    return count > 0;
  }

  /**
   * The candidates of `PAYMENT_MODE_REFERENCES` the connected schema has right now, as
   * `table.column` keys: ONE `information_schema.COLUMNS` read with every name bound, matched
   * exactly (letter case folded on both sides, as MySQL may answer a name in another case). An
   * absent table or column is simply not in the set. Never cached (D-28, D-33).
   *
   * @complexity O(r + c) over the answer's rows and the candidates
   */
  async presentReferences(): Promise<ReadonlySet<string>> {
    const tables = [...new Set(PAYMENT_MODE_REFERENCES.map((reference) => reference.table))];
    const columns = [...new Set(PAYMENT_MODE_REFERENCES.map((reference) => reference.column))];
    const rows = presentColumnsSchema.parse(
      await this.prisma.client
        .$queryRaw`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join(tables)}) AND COLUMN_NAME IN (${Prisma.join(columns)})`,
    );
    const found = new Set(rows.map((row) => `${row.t}.${row.c}`.toLowerCase()));
    return new Set(
      PAYMENT_MODE_REFERENCES.map(referenceKey).filter((key) => found.has(key.toLowerCase())),
    );
  }

  /**
   * What refers to each payment mode: the probe first, then one statement per PRESENT candidate in
   * one `Promise.all`, the ids bound as decimal text, then one `PaymentModeUsage` per id (zeros where
   * nothing refers to it, and for every missing candidate). No ids, no query. An error from the probe
   * or any statement rejects the whole answer (fail closed).
   *
   * @complexity O(c + r) over the candidates and the answers' rows
   */
  async usageByPaymentMode(ids: readonly number[]): Promise<ReadonlyMap<number, PaymentModeUsage>> {
    if (ids.length === 0) return new Map();
    const present = await this.presentReferences();
    const reads = PAYMENT_MODE_REFERENCES.filter((reference) =>
      present.has(referenceKey(reference)),
    );
    const bound = Prisma.join(ids.map(String));
    const answers = await Promise.all(
      reads.map((reference) => reference.count(this.prisma.client, bound)),
    );
    const totals = new Map<number, MutableUsage>(
      ids.map((id) => [id, { ...NO_PAYMENT_MODE_USAGE }]),
    );
    reads.forEach((reference, index) => {
      addCounts(totals, reference.group, answers[index]);
    });
    return totals;
  }

  /**
   * Every payment mode, the name ascending, then the id (the order Perfex's list reads): the
   * facade's `listAll`. Reads one row more than `PAYMENT_MODES_FACADE_MAX_ROWS` and refuses loudly
   * when it finds it, never answering a truncated list.
   */
  async listAll(): Promise<readonly PaymentModeRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblpayment_modes.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: PAYMENT_MODES_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > PAYMENT_MODES_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(PAYMENT_MODES_FACADE_MAX_ROWS)} payment modes: the full list was refused, not truncated`,
      );
    }
    return rows;
  }

  /** The rows whose id is in `ids`, in no particular order (the service orders them). */
  async findByIds(ids: readonly number[]): Promise<readonly PaymentModeRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema.parse(
      await this.prisma.client.tblpayment_modes.findMany({
        where: { id: { in: [...ids] } },
        select: COLUMNS,
      }),
    );
  }
}

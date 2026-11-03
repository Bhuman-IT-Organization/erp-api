/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the one table it writes (ADR-0029; `ownership.json`):
 *   `tblknowledge_base`    node: `name` (`VARCHAR(255)`); on create only, `created_by` (the signed-in
 *                         staff id) and `datecreated` (Perfex's wall clock, D-31); `id` is assigned
 *                         by the database. An update writes the name and nothing else. Every read
 *                         and write goes through the typed delegate, which the ownership guard
 *                         admits because the register names `node`.
 *
 * `KNOWLEDGE_BASE_REFERENCES`: what refers to a knowledge base, read for the delete refusal (D-07) and
 * each row's usage. A DECLARED candidate list (D-28), each entry a Perfex or Perfex-module column,
 * read only and never written:
 *
 *   group               owner             table.column                       match
 *   purchaseRequests    purchase          tblpur_request.knowledge_base      id
 *   purchaseOrders      purchase          tblpur_orders.knowledge_base       id
 *   purchaseQuotations  purchase          tblpur_estimates.knowledge_base    id
 *   shippingCharges     (unregistered)    tblinv_shipping_charges.knowledge_base id
 *   expenses            perfex-core       tblexpenses.knowledge_base         id
 *   assets              fixed_equipment   tblfe_asset_creation.knowledge_centre name
 *
 * The runtime probe (D-28): before every usage read, ONE statement over `information_schema.COLUMNS`
 * (the candidate table and column names BOUND, never SQL text) answers which candidates exist in the
 * connected schema; only those run, and a missing one counts 0 and raises no error. It is never
 * cached.
 *
 * Fail closed: an error from the probe or from any statement is not caught, so `usageByKnowledgeBase`
 * rejects. The list then answers its retryable error and a delete is refused, never allowed on a
 * count nobody could read (D-07). The service adds the other half: an answer without the id refuses.
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  KNOWLEDGE_BASE_FACADE_MAX_ROWS,
  type KnowledgeBaseRow,
  type KnowledgeBaseGroupRow,
  type KnowledgeBaseListRequest,
  type KnowledgeBasePage,
  type KnowledgeBaseSortField,
  type KnowledgeBaseUsage,
  type NewKnowledgeBase,
  type NewKnowledgeBaseGroup,
} from '../model/knowledge-base.model.js';
import { NO_KNOWLEDGE_BASE_USAGE } from '../service/knowledge-base.transformer.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The largest value of MySQL's `INT UNSIGNED` (the id column): a longer all-digit `q` is not an id. */
const MAX_UNSIGNED_INT_ID = 4_294_967_295;

/** The four columns of the table; nothing else is selected. */
const COLUMNS = { id: true, name: true, created_by: true, datecreated: true } as const;

const rowSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    created_by: z.number().int().nullable(),
    datecreated: z.date().nullable(),
  })
  .transform((row): KnowledgeBaseRow => ({
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    datecreated: row.datecreated,
  }));
const rowsSchema = z.array(rowSchema);

/** `COUNT(*)` arrives from MySQL as a bigint; a driver may hand a number. */
const countSchema = z.union([z.bigint(), z.number().int()]).transform(Number);
const usageRowsSchema = z.array(z.object({ id: z.coerce.number().int(), n: countSchema }));
const presentColumnsSchema = z.array(z.object({ t: z.string(), c: z.string() }));

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];
type UsageGroup = keyof KnowledgeBaseUsage;
type RawClient = PrismaService['client'];

/** One knowledge base's counts while the answers are summed into them. */
type MutableUsage = Record<UsageGroup, number>;

/** How a referencing column names a knowledge base: by its id, or by its name as text. */
export type KnowledgeBaseMatch = 'id' | 'name';

/** One candidate of D-28: the group it counts toward, where it lives, how it matches, its statement. */
export interface KnowledgeBaseReference {
  readonly group: UsageGroup;
  readonly table: string;
  readonly column: string;
  readonly match: KnowledgeBaseMatch;
  /** The tagged statement over the bound ids: rows `{ id, n }`. */
  readonly count: (client: RawClient, ids: Prisma.Sql) => Promise<unknown>;
}

/**
 * The declared candidates of D-28: six columns, five by id and one by name.
 */
export const KNOWLEDGE_BASE_REFERENCES: readonly KnowledgeBaseReference[] = Object.freeze([
  {
    group: 'purchaseRequests',
    table: 'tblpur_request',
    column: 'knowledge_base',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.knowledge_base AS id, COUNT(*) AS n FROM tblpur_request r WHERE r.knowledge_base IN (${ids}) GROUP BY r.knowledge_base`,
  },
  {
    group: 'purchaseOrders',
    table: 'tblpur_orders',
    column: 'knowledge_base',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.knowledge_base AS id, COUNT(*) AS n FROM tblpur_orders r WHERE r.knowledge_base IN (${ids}) GROUP BY r.knowledge_base`,
  },
  {
    group: 'purchaseQuotations',
    table: 'tblpur_estimates',
    column: 'knowledge_base',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.knowledge_base AS id, COUNT(*) AS n FROM tblpur_estimates r WHERE r.knowledge_base IN (${ids}) GROUP BY r.knowledge_base`,
  },
  {
    group: 'shippingCharges',
    table: 'tblinv_shipping_charges',
    column: 'knowledge_base',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.knowledge_base AS id, COUNT(*) AS n FROM tblinv_shipping_charges r WHERE r.knowledge_base IN (${ids}) GROUP BY r.knowledge_base`,
  },
  {
    group: 'expenses',
    table: 'tblexpenses',
    column: 'knowledge_base',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.knowledge_base AS id, COUNT(*) AS n FROM tblexpenses r WHERE r.knowledge_base IN (${ids}) GROUP BY r.knowledge_base`,
  },
  {
    group: 'assets',
    table: 'tblfe_asset_creation',
    column: 'knowledge_centre',
    match: 'name',
    count: (client, ids) =>
      client.$queryRaw`SELECT c.id AS id, COUNT(*) AS n FROM tblknowledge_base c JOIN tblfe_asset_creation r ON CAST(r.knowledge_centre AS BINARY) = CAST(c.name AS BINARY) WHERE c.id IN (${ids}) GROUP BY c.id`,
  },
]);

/** The key a candidate answers by: `table.column`, as declared. */
export function referenceKey(reference: Pick<KnowledgeBaseReference, 'table' | 'column'>): string {
  return `${reference.table}.${reference.column}`;
}

/** `?q=`: the name contains it; an all-digit `q` that fits the id column also matches the id. */
function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_UNSIGNED_INT_ID)
    or.push({ id: Number(search) });
  return { OR: or };
}

function keyOf(row: KnowledgeBaseRow, sortField: KnowledgeBaseSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: KnowledgeBaseListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: KnowledgeBaseSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<KnowledgeBasePage, 'items'> {
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
 * Adds one statement's `{ id, n }` rows to the group's count of each knowledge base it names.
 *
 * @complexity O(n) over the answer's rows
 */
function addCounts(totals: Map<number, MutableUsage>, group: UsageGroup, answer: unknown): void {
  for (const { id, n } of usageRowsSchema.parse(answer)) {
    const counts = totals.get(id);
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

interface KnowledgeBaseDelegate {
  findMany(args: unknown): Promise<unknown[]>;
  count(args?: unknown): Promise<number>;
  findFirst(args: unknown): Promise<unknown>;
  create(args: unknown): Promise<unknown>;
  update(args: unknown): Promise<unknown>;
  deleteMany(args: unknown): Promise<{ count: number }>;
}

@Injectable()
export class KnowledgeBaseRepository {
  constructor(private readonly prisma: PrismaService) {}

  private get table(): KnowledgeBaseDelegate {
    const delegate = (this.prisma.client as unknown as Record<string, KnowledgeBaseDelegate>)
      .tblknowledge_base;
    if (delegate === undefined) {
      throw new Error('tblknowledge_base delegate missing');
    }
    return delegate;
  }

  /**
   * One keyset page ordered by `(sort column, id)`, then `total` (the match without the cursor)
   * and the rank of the first row, both through `count`, exactly as the taxes list.
   */
  async list(request: KnowledgeBaseListRequest): Promise<KnowledgeBasePage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.table.findMany({
      where:
        cursor === null ? match : { AND: [match, keysetWhere(sortField, 'id', cursor, order)] },
      orderBy: [{ [sortField]: read }, { id: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.table.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.table.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  sortField,
                  'id',
                  { sort: sortField, key: first, direction: 'before' },
                  order,
                ),
              ],
            },
          }),
    ]);
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  /** The list's own match without the cursor: what the export counts before it reads a row. */
  count(request: KnowledgeBaseListRequest): Promise<number> {
    return this.table.count({ where: matchOf(request.search) });
  }

  /** One row in its stored form, or `null` when the id is missing. */
  async findById(id: number): Promise<KnowledgeBaseRow | null> {
    const row = await this.table.findFirst({
      where: { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** Inserts a row with Perfex's two create columns (D-31); the database assigns the id. */
  async create(input: NewKnowledgeBase): Promise<KnowledgeBaseRow> {
    const row = await this.table.create({
      data: { name: input.name, created_by: input.createdBy, datecreated: input.datecreated },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  /** Changes the name and NOTHING else (D-31); `null` when the id is missing (Prisma P2025). */
  async update(id: number, patch: { readonly name: string }): Promise<KnowledgeBaseRow | null> {
    try {
      const row = await this.table.update({
        where: { id },
        data: { name: patch.name },
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** Deletes a row; `false` when nothing was deleted (the id was missing). */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.table.deleteMany({ where: { id } });
    return count > 0;
  }

  /**
   * The candidates of `KNOWLEDGE_BASE_REFERENCES` the connected schema has right now, as `table.column`
   * keys: ONE `information_schema.COLUMNS` read with every name bound, matched exactly (letter case
   * folded on both sides, as MySQL may answer a name in another case). An absent table or column is
   * simply not in the set. Never cached (D-28).
   *
   * @complexity O(r + c) over the answer's rows and the candidates
   */
  async presentReferences(): Promise<ReadonlySet<string>> {
    const tables = [...new Set(KNOWLEDGE_BASE_REFERENCES.map((reference) => reference.table))];
    const columns = [...new Set(KNOWLEDGE_BASE_REFERENCES.map((reference) => reference.column))];
    const rows = presentColumnsSchema.parse(
      await this.prisma.client
        .$queryRaw`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join(tables)}) AND COLUMN_NAME IN (${Prisma.join(columns)})`,
    );
    const found = new Set(rows.map((row) => `${row.t}.${row.c}`.toLowerCase()));
    return new Set(
      KNOWLEDGE_BASE_REFERENCES.map(referenceKey).filter((key) => found.has(key.toLowerCase())),
    );
  }

  /**
   * What refers to each knowledge base: the probe first, then one statement per PRESENT candidate in
   * one `Promise.all`, then one `KnowledgeBaseUsage` per id (zeros where nothing refers to it, and for
   * every missing candidate). No ids, no query. An error from the probe or any statement rejects the
   * whole answer (fail closed).
   *
   * @complexity O(c + r) over the candidates and the answers' rows
   */
  async usageByKnowledgeBase(
    ids: readonly number[],
  ): Promise<ReadonlyMap<number, KnowledgeBaseUsage>> {
    if (ids.length === 0) return new Map();
    const present = await this.presentReferences();
    const reads = KNOWLEDGE_BASE_REFERENCES.filter((reference) =>
      present.has(referenceKey(reference)),
    );
    const bound = Prisma.join([...ids]);
    const answers = await Promise.all(
      reads.map((reference) => reference.count(this.prisma.client, bound)),
    );
    const totals = new Map<number, MutableUsage>(
      ids.map((id) => [id, { ...NO_KNOWLEDGE_BASE_USAGE }]),
    );
    reads.forEach((reference, index) => {
      addCounts(totals, reference.group, answers[index]);
    });
    return totals;
  }

  /**
   * Every knowledge base, the name ascending, then the id (the order Perfex's pickers read): the
   * facade's `listAll`. Reads one row more than `KNOWLEDGE_BASE_FACADE_MAX_ROWS` and refuses loudly
   * when it finds it, never answering a truncated list.
   */
  async listAll(): Promise<readonly KnowledgeBaseRow[]> {
    const rows = rowsSchema.parse(
      await this.table.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: KNOWLEDGE_BASE_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > KNOWLEDGE_BASE_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(KNOWLEDGE_BASE_FACADE_MAX_ROWS)} knowledge base: the full list was refused, not truncated`,
      );
    }
    return rows;
  }

  /** The rows whose id is in `ids`, in no particular order (the service orders them). */
  async findByIds(ids: readonly number[]): Promise<readonly KnowledgeBaseRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema.parse(
      await this.table.findMany({
        where: { id: { in: [...ids] } },
        select: COLUMNS,
      }),
    );
  }

  private get groupsTable() {
    return this.prisma.client.tblknowledge_base_groups;
  }

  private get articlesTable() {
    return this.prisma.client.tblknowledge_base;
  }

  async listGroups(search?: string | null): Promise<readonly KnowledgeBaseGroupRow[]> {
    const where = search
      ? {
          OR: [{ name: { contains: search } }, { description: { contains: search } }],
        }
      : {};
    const groups = await this.groupsTable.findMany({
      where,
      orderBy: [{ group_order: 'asc' }, { groupid: 'asc' }],
    });

    const groupIds = groups.map((g) => g.groupid);
    const countsMap = new Map<number, number>();
    if (groupIds.length > 0) {
      const counts = await Promise.all(
        groupIds.map((gid) => this.articlesTable.count({ where: { articlegroup: gid } })),
      );
      counts.forEach((c: number, i: number) => {
        const gid = groupIds[i];
        if (gid !== undefined) countsMap.set(gid, c);
      });
    }

    return groups.map((g) => ({
      groupid: g.groupid,
      name: g.name,
      group_slug: g.group_slug,
      description: g.description,
      active: g.active,
      color: g.color,
      group_order: g.group_order ?? 0,
      totalArticles: countsMap.get(g.groupid) ?? 0,
    }));
  }

  async findGroupById(groupid: number): Promise<KnowledgeBaseGroupRow | null> {
    const group = await this.groupsTable.findFirst({
      where: { groupid },
    });

    if (!group) return null;
    const totalArticles = await this.articlesTable.count({
      where: { articlegroup: groupid },
    });

    return {
      groupid: group.groupid,
      name: group.name,
      group_slug: group.group_slug,
      description: group.description,
      active: group.active,
      color: group.color,
      group_order: group.group_order ?? 0,
      totalArticles,
    };
  }

  async createGroup(data: NewKnowledgeBaseGroup): Promise<KnowledgeBaseGroupRow> {
    const created = await this.groupsTable.create({
      data: {
        name: data.name,
        group_slug: data.group_slug,
        description: data.description,
        active: data.active,
        color: data.color,
        group_order: data.group_order,
      },
    });

    return {
      groupid: created.groupid,
      name: created.name,
      group_slug: created.group_slug,
      description: created.description,
      active: created.active,
      color: created.color,
      group_order: created.group_order ?? 0,
      totalArticles: 0,
    };
  }

  async updateGroup(
    groupid: number,
    data: Partial<NewKnowledgeBaseGroup>,
  ): Promise<KnowledgeBaseGroupRow | null> {
    try {
      const updated = await this.groupsTable.update({
        where: { groupid },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.group_slug !== undefined ? { group_slug: data.group_slug } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.active !== undefined ? { active: data.active } : {}),
          ...(data.color !== undefined ? { color: data.color } : {}),
          ...(data.group_order !== undefined ? { group_order: data.group_order } : {}),
        },
      });

      const totalArticles = await this.articlesTable.count({
        where: { articlegroup: groupid },
      });

      return {
        groupid: updated.groupid,
        name: updated.name,
        group_slug: updated.group_slug,
        description: updated.description,
        active: updated.active,
        color: updated.color,
        group_order: updated.group_order ?? 0,
        totalArticles,
      };
    } catch (e) {
      if (isRecordNotFound(e)) return null;
      throw e;
    }
  }

  async removeGroup(groupid: number): Promise<{ deleted: boolean; inUse: boolean }> {
    const articlesCount = await this.articlesTable.count({
      where: { articlegroup: groupid },
    });
    if (articlesCount > 0) {
      return { deleted: false, inUse: true };
    }

    const { count } = await this.groupsTable.deleteMany({
      where: { groupid },
    });

    return { deleted: count > 0, inUse: false };
  }
}

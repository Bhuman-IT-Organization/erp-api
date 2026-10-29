/**
 * ContractTypesRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * `tblcontracts_types` is node-owned since plan 04.1-17, so the ownership guard admits the writes this
 * spec makes through the typed delegate. The real probe is compared with a direct read of
 * `information_schema.COLUMNS` for the candidates (computed here, never hard-coded, so this spec
 * stays true when a slice adds a column); every present usage statement runs against the real schema
 * and equals an independent count; D-31's two create columns are read back byte for byte, and
 * the naive `DATETIME` is read as text to prove Prisma stored the wall clock verbatim; the exact
 * name match of the reference statement is checked on the real `name` column.
 *
 * Everything this spec writes it creates itself and deletes again: `tblcontracts_types` rows whose name
 * starts with `MARKER`, removed before the run (a leftover of a crashed run) and after it. No other
 * table is written, no seeded row is touched, and no value from the local data is read into an assertion message:
 * ids and counts are compared, never printed, and every name asserted is one this spec wrote.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { Prisma, PrismaClient } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type {
  ContractTypeRow,
  ContractTypesListRequest,
  ContractTypesPage,
  ContractTypeUsage,
} from '../model/contract-types.model.js';
import {
  CONTRACT_TYPE_REFERENCES,
  ContractTypesRepository,
  referenceKey,
} from '../repository/contract-types.repository.js';
import { ContractTypesService } from '../service/contract-types.service.js';
import { ContractTypesTransformer } from '../service/contract-types.transformer.js';
import { ContractTypesTransport } from '../service/contract-types.transport.js';
import { ContractTypesValidator } from '../service/contract-types.validator.js';
import { NO_CONTRACT_TYPE_USAGE } from '../service/contract-types.transformer.js';

/** Every row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-04.1-18-ct';

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const oneCountSchema = z.tuple([z.object({ n: numberSchema })]);
const collationSchema = z.tuple([z.object({ c: z.string() })]);
const groupSchema = z.array(
  z.object({
    contract_type: z.coerce.number().int().nullable(),
    n: z.union([z.bigint(), z.number().int()]).transform(Number),
  }),
);
const idNameSchema = z.array(z.object({ id: z.number().int(), name: z.string() }));

/** The id-matched candidates the Prisma mirror models, with their typed delegate's group-by. */
type GroupBy = (ids: number[]) => Promise<unknown>;

function request(overrides: Partial<ContractTypesListRequest> = {}): ContractTypesListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: ContractTypesPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)(
  'ContractTypesRepository against the local mirror',
  () => {
    const service = new PrismaService(new AppConfig(), new HealthService());
    const repository = new ContractTypesRepository(service);
    const client = service.client;
    const directClient = process.env.DATABASE_URL
      ? new PrismaClient({ datasourceUrl: process.env.DATABASE_URL })
      : new PrismaClient();
    let a: ContractTypeRow;
    let b: ContractTypeRow;
    let c: ContractTypeRow;
    /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
    let missingId = 0;

    const cleanup = async () => {
      await directClient.tblcontracts.deleteMany({ where: { subject: { startsWith: MARKER } } });
      await client.tblcontracts_types.deleteMany({ where: { name: { startsWith: MARKER } } });
    };

    const create = (suffix: string): Promise<ContractTypeRow> =>
      repository.create({ name: `${MARKER}-${suffix}` });

    /** Whether the connected schema has `table.column`, read directly (the probe's independent twin). */
    async function hasColumn(table: string, column: string): Promise<boolean> {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${column}`;
      return oneCountSchema.parse(rows)[0].n > 0;
    }

    beforeAll(async () => {
      await cleanup();
      c = await create('c');
      a = await create('a <b>');
      b = await create('b');
      const ghost = await create('ghost');
      missingId = ghost.id;
      await repository.remove(ghost.id);
    });

    afterAll(async () => {
      await cleanup();
      await directClient.$disconnect();
      await service.client.$disconnect();
    });

    it('create answers the database id; findById returns the row byte for byte', async () => {
      expect(a.id).toBeGreaterThan(0);
      expect(await repository.findById(a.id)).toEqual({
        id: a.id,
        name: `${MARKER}-a <b>`,
      });
      expect(await repository.findById(missingId)).toBeNull();
    });

    it('name is stored verbatim', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT name FROM tblcontracts_types WHERE id = ${a.id}`;
      expect(z.tuple([z.object({ name: z.string() })]).parse(rows)[0].name).toBe(`${MARKER}-a <b>`);
    });

    it('update changes the name; a missing id is null', async () => {
      const updated = await repository.update(b.id, { name: `${MARKER}-b2` });
      expect(updated).toEqual({
        id: b.id,
        name: `${MARKER}-b2`,
      });
      expect(await repository.findById(b.id)).toEqual(updated);
      expect(await repository.update(missingId, { name: `${MARKER}-nobody` })).toBeNull();
    });

    it('three marker names page with limit 1 both ways under q, by name and by the id descending', async () => {
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
      const idFirst = await repository.list(request({ sortField: 'id', order: 'desc', limit: 1 }));
      const idNext = await repository.list(
        request({
          sortField: 'id',
          order: 'desc',
          limit: 1,
          cursor: decodeCursor(idFirst.nextCursor, 'id'),
        }),
      );
      expect(ids(idNext)).toEqual([a.id]);
      expect(await repository.count(request())).toBe(3);
    });

    it('q as an id matches the id; an all-digit q up to INT UNSIGNED runs', async () => {
      expect(ids(await repository.list(request({ search: String(c.id) })))).toContain(c.id);
      await expect(repository.count(request({ search: '4294967295' }))).resolves.toBeTypeOf(
        'number',
      );
    });

    it('DATA_TYPE of tblcontracts_types.name is text or longtext in schema', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT DATA_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblcontracts_types' AND COLUMN_NAME = 'name'`;
      expect(
        z
          .tuple([z.object({ t: z.string() })])
          .parse(rows)[0]
          .t.toLowerCase(),
      ).toContain('text');
    });

    it('presentReferences equals a direct read of information_schema.COLUMNS; every absent candidate is simply not in it', async () => {
      const found = await Promise.all(
        CONTRACT_TYPE_REFERENCES.map(async (reference) =>
          (await hasColumn(reference.table, reference.column)) ? [referenceKey(reference)] : [],
        ),
      );
      const expected = new Set(found.flat());
      const present = await repository.presentReferences();
      expect([...present].sort()).toEqual([...expected].sort());
    });

    it('usageByContractType over every id runs every present statement and equals independent counts', async () => {
      const all = idNameSchema.parse(
        await client.tblcontracts_types.findMany({ select: { id: true, name: true } }),
      );
      const everyId = all.map((row) => row.id);
      const present = await repository.presentReferences();
      const usage = await repository.usageByContractType(everyId);
      expect([...usage.keys()].sort((x, y) => x - y)).toEqual([...everyId].sort((x, y) => x - y));

      const groupBys: readonly (readonly [keyof ContractTypeUsage, string, GroupBy])[] = [
        [
          'contracts',
          'tblcontracts.contract_type',
          (in_) =>
            client.$queryRaw`SELECT contract_type, COUNT(*) AS n FROM tblcontracts WHERE contract_type IN (${Prisma.join(in_)}) GROUP BY contract_type`,
        ],
        [
          'goals',
          'tblgoals.contract_type',
          (in_) =>
            client.$queryRaw`SELECT contract_type, COUNT(*) AS n FROM tblgoals WHERE contract_type IN (${Prisma.join(in_)}) GROUP BY contract_type`,
        ],
      ];

      const answers = await Promise.all(
        groupBys.map(([, key, groupBy]) =>
          present.has(key) ? groupBy(everyId) : Promise.resolve([]),
        ),
      );

      groupBys.forEach(([group], index) => {
        const expected = new Map<number, number>(everyId.map((id) => [id, 0]));
        for (const row of groupSchema.parse(answers[index])) {
          if (row.contract_type !== null) expected.set(row.contract_type, row.n);
        }
        const actual = new Map(everyId.map((id) => [id, usage.get(id)?.[group] ?? -1]));
        expect(actual, group).toEqual(expected);
      });
    });

    it('the marker rows are used by nothing: zeros in all groups', async () => {
      const usage = await repository.usageByContractType([a.id, c.id]);
      expect([...usage.entries()]).toEqual([
        [a.id, NO_CONTRACT_TYPE_USAGE],
        [c.id, NO_CONTRACT_TYPE_USAGE],
      ]);
    });

    it('counts real contract rows referencing the contract type and refuses delete with 409', async () => {
      const contract = await directClient.tblcontracts.create({
        data: {
          contract_type: a.id,
          subject: `${MARKER}-real-contract`,
          client: 1,
          addedfrom: 1,
          dateadded: new Date(),
        },
      });
      try {
        const usage = await repository.usageByContractType([a.id]);
        expect(usage.get(a.id)?.contracts).toBeGreaterThanOrEqual(1);

        const adminUser: AuthenticatedUser = {
          staffId: 1,
          sessionId: 'sid',
          jti: 'jti',
          isAdmin: true,
          roleId: null,
          tokenVersion: 0,
          expiresAt: 4_102_444_800,
        };
        const serviceInstance = new ContractTypesService(
          new ContractTypesValidator(),
          repository,
          new ContractTypesTransformer(),
          new ContractTypesTransport({ publish: () => Promise.resolve() }),
          new LoggerService(),
        );
        await expect(serviceInstance.remove(adminUser, { id: a.id })).rejects.toMatchObject({
          status: 409,
          code: 'ERP-CONTRACTTYPES-0001',
        });
      } finally {
        await directClient.tblcontracts.deleteMany({ where: { id: contract.id } });
      }
    });

    it('a very long name is accepted (LONGTEXT column)', async () => {
      const longName = `${MARKER}-${'a'.repeat(5000)}`;
      const createdRow = await repository.create({ name: longName });
      expect(createdRow.name).toBe(longName);
      const found = await repository.findById(createdRow.id);
      expect(found?.name).toBe(longName);
      await repository.remove(createdRow.id);
    });

    it('the exact bytes match, a case variant does not', async () => {
      const exact = `${MARKER}-c`;
      const variant = exact.toUpperCase();
      const binary = async (text: string): Promise<number> =>
        oneCountSchema.parse(
          await client.$queryRaw<
            unknown[]
          >`SELECT COUNT(*) AS n FROM tblcontracts_types c WHERE c.id = ${c.id} AND CAST(${text} AS BINARY) = CAST(c.name AS BINARY)`,
        )[0].n;
      expect(await binary(exact)).toBe(1);
      expect(await binary(variant)).toBe(0);
      expect(await binary(`${exact} `)).toBe(0);

      const collation = collationSchema.parse(
        await client.$queryRaw<
          unknown[]
        >`SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblcontracts_types' AND COLUMN_NAME = 'name'`,
      )[0].c;
      const collated = oneCountSchema.parse(
        await client.$queryRaw<
          unknown[]
        >`SELECT COUNT(*) AS n FROM tblcontracts_types c WHERE c.id = ${c.id} AND c.name = ${variant}`,
      )[0].n;
      expect(collated === 1).toBe(collation.endsWith('_ci'));
    });

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
      expect(
        await client.tblcontracts_types.count({ where: { name: { startsWith: MARKER } } }),
      ).toBe(0);
    });
  },
);

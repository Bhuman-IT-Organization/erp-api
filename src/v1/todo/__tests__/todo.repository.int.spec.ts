import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { TodoRepository } from '../repository/todo.repository.js';

const MARKER = 'todo-int-spec';
const STAFF_ID = 1;

describe.skipIf(!process.env.DATABASE_URL)('TodoRepository integration', () => {
  const prisma = new PrismaService(new AppConfig(), new HealthService());
  const repository = new TodoRepository(prisma);
  const client = prisma.client;

  const cleanup = () =>
    client.tbltodos.deleteMany({
      where: {
        staffid: STAFF_ID,
        description: { startsWith: MARKER },
      },
    });

  let firstId = 0;
  let secondId = 0;
  let firstDateAdded = new Date();

  beforeAll(async () => {
    await cleanup();

    firstDateAdded = new Date();

    const first = await repository.create({
      staffId: STAFF_ID,
      description: `${MARKER}-first`,
      dateAdded: firstDateAdded,
    });

    const second = await repository.create({
      staffId: STAFF_ID,
      description: `${MARKER}-second`,
      dateAdded: new Date(),
    });

    firstId = first.id;
    secondId = second.id;
  });

  afterAll(async () => {
    await cleanup();
    await client.$disconnect();
  });

  it('creates and finds records belonging to the staff member', async () => {
    const row = await repository.findById(STAFF_ID, firstId);

    expect(row?.id).toBe(firstId);
    expect(row?.description).toBe(`${MARKER}-first`);
    expect(await repository.findById(STAFF_ID + 1, firstId)).toBeNull();
  });

  it('stores dateadded with the supplied wall-clock timestamp', async () => {
    const stored = await client.tbltodos.findFirst({
      where: {
        todoid: firstId,
        staffid: STAFF_ID,
      },
      select: {
        dateadded: true,
      },
    });

    expect(stored).not.toBeNull();
    expect(stored?.dateadded.getTime()).toBe(Math.round(firstDateAdded.getTime() / 1000) * 1000);
  });

  it('lists unfinished marker records for the staff member', async () => {
    const page = await repository.list(STAFF_ID, {
      status: 'unfinished',
      limit: 25,
      cursor: null,
    });

    const markerIds = page.items
      .filter((row) => row.description.startsWith(MARKER))
      .map((row) => row.id);

    expect(markerIds).toContain(firstId);
    expect(markerIds).toContain(secondId);
    expect(page.total).toBeGreaterThanOrEqual(2);
  });

  it('updates the description', async () => {
    const updated = await repository.updateDescription(STAFF_ID, firstId, `${MARKER}-updated`);

    expect(updated?.description).toBe(`${MARKER}-updated`);
  });

  it('finishes and reopens a todo', async () => {
    const finished = await repository.setFinished(STAFF_ID, firstId, true, new Date());

    expect(finished?.finished).toBe(true);

    const reopened = await repository.setFinished(STAFF_ID, firstId, false, null);

    expect(reopened?.finished).toBe(false);
    expect(reopened?.dateFinished).toBeNull();
  });

  it('counts unfinished records and deletes only the requested record', async () => {
    expect(await repository.countUnfinished(STAFF_ID)).toBeGreaterThanOrEqual(2);

    expect(await repository.remove(STAFF_ID, secondId)).toBe(true);
    expect(await repository.findById(STAFF_ID, secondId)).toBeNull();
    expect(await repository.remove(STAFF_ID, secondId)).toBe(false);
  });
});

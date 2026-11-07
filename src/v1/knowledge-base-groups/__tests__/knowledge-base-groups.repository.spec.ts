import { describe, expect, it } from 'vitest';
import { KnowledgeBaseGroupsRepository } from '../repository/knowledge-base-groups.repository.js';

type ClientHolder = ConstructorParameters<typeof KnowledgeBaseGroupsRepository>[0];

function createStubClient() {
  const calls: { method: string; args: unknown }[] = [];

  const client = {
    tblknowledge_base_groups: {
      findMany: (args: unknown) => {
        calls.push({ method: 'groups.findMany', args });
        return Promise.resolve([
          {
            groupid: 1,
            name: 'General',
            group_slug: 'general',
            description: null,
            active: 1,
            color: '#03a9f4',
            group_order: null, // Test NULL group_order mapped to 0
          },
        ]);
      },
      findUnique: (args: unknown) => {
        calls.push({ method: 'groups.findUnique', args });
        return Promise.resolve({
          groupid: 1,
          name: 'General',
          group_slug: 'general',
          description: null,
          active: 1,
          color: '#03a9f4',
          group_order: null,
        });
      },
      count: (args: unknown) => {
        calls.push({ method: 'groups.count', args });
        return Promise.resolve(1);
      },
      create: (args: unknown) => {
        calls.push({ method: 'groups.create', args });
        return Promise.resolve({
          groupid: 2,
          name: 'Billing',
          group_slug: 'billing',
          description: null,
          active: 1,
          color: '#28B8DA',
          group_order: 2,
        });
      },
      update: (args: unknown) => {
        calls.push({ method: 'groups.update', args });
        return Promise.resolve({
          groupid: 1,
          name: 'Updated General',
          group_slug: 'general',
          description: null,
          active: 1,
          color: '#03a9f4',
          group_order: 1,
        });
      },
      delete: (args: unknown) => {
        calls.push({ method: 'groups.delete', args });
        return Promise.resolve({ groupid: 1 });
      },
    },
    tblknowledge_base: {
      groupBy: (args: unknown) => {
        calls.push({ method: 'articles.groupBy', args });
        return Promise.resolve([{ articlegroup: 1, _count: { _all: 3 } }]);
      },
      count: (args: unknown) => {
        calls.push({ method: 'articles.count', args });
        return Promise.resolve(3);
      },
    },
  };

  const prisma = { client } as unknown as ClientHolder;
  const repository = new KnowledgeBaseGroupsRepository(prisma);

  return { repository, calls };
}

describe('KnowledgeBaseGroupsRepository', () => {
  it('list queries groups, treats null group_order as 0, and executes single groupBy for article counts', async () => {
    const { repository, calls } = createStubClient();

    const page = await repository.list();
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.group_order).toBe(0);
    expect(page.items[0]?.totalArticles).toBe(3);

    const methods = calls.map((c) => c.method);
    expect(methods).toContain('groups.findMany');
    expect(methods).toContain('articles.groupBy');
    expect(methods).toContain('groups.count');
  });

  it('findById fetches group, maps null group_order to 0, and article count', async () => {
    const { repository, calls } = createStubClient();

    const row = await repository.findById(1);
    expect(row?.groupid).toBe(1);
    expect(row?.group_order).toBe(0);
    expect(row?.totalArticles).toBe(3);

    const methods = calls.map((c) => c.method);
    expect(methods).toEqual(['groups.findUnique', 'articles.count']);
  });

  it('create inserts into tblknowledge_base_groups', async () => {
    const { repository, calls } = createStubClient();

    const row = await repository.create({
      name: 'Billing',
      group_slug: 'billing',
      description: null,
      active: 1,
      color: '#28B8DA',
      group_order: 2,
    });
    expect(row.groupid).toBe(2);

    const createCall = calls.find((c) => c.method === 'groups.create');
    expect(createCall).toBeDefined();
    expect(createCall?.args).toMatchObject({
      data: {
        name: 'Billing',
        group_slug: 'billing',
        active: 1,
      },
    });
  });

  it('update modifies group fields and returns totalArticles', async () => {
    const { repository } = createStubClient();

    const updated = await repository.update(1, { name: 'Updated General' });
    expect(updated?.name).toBe('Updated General');
    expect(updated?.totalArticles).toBe(3);
  });

  it('remove deletes group record', async () => {
    const { repository } = createStubClient();

    const result = await repository.remove(1);
    expect(result).toBe(true);
  });

  it('existsBySlug and count delegate to Prisma count', async () => {
    const { repository } = createStubClient();
    expect(await repository.existsBySlug('general')).toBe(true);
    expect(await repository.count()).toBe(1);
  });
});

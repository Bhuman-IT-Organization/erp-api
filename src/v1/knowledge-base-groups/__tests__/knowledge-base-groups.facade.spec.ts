import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KnowledgeBaseGroupsFacade } from '../facade/knowledge-base-groups.facade.js';
import {
  createKnowledgeBaseGroupsTestApp,
  type KnowledgeBaseGroupsTestApp,
} from './create-knowledge-base-groups-test-app.js';

describe('KnowledgeBaseGroupsFacade', () => {
  let ctx: KnowledgeBaseGroupsTestApp;
  let facade: KnowledgeBaseGroupsFacade;

  beforeAll(async () => {
    ctx = await createKnowledgeBaseGroupsTestApp();
    facade = ctx.moduleRef.get(KnowledgeBaseGroupsFacade);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('describes the module', () => {
    expect(facade.describe()).toEqual({ module: 'knowledge-base-groups', version: 1 });
  });

  it('listAll answers groups', async () => {
    const list = await facade.listAll();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toHaveProperty('id');
    expect(list[0]).toHaveProperty('name');
  });

  it('findByIds answers groups with given ids', async () => {
    const groups = await facade.findByIds([1, 2, 999]);
    expect(groups.map((g) => g.id)).toEqual([1, 2]);
  });

  it('findById answers group or null when missing', async () => {
    expect(await facade.findById(1)).toMatchObject({ id: 1, name: 'General' });
    expect(await facade.findById(999)).toBeNull();
  });
});

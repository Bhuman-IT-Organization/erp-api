/**
 * KnowledgeBaseFacade through the module: the read-only lookups the purchase, expenses and
 * fixed_equipment migrations will read. `listAll` is the name ascending, then the id (the order
 * Perfex's pickers read); `findByIds` answers the ids in the order given, each once, absent ids
 * skipped; `findById` answers `null` when absent. Each answers `KnowledgeBase { id, name }`, never the
 * wire DTO, and none asserts the administrator flag: it is a module-to-module read with no actor.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { KnowledgeBaseFacade } from '../facade/knowledge-base.facade.js';
import {
  createKnowledgeBaseTestApp,
  type KnowledgeBaseTestApp,
} from './create-knowledge-base-test-app.js';

describe('KnowledgeBaseFacade', () => {
  let ctx: KnowledgeBaseTestApp;
  let facade: KnowledgeBaseFacade;

  beforeAll(async () => {
    ctx = await createKnowledgeBaseTestApp();
    facade = ctx.moduleRef.get(KnowledgeBaseFacade);
    // Ids 4 to 9: `Head Office` a third time, so the id breaks the tie among three.
    for (const name of ['Four', 'Five', 'Head Office', 'Seven', 'Eight', 'Nine']) {
      await ctx.repo.create({ name, createdBy: 1, datecreated: new Date(0) });
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module with every layer injected and describes the module', () => {
    expect(facade.describe()).toEqual({ module: 'knowledge-base', version: 1 });
  });

  it('listAll answers every knowledge base, the name ascending, then the id (equal names by id)', async () => {
    expect((await facade.listAll()).map((center) => [center.id, center.name])).toEqual([
      [8, 'Eight'],
      [5, 'Five'],
      [4, 'Four'],
      [1, 'Head Office'],
      [3, 'Head Office'],
      [6, 'Head Office'],
      [9, 'Nine'],
      [7, 'Seven'],
      [2, 'Warehouse'],
    ]);
  });

  it('findByIds([9, 7, 404, 7]) answers 9 then 7, once each, the absent id skipped', async () => {
    expect(await facade.findByIds([9, 7, 404, 7])).toEqual([
      { id: 9, name: 'Nine' },
      { id: 7, name: 'Seven' },
    ]);
  });

  it('findById answers { id, name } (never the wire DTO, never created_by), or null when absent', async () => {
    expect(await facade.findById(2)).toEqual({ id: 2, name: 'Warehouse' });
    expect(await facade.findById(404)).toBeNull();
  });
});

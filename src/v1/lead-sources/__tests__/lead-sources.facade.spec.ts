import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LeadSourcesFacade } from '../facade/lead-sources.facade.js';
import {
  createLeadSourcesTestApp,
  type LeadSourcesTestApp,
} from './create-lead-sources-test-app.js';

describe('LeadSourcesFacade', () => {
  let context: LeadSourcesTestApp;
  let facade: LeadSourcesFacade;

  beforeAll(async () => {
    context = await createLeadSourcesTestApp();
    facade = context.moduleRef.get(LeadSourcesFacade);
  });
  afterAll(async () => {
    await context.close();
  });

  it('resolves through the module and describes its version', () => {
    expect(facade.describe()).toEqual({ module: 'lead-sources', version: 1 });
  });

  it('lists names ascending, with ids breaking ties', async () => {
    expect((await facade.listAll()).map((source) => [source.id, source.name])).toEqual([
      [2, 'Referral'],
      [1, 'Website'],
      [3, 'Website'],
    ]);
  });

  it('findByIds returns each found id once in the supplied order', async () => {
    expect(await facade.findByIds([3, 1, 404, 3])).toEqual([
      { id: 3, name: 'Website' },
      { id: 1, name: 'Website' },
    ]);
  });

  it('findById returns the facade shape or null when absent', async () => {
    expect(await facade.findById(2)).toEqual({ id: 2, name: 'Referral' });
    expect(await facade.findById(404)).toBeNull();
  });

  it('does not require an actor for its module-to-module reads', () => {
    const methods = LeadSourcesFacade.prototype as unknown as Record<string, unknown>;
    for (const [name, arity] of [
      ['findById', 1],
      ['listAll', 0],
      ['findByIds', 1],
    ] as const) {
      const method = methods[name];
      expect(typeof method, name).toBe('function');
      if (typeof method !== 'function') continue;
      expect(String(method), name).not.toContain('assertAdministrator');
      expect(method.length, name).toBe(arity);
    }
  });
});

import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExampleItemFacade } from '../facade/example-item.facade.js';
import {
  createExampleItemTestApp,
  type ExampleItemTestApp,
} from './create-example-item-test-app.js';

describe('ExampleItemFacade', () => {
  let ctx: ExampleItemTestApp;

  beforeAll(async () => {
    ctx = await createExampleItemTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module with every layer injected and describes the module', () => {
    expect(ctx.moduleRef.get(ExampleItemFacade).describe()).toEqual({
      module: 'example-item',
      version: 1,
    });
  });

  it('findById answers the model (never the wire DTO) whoever owns it, or null', async () => {
    const facade = ctx.moduleRef.get(ExampleItemFacade);
    expect(await facade.findById(2)).toEqual({
      id: 2,
      name: 'Second',
      ownerStaffId: 3,
      createdAt: '2026-01-02T00:00:00.000Z',
      internalRef: 'ref-2',
    });
    expect(await facade.findById(404)).toBeNull();
  });
});

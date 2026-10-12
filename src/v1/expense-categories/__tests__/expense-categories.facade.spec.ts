import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ExpenseCategoriesFacade } from '../facade/expense-categories.facade.js';
import {
  createExpenseCategoriesTestApp,
  type ExpenseCategoriesTestApp,
} from './create-expense-categories-test-app.js';

describe('ExpenseCategoriesFacade', () => {
  let ctx: ExpenseCategoriesTestApp;

  beforeAll(async () => {
    ctx = await createExpenseCategoriesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module with every layer injected and describes the module', () => {
    expect(ctx.moduleRef.get(ExpenseCategoriesFacade).describe()).toEqual({
      module: 'expense-categories',
      version: 1,
    });
  });

  it('findById answers the model in its stored form (never the wire DTO), or null', async () => {
    const facade = ctx.moduleRef.get(ExpenseCategoriesFacade);
    expect(await facade.findById(2)).toEqual({
      id: 2,
      name: 'Second',
      description: 'Line one<br />\nline two',
    });
    expect(await facade.findById(404)).toBeNull();
  });
});

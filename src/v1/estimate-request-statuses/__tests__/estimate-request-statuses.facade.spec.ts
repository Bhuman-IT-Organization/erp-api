import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EstimateRequestStatusesFacade } from '../facade/estimate-request-statuses.facade.js';
import {
  createEstimateRequestStatusesTestApp,
  type EstimateRequestStatusesTestApp,
} from './create-estimate-request-statuses-test-app.js';

describe('EstimateRequestStatusesFacade', () => {
  let ctx: EstimateRequestStatusesTestApp;
  let facade: EstimateRequestStatusesFacade;

  beforeAll(async () => {
    ctx = await createEstimateRequestStatusesTestApp();
    facade = ctx.moduleRef.get(EstimateRequestStatusesFacade);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module and describes the module', () => {
    expect(facade.describe()).toEqual({ module: 'estimate-request-statuses', version: 1 });
  });

  it('returns all statuses with estimate-request counts in status order', async () => {
    expect((await facade.listAll()).map(({ id, name }) => [id, name])).toEqual([
      [1, 'Open'],
      [2, 'Ready'],
      [3, 'Closed'],
    ]);
  });

  it('returns a stored status or null when absent', async () => {
    await expect(facade.findById(2)).resolves.toMatchObject({ id: 2, name: 'Ready' });
    await expect(facade.findById(404)).resolves.toBeNull();
  });
});

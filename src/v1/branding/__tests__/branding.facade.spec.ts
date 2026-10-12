import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrandingFacade } from '../facade/branding.facade.js';
import { SEED_FORMATS } from './fakes.js';
import { createBrandingTestApp, type BrandingTestApp } from './create-branding-test-app.js';

describe('BrandingFacade', () => {
  let ctx: BrandingTestApp;

  beforeAll(async () => {
    ctx = await createBrandingTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module with every layer injected and answers the model', async () => {
    await expect(ctx.moduleRef.get(BrandingFacade).current()).resolves.toEqual({
      companyName: 'Cube',
      logoFile: 'logo.png',
      logoDarkFile: 'logo-dark.png',
      defaultLocale: 'en',
      formats: SEED_FORMATS,
    });
    expect(ctx.settings.calls).toHaveLength(1);
    expect(ctx.currencies.baseCalls).toBe(1);
  });

  it('hands other modules the model, never the wire DTO', async () => {
    const branding = await ctx.moduleRef.get(BrandingFacade).current();
    expect('logoUrl' in branding).toBe(false);
    expect('theme' in branding).toBe(false);
  });

  it('logoPathOf hands out the path the web uses, or null for no file or an unsafe one', async () => {
    const facade = ctx.moduleRef.get(BrandingFacade);
    const branding = await facade.current();
    expect(facade.logoPathOf({ ...branding, logoFile: 'logo.png' })).toBe(
      '/uploads/company/logo.png',
    );
    expect(facade.logoPathOf({ ...branding, logoFile: null })).toBeNull();
    expect(facade.logoPathOf({ ...branding, logoFile: '../x' })).toBeNull();
  });
});

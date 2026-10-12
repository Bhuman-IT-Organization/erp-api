import { describe, expect, it } from 'vitest';
import { brandingResponseSchema } from '../dto/branding.dto.js';
import { DEFAULT_FORMATS, type Formats } from '../model/branding.model.js';
import { BrandingTransformer, COMPANY_UPLOADS_PATH } from '../service/branding.transformer.js';

describe('BrandingTransformer', () => {
  const transformer = new BrandingTransformer();

  it('builds same-origin upload paths, an empty theme and copies defaultLocale', () => {
    expect(
      transformer.toResponse({
        companyName: 'Cube',
        logoFile: 'x.png',
        logoDarkFile: null,
        defaultLocale: 'ar',
        formats: DEFAULT_FORMATS,
      }),
    ).toEqual({
      companyName: 'Cube',
      logoUrl: `${COMPANY_UPLOADS_PATH}/x.png`,
      logoDarkUrl: null,
      theme: {},
      defaultLocale: 'ar',
      formats: DEFAULT_FORMATS,
    });
  });

  it('passes formats through unchanged and the response parses against brandingResponseSchema', () => {
    const formats: Formats = {
      dateFormat: 'd/m/Y',
      timeFormat: '12',
      thousandSeparator: ' ',
      decimalSeparator: ',',
      decimalPlaces: 2,
      removeDecimalsOnZero: true,
      timeZone: 'Europe/Berlin',
      currency: {
        code: 'EUR',
        symbol: '€',
        placement: 'after',
        thousandSeparator: '.',
        decimalSeparator: ',',
      },
    };
    const dto = transformer.toResponse({
      companyName: 'C',
      logoFile: null,
      logoDarkFile: null,
      defaultLocale: 'en',
      formats,
    });
    expect(dto.formats).toEqual(formats);
    expect(brandingResponseSchema.parse(dto)).toEqual(dto);
  });

  it.each(['../etc/passwd', 'a/b.png', '.hidden', 'sp ace.png', 'http://x/y.png'])(
    'treats an unsafe stored file name as unset: %s',
    (file) => {
      const dto = transformer.toResponse({
        companyName: 'C',
        logoFile: file,
        logoDarkFile: file,
        defaultLocale: 'en',
        formats: DEFAULT_FORMATS,
      });
      expect(dto.logoUrl).toBeNull();
      expect(dto.logoDarkUrl).toBeNull();
    },
  );
});

/**
 * Wire shapes of the branding module. The response is the ONE place the web learns who the
 * deployment is for: one erp-web build serves every customer, and nothing brand-specific (name,
 * logo, later theme tokens) lives in its code.
 */
import { z } from 'zod';
import { CURRENCY_SYMBOL_MAX_LENGTH, PERFEX_DATE_FORMATS } from '../model/branding.model.js';

/**
 * The customer's Perfex date, time, number and currency settings (`Formats` in the model, D-33,
 * D-44). The service has already parsed every field fail-closed; this re-validates the whole object
 * before it leaves (threat T-3.2-07).
 */
export const formatsSchema = z.object({
  dateFormat: z.enum(PERFEX_DATE_FORMATS),
  timeFormat: z.enum(['24', '12']),
  thousandSeparator: z.string().max(1),
  decimalSeparator: z.string().length(1),
  decimalPlaces: z.literal(2),
  removeDecimalsOnZero: z.boolean(),
  timeZone: z.string().nullable(),
  currency: z
    .object({
      code: z.string().regex(/^[A-Z]{3}$/),
      symbol: z.string().min(1).max(CURRENCY_SYMBOL_MAX_LENGTH),
      placement: z.enum(['before', 'after']),
      thousandSeparator: z.string().max(1),
      decimalSeparator: z.string().length(1),
    })
    .nullable(),
});

/**
 * `GET /api/v1/branding`. Logo URLs are same-origin paths (never absolute), `null` when the
 * customer has not uploaded one — the client then shows `companyName` as text. `theme` is
 * reserved for the CSS custom-property values a customer can set once the settings module owns
 * them (shadcn tokens on `:root`); until then it is always an empty object.
 */
export const brandingResponseSchema = z.object({
  companyName: z.string().min(1),
  logoUrl: z.string().startsWith('/').nullable(),
  logoDarkUrl: z.string().startsWith('/').nullable(),
  theme: z.record(z.string(), z.string()),
  /** The deployment's locale before anyone is signed in (`tbloptions.active_language` → BCP-47, `en` by default). */
  defaultLocale: z.string(),
  /** How the customer's Perfex renders dates, numbers and money (additive, plan 03.2-02). */
  formats: formatsSchema,
});
export type BrandingResponseDto = z.infer<typeof brandingResponseSchema>;

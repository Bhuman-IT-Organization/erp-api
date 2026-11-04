import { z } from 'zod';
import {
  exportBlankField,
  exportColumnField,
  exportDateFormatField,
  exportFormatField,
  exportHeaderField,
  exportNoField,
  exportTimeFormatField,
  exportTimeZoneField,
  exportTitleField,
  exportYesField,
} from '../../../shared/http/export.js';
import { listPageMetaSchema } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';

/** Perfex's `tblservices.name` is VARCHAR(50). Must equal erp-web's SERVICES_NAME_MAX. */
export const SERVICES_NAME_MAX = 50;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const SERVICES_SEARCH_MAX = 100;

export const listServicesQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  cursor: z.string().min(1).optional(),
  q: z.string().max(SERVICES_SEARCH_MAX).optional(),
  /** `-id` (default), `id`, `name` or `-name`. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection.
 */
export const exportServicesQuerySchema = listServicesQuerySchema
  .omit({ limit: true, cursor: true })
  .extend({
    header: exportHeaderField,
    format: exportFormatField,
    column: exportColumnField,
    title: exportTitleField,
    yes: exportYesField,
    no: exportNoField,
    blank: exportBlankField,
    dateFormat: exportDateFormatField,
    timeFormat: exportTimeFormatField,
    timeZone: exportTimeZoneField,
  });

export const servicesParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const createServicesBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(SERVICES_NAME_MAX),
});
export const updateServicesBodySchema = createServicesBodySchema;

export const servicesResponseSchema = z.object({ id: z.string(), name: z.string() }).readonly();
export const servicesListRowSchema = servicesResponseSchema;

export const servicesListResponseSchema = z
  .object({
    data: z.array(servicesListRowSchema),
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;
export type ServicesParams = z.infer<typeof servicesParamsSchema>;
export type CreateServicesBody = z.infer<typeof createServicesBodySchema>;
export type UpdateServicesBody = z.infer<typeof updateServicesBodySchema>;
export type ServicesResponseDto = z.infer<typeof servicesResponseSchema>;
export type ServicesListRowDto = z.infer<typeof servicesListRowSchema>;
export type ServicesListResponseDto = z.infer<typeof servicesListResponseSchema>;

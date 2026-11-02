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

/** The longest name a body may carry: `tblfe_depreciations.name` is a VARCHAR(200). */
export const FIXED_EQUIPMENT_DEPRECIATIONS_NAME_MAX = 200;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const FIXED_EQUIPMENT_DEPRECIATIONS_SEARCH_MAX = 100;

/** Documentation only: `parseListQuery` in the validator is the gate. */
export const listFixedEquipmentDepreciationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  cursor: z.string().min(1).optional(),
  q: z.string().max(FIXED_EQUIPMENT_DEPRECIATIONS_SEARCH_MAX).optional(),
  /** `-id` (default), `id`, `name` or `-name`. */
  sort: z.string().optional(),
});

/** Documentation only: `parseExportOptions` in `shared/http/export.js` is the gate. */
export const exportFixedEquipmentDepreciationsQuerySchema =
  listFixedEquipmentDepreciationsQuerySchema.omit({ limit: true, cursor: true }).extend({
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

/** `tblfe_depreciations.id` is an unsigned INT: no id is larger. */
export const MAX_UNSIGNED_INT_ID = 4_294_967_295;

export const fixedEquipmentDepreciationsParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(MAX_UNSIGNED_INT_ID),
});

/** Perfex's form: Depreciation Name and Number of Months, both required. */
export const createFixedEquipmentDepreciationsBodySchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(
      FIXED_EQUIPMENT_DEPRECIATIONS_NAME_MAX,
      `Name must be ${String(FIXED_EQUIPMENT_DEPRECIATIONS_NAME_MAX)} characters or less`,
    ),
  term: z
    .number()
    .int('Number of months must be a whole number')
    .positive('Number of months must be greater than 0'),
});

export const updateFixedEquipmentDepreciationsBodySchema =
  createFixedEquipmentDepreciationsBodySchema;

export const fixedEquipmentDepreciationsResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    /** The number of months; `null` on a row Perfex stored without one. */
    term: z.number().nullable(),
  })
  .readonly();

export const fixedEquipmentDepreciationsListResponseSchema = z
  .object({
    data: z.array(fixedEquipmentDepreciationsResponseSchema),
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListFixedEquipmentDepreciationsQuery = z.infer<
  typeof listFixedEquipmentDepreciationsQuerySchema
>;
export type FixedEquipmentDepreciationsParams = z.infer<
  typeof fixedEquipmentDepreciationsParamsSchema
>;
export type CreateFixedEquipmentDepreciationsBody = z.infer<
  typeof createFixedEquipmentDepreciationsBodySchema
>;
export type UpdateFixedEquipmentDepreciationsBody = z.infer<
  typeof updateFixedEquipmentDepreciationsBodySchema
>;
export type FixedEquipmentDepreciationsResponseDto = z.infer<
  typeof fixedEquipmentDepreciationsResponseSchema
>;
export type FixedEquipmentDepreciationsListResponseDto = z.infer<
  typeof fixedEquipmentDepreciationsListResponseSchema
>;

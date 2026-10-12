/**
 * Transformer: entity to response DTO and to the facade's definition. Every DTO is built field by
 * field and parsed through its zod response schema, so nothing the wire shape does not declare can
 * ride along. The controller never imports this class (BE-08).
 *
 * The fingerprint (ADR-0040) covers every field Perfex's form edits (`shownOf`), never the slug
 * (Perfex sets it once) or the value count: it changes when Perfex edits any of those fields, and
 * not when a value is written to some record.
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { etagOf } from '../../../shared/http/etag.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES } from '../custom-fields.routes.js';
import {
  customFieldsListResponseSchema,
  customFieldsResponseSchema,
  type CustomFieldsListResponseDto,
  type CustomFieldsResponseDto,
} from '../dto/custom-fields.dto.js';
import type {
  CustomField,
  CustomFieldDefinition,
  CustomFieldEntity,
  CustomFieldType,
} from '../model/custom-fields.model.js';
import { splitOptions } from './custom-field-values.js';

const ENTITIES: ReadonlySet<string> = new Set(CUSTOM_FIELD_ENTITIES);
const TYPES: ReadonlySet<string> = new Set(CUSTOM_FIELD_TYPES);

function isEntity(value: string): value is CustomFieldEntity {
  return ENTITIES.has(value);
}

function isType(value: string): value is CustomFieldType {
  return TYPES.has(value);
}

/** The fields Perfex's form edits: what the fingerprint covers. */
export function shownOf(row: CustomField): Record<string, unknown> {
  return {
    fieldto: row.fieldto,
    type: row.type,
    name: row.name,
    defaultValue: row.defaultValue,
    options: splitOptions(row.options),
    fieldOrder: row.fieldOrder,
    bsColumn: row.bsColumn,
    disabled: !row.active,
    displayInline: row.displayInline,
    onlyAdmin: row.onlyAdmin,
    disallowCustomerEdit: row.disallowCustomerEdit,
    required: row.required,
    showOnTable: row.showOnTable,
    showOnPdf: row.showOnPdf,
    showOnClientPortal: row.showOnClientPortal,
    showOnTicketForm: row.showOnTicketForm,
  };
}

/** The record's own fields with its slug, count and fingerprint. */
function recordOf(row: CustomField, valuesCount: number): Record<string, unknown> {
  const shown = shownOf(row);
  return { id: row.id, slug: row.slug, ...shown, valuesCount, etag: etagOf(shown) };
}

@Injectable()
export class CustomFieldsTransformer {
  toResponse(row: CustomField, valuesCount: number): CustomFieldsResponseDto {
    return customFieldsResponseSchema.parse(recordOf(row, valuesCount));
  }

  /** The list envelope: each row with its value count (zero when the map has none). */
  toListResponse(
    rows: readonly CustomField[],
    counts: ReadonlyMap<number, number>,
    meta: ListPageMeta,
  ): CustomFieldsListResponseDto {
    return customFieldsListResponseSchema.parse({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        fieldto: row.fieldto,
        type: row.type,
        slug: row.slug,
        active: row.active,
        fieldOrder: row.fieldOrder,
        valuesCount: counts.get(row.id) ?? 0,
      })),
      meta: {
        nextCursor: meta.nextCursor,
        prevCursor: meta.prevCursor,
        total: meta.total,
        rangeStart: meta.rangeStart,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  }

  /** The facade's definition, or `null` for a stored entity or type Perfex's Setup does not offer. */
  toDefinition(row: CustomField): CustomFieldDefinition | null {
    const { fieldto, type } = row;
    if (!isEntity(fieldto) || !isType(type)) return null;
    return {
      id: row.id,
      fieldto,
      name: row.name,
      slug: row.slug,
      type,
      options: splitOptions(row.options),
      required: row.required,
      defaultValue: row.defaultValue,
      fieldOrder: row.fieldOrder,
      active: row.active,
      onlyAdmin: row.onlyAdmin,
      showOnTable: row.showOnTable,
      displayInline: row.displayInline,
    };
  }
}

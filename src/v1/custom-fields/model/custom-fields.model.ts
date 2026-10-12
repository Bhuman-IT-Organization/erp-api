/**
 * Domain entity types of the module; nothing here is a DTO. A `CustomField` is one `tblcustomfields`
 * row in its stored form with Perfex's tinyint flags read as booleans (`active` is the column; the
 * form's `disabled` is its negation) and `options` as Perfex stores them, comma-joined. A value is
 * one `tblcustomfieldsvalues` row: `(relid, fieldid, fieldto, value)`, the value in the stored form
 * `handle_custom_fields_post` writes. Both tables are Perfex's; this module only reads them.
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';
import type { CUSTOM_FIELD_ENTITIES, CUSTOM_FIELD_TYPES } from '../custom-fields.routes.js';

/** A `fieldto` Perfex's Setup offers (22, R8). */
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

/** A field type of Perfex's type select. */
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/** One stored field. `fieldto` and `type` stay strings: a co-writer may have stored any text. */
export interface CustomField {
  readonly id: number;
  readonly fieldto: string;
  readonly name: string;
  readonly slug: string;
  readonly type: string;
  /** Comma-joined, as Perfex stores them; `''` when none. */
  readonly options: string;
  readonly defaultValue: string | null;
  readonly fieldOrder: number;
  readonly bsColumn: number;
  readonly active: boolean;
  readonly required: boolean;
  readonly displayInline: boolean;
  readonly onlyAdmin: boolean;
  readonly disallowCustomerEdit: boolean;
  readonly showOnTable: boolean;
  readonly showOnPdf: boolean;
  readonly showOnClientPortal: boolean;
  readonly showOnTicketForm: boolean;
}

/** The columns `?sort=` accepts. `fieldto` and `fieldOrder` are nullable columns (NULL sorts first ascending). */
export type CustomFieldsSortField = 'id' | 'name' | 'fieldto' | 'type' | 'fieldOrder';

/** One checked list request: `?q`, the `fieldto` filter, the one sort, the cursor decoded for it, the page size. */
export interface CustomFieldsListRequest {
  readonly search: string | null;
  readonly fieldto: readonly string[] | null;
  readonly sortField: CustomFieldsSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<CustomFieldsSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface CustomFieldsPage extends ListPageMeta {
  readonly items: readonly CustomField[];
}

/** One stored value row. */
export interface StoredCustomFieldValue {
  readonly relId: number;
  readonly fieldId: number;
  readonly value: string;
}

/** A value on the wire: checkbox and multiselect are arrays, every other type a string. */
export type CustomFieldValue = string | readonly string[];

/** What other modules read of a field (the facade's answer). */
export interface CustomFieldDefinition {
  readonly id: number;
  readonly fieldto: CustomFieldEntity;
  readonly name: string;
  readonly slug: string;
  readonly type: CustomFieldType;
  readonly options: readonly string[];
  readonly required: boolean;
  readonly defaultValue: string | null;
  readonly fieldOrder: number;
  readonly active: boolean;
  readonly onlyAdmin: boolean;
  readonly showOnTable: boolean;
  readonly displayInline: boolean;
}

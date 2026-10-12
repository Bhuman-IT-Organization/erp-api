/**
 * The custom-field values read codec and the options column, as Perfex stores them
 * (`custom_fields_helper.php`, `Custom_fields_model`):
 *
 * - `options` is one comma-joined column; `splitOptions` answers its chips;
 * - a stored value is answered for the wire by `fromStoredValue`: a textarea without the `<br />`
 *   tags `nl2br` added (`clear_textarea_breaks`), a checkbox or multiselect split into its options,
 *   everything else as stored.
 *
 * Read only: Perfex's `handle_custom_fields_post` is the only writer of the values.
 */
import type { CustomFieldValue } from '../model/custom-fields.model.js';

/** The three tags `clear_textarea_breaks` removes, in any letter case. */
const BREAK_TAG = /<br(?: ?\/)?>/gi;
const MULTI_TYPES: ReadonlySet<string> = new Set(['checkbox', 'multiselect']);
/** How Perfex joins the options column, and how a stored multi value is split again. */
const OPTIONS_SEPARATOR = ',';

/** The options column split into chips: trimmed, empty ones dropped. */
export function splitOptions(stored: string | null): string[] {
  if (stored === null) return [];
  return stored
    .split(OPTIONS_SEPARATOR)
    .map((option) => option.trim())
    .filter((option) => option !== '');
}

/** A stored value for the wire: a textarea without its break tags, a multi value split. */
export function fromStoredValue(type: string, stored: string): CustomFieldValue {
  if (MULTI_TYPES.has(type)) return splitOptions(stored);
  if (type === 'textarea') return stored.replace(BREAK_TAG, '');
  return stored;
}

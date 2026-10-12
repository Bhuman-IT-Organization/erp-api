/**
 * Route constants: the single source for this module's paths, the entities and types Perfex's Setup
 * offers, and the export columns, used by the controller, the validator and the tests. Relative to
 * the global prefix `api/v1`. Read routes only: this copy has no Node Custom Fields screen and no
 * write route; Perfex's Setup > Custom Fields page stays the screen and the only writer. `export` is
 * a static segment, so find-my-way serves it before `:id` whatever the declaration order; the
 * controller still declares it first.
 */
export const CUSTOM_FIELDS_ROUTES = {
  base: 'custom-fields',
  list: '',
  export: 'export',
  record: ':id',
} as const;

// No permission constant: the module is administrators only (D-04; Perfex's controller is
// `is_admin()` only). Its handlers declare no code and the service asserts the administrator flag.

/**
 * Every `fieldto` Perfex's Setup offers, in the order of its select (R8): core's fifteen
 * (`customfield.php`), purchase's four and warehouse's three (each module's hook).
 */
export const CUSTOM_FIELD_ENTITIES = [
  'company',
  'leads',
  'customers',
  'contacts',
  'staff',
  'contracts',
  'tasks',
  'expenses',
  'invoice',
  'items',
  'credit_note',
  'estimate',
  'proposal',
  'projects',
  'tickets',
  'vendors',
  'pur_order',
  'vendor_contacts',
  'pur_invoice',
  'warehouse_name',
  'iv_delivery',
  'iv_packing_list',
] as const;

/** The field types of Perfex's type select, in its order. */
export const CUSTOM_FIELD_TYPES = [
  'input',
  'number',
  'textarea',
  'select',
  'multiselect',
  'checkbox',
  'date_picker',
  'date_picker_time',
  'colorpicker',
  'link',
] as const;

/**
 * The export's columns, in order (D-42: one `header` label each; D-13: `column` picks a subset).
 * Every column is text except `active`, a yes/no cell.
 */
export const CUSTOM_FIELDS_EXPORT_COLUMNS = [
  'id',
  'name',
  'fieldto',
  'type',
  'slug',
  'active',
] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const CUSTOM_FIELDS_EXPORT_FILE_STEM = 'custom-fields';

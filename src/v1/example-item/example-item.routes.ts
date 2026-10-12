/**
 * Route constants: the single source for this module's paths, permission codes and export columns,
 * used by the controller, the validator, the tests and erp-web's endpoint table (the frontend
 * template's `EXAMPLE_ITEM_ENDPOINTS`).
 * Relative to the global prefix `api/v1`. `export` is a static segment, so find-my-way serves it
 * before `:id` whatever the declaration order; the controller still declares it first.
 */
export const EXAMPLE_ITEM_ROUTES = {
  base: 'example-item',
  list: '',
  export: 'export',
  record: ':id',
} as const;

/**
 * Clean ADR-0033 names: our own `module.resource.action`, never a Perfex code. These are the
 * module's OWN names, in no `@erp/contracts` catalogue and in no Perfex mapping, so no member's
 * stored rows can translate into them: only an administrator holds them (ADR-0033 decision 4, the
 * guard's admin-implies-every-code rule). That is the same fail-closed default as the `ADMIN_GATE`
 * of erp-docs `05-templates/frontend-feature` in erp-web's `ROUTE_GATES`, and both flip together
 * when the module's codes are declared in `@erp/contracts` (with the Perfex mapping) and imported here.
 *
 * `view` is the full-view code and `viewOwn` the narrowed one (ADR-0033 decision 5); the reads
 * declare them with `@PermissionsAny(view, viewOwn)`, widest first, because the guard reads index 0
 * as the full-view code when it resolves the row scope. `create` and `edit` gate the two writes.
 */
export const EXAMPLE_ITEM_PERMISSIONS = {
  view: 'example-item.view',
  viewOwn: 'example-item.viewOwn',
  create: 'example-item.create',
  edit: 'example-item.edit',
} as const;

/**
 * The export's columns, in order: the response DTO's fields (D-42: one `header` label each; D-13:
 * `column` picks a subset). `createdAt` is ISO in CSV and Excel and the reader's date format in PDF
 * and Print; the other three are text in every format.
 */
export const EXAMPLE_ITEM_EXPORT_COLUMNS = ['id', 'name', 'label', 'createdAt'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const EXAMPLE_ITEM_EXPORT_FILE_STEM = 'example-item';

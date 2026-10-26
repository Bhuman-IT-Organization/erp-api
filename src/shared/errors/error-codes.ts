/**
 * The error-code catalog: every `AppError` names one of these, and the problem-details body
 * carries the code so erp-web and the runbooks can match on it.
 * Codes are stable; titles are generic on purpose (never leak which check failed).
 */
export const ERROR_CODES = {
  'ERP-VALIDATION-0001': { status: 400, title: 'Request body is invalid' },
  'ERP-AUTH-0001': { status: 401, title: 'Invalid credentials' }, // also inactive accounts (generic on purpose)
  'ERP-AUTH-0002': { status: 401, title: 'Refresh token missing, invalid or expired' },
  'ERP-AUTH-0003': { status: 401, title: 'Refresh token reuse detected; session family revoked' },
  'ERP-AUTH-0004': { status: 401, title: 'Access token invalid, expired or revoked' },
  'ERP-AUTH-0005': { status: 403, title: 'Permission missing' },
  'ERP-AUTH-0006': { status: 429, title: 'Too many failed attempts; account temporarily locked' },
  'ERP-AUTH-0007': { status: 403, title: 'Two-factor account: use the legacy login' },
  'ERP-AUTH-0008': { status: 403, title: 'CSRF token missing or invalid' },
  // The generated module's detail and update: a missing row and a row the caller may not read get
  // the same 404, so an id reveals nothing. A module that owns real data adds its own codes (BE-09).
  'ERP-CORE-0004': { status: 404, title: 'Resource not found' },
  // Reserved (BE-15): thrown by the IdempotencyInterceptor once the first keyed POST builds it;
  // listed now so the code is stable before its first use.
  'ERP-CORE-0010': { status: 400, title: 'Idempotency-Key header is required' },
  'ERP-CORE-0011': {
    status: 409,
    title: 'A request with this Idempotency-Key is still in progress',
  },
  'ERP-CORE-0012': { status: 422, title: 'Idempotency-Key reused with a different request' },
  // ADR-0040 (plan 04.2-02): a write that names the version it read. 0013 is a stale If-Match (a batch lists the stale ids in issues), 0014 an opted-in PATCH or PUT without one.
  'ERP-CORE-0013': { status: 412, title: 'The record changed since it was read' },
  'ERP-CORE-0014': { status: 428, title: 'If-Match header is required' },
  // v1/identity (ADR-0034). 0001 is the granting gate: granting is admin-only and is never gated
  // by a permission code, because a code can be handed out by the mechanism it protects.
  'ERP-IDENTITY-0001': { status: 403, title: 'Granting requires the administrator flag' },
  'ERP-IDENTITY-0002': { status: 409, title: 'E-mail already in use by another staff member' },
  'ERP-IDENTITY-0003': { status: 422, title: 'Unknown permission name' },
  // The non-granting administrator-only rules of the identity-access brief §5: staff id 1 keeps
  // admin, nobody removes their own admin, a non-admin cannot change an admin's password or
  // status, nobody deactivates themselves. Generic on purpose (never leak which check failed).
  'ERP-IDENTITY-0004': { status: 403, title: 'Refused by an administrator-only identity rule' },
  'ERP-IDENTITY-0005': { status: 404, title: 'Staff member not found' },
  // The role half (plan 03.1-11). 0006 is the referenced-role refusal: a role a staff member still
  // points at is never deleted, so no member is left holding a role that does not exist. The
  // plan's `<interfaces>` block called it 0004; that number was taken by the administrator-only
  // rules in plan 03.1-12, and a code is never reused.
  'ERP-IDENTITY-0006': { status: 409, title: 'The role is still referenced by a staff member' },
  'ERP-IDENTITY-0007': { status: 409, title: 'Role name already in use' },
  'ERP-IDENTITY-0008': { status: 404, title: 'Role not found' },
  // A member save naming a department id that does not exist (plan 04.1-33, D-55).
  'ERP-IDENTITY-0009': { status: 422, title: 'Unknown department' },
  // v1/expense-categories (plan 04.1-03): 0001 refuses a delete while anything still uses the category.
  'ERP-EXPENSECATEGORIES-0001': { status: 409, title: 'The expense category is still in use' },

  // v1/lead-sources (plan 04.1-04): 0001 refuses a delete while any lead still points at the source.
  'ERP-LEADSOURCES-0001': { status: 409, title: 'Lead source is still in use' },

  // v1/taxes (plan 04.1-11): in use (0001), Perfex's locked edit (0002), a duplicate name (0003), a default tax in Settings (0004, D-21).
  'ERP-TAXES-0001': { status: 409, title: 'The tax is still in use' },
  'ERP-TAXES-0002': {
    status: 409,
    title: 'The tax is used by an expense or a subscription and cannot be changed',
  },
  'ERP-TAXES-0003': { status: 409, title: 'A tax with that name already exists' },
  'ERP-TAXES-0004': { status: 409, title: 'The tax is a default tax in Settings' },
  // v1/cost-centers (plan 04.1-18): 0001 refuses a delete while any referencing column still names the cost center (D-07, D-28).
  'ERP-COSTCENTERS-0001': { status: 409, title: 'The cost center is still in use' },
  // v1/payment-modes (plan 04.1-23): 0001 refuses a delete while a transactional column still names the mode (D-33), 0002 the credit expense mode (D-37).
  'ERP-PAYMENTMODES-0001': { status: 409, title: 'The payment mode is still in use' },
  'ERP-PAYMENTMODES-0002': { status: 409, title: 'The payment mode is the credit expense mode' },
  // v1/currencies (plan 04.1-28): 0001 a delete while a delete-counting reference holds the currency (D-40), 0002 the base (Perfex), 0003 a registered use (D-41), 0004 a base change while the base has transactions (D-39), 0005 a code change while in use (D-42).
  'ERP-CURRENCIES-0001': { status: 409, title: 'The currency is still in use' },
  'ERP-CURRENCIES-0002': { status: 409, title: 'The currency is the base currency' },
  'ERP-CURRENCIES-0003': { status: 409, title: 'The currency is used by another module' },
  'ERP-CURRENCIES-0004': { status: 409, title: 'The base currency has transactions' },
  'ERP-CURRENCIES-0005': {
    status: 409,
    title: 'The currency code cannot change while the currency is in use',
  },
  // v1/mail (plan 04.3-07). ERP-MAIL-0001 and ERP-MAIL-0003 are web copy keys only, never thrown: an unknown merge field
  // is the `unknown_merge_field` rule inside ERP-VALIDATION-0001 and a stale save is ERP-CORE-0013 (ADR-0040).
  'ERP-MAIL-0002': { status: 409, title: 'Email is not configured' },
  'ERP-MAIL-0004': { status: 409, title: 'The email template is switched off' },
  'ERP-MAIL-0005': { status: 409, title: 'The record the email was about no longer exists' },
  'ERP-MAIL-0006': { status: 409, title: 'The email is still waiting to be sent' },
  'ERP-MAIL-0007': { status: 429, title: 'Too many test emails' },
  'ERP-MAIL-0008': { status: 409, title: 'A test email cannot be resent' },
  // shared/uploads (plan 04.2-02, ADR-0041).
  'ERP-FILES-0001': { status: 422, title: 'File type not allowed' },
  'ERP-FILES-0002': { status: 413, title: 'File too large' },
  'ERP-UPSTREAM-0001': { status: 503, title: 'An upstream system is unavailable' }, // ADR-0031 §7 load shedding
  'ERP-INTERNAL-0001': { status: 500, title: 'Internal error' },
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

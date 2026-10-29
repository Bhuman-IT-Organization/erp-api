/**
 * Domain model: the `tbloptions` names other modules may read through the settings facade, spelled
 * exactly as Perfex stores each one.
 *
 * D-22: branding's 10, plus 04.1 D-37's credit-expense payment mode and Ticket Statuses' default
 * ticket-reply status: 12. No name of a credential is on the list, so the facade can never hand one
 * out by accident.
 */
export const SETTINGS_ALLOW_LIST = Object.freeze([
  // branding (BRANDING_OPTION_NAMES)
  'companyname',
  'company_logo',
  'company_logo_dark',
  'active_language',
  'dateformat',
  'time_format',
  'thousand_separator',
  'decimal_separator',
  'remove_decimals_on_zero',
  'default_timezone',
  'leads_default_source',
  // payment modes (04.1 D-37): the credit-expense mode the client's expense code reads
  'expense_credit_payment_mode',
  // Ticket Statuses: configured default ticket-reply status
  'default_ticket_reply_status',
] as const);

/** A name on the allow-list; any other string is a compile-time error at the facade. */
export type SettingName = (typeof SETTINGS_ALLOW_LIST)[number];

const ALLOWED: ReadonlySet<string> = new Set(SETTINGS_ALLOW_LIST);

/** True only for a name on the allow-list, compared exactly (letter case included). */
export function isSettingName(name: string): name is SettingName {
  return ALLOWED.has(name);
}

/** A `tbloptions` row as the repository reads it: the name and its raw text value. */
export interface SettingRow {
  readonly name: string;
  readonly value: string;
}

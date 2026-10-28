/**
 * SettingsService on the in-memory repository: the allow-list (D-22) refused before any read, every
 * requested name a key (`null` when absent, `''` kept), one read per call over the unique names,
 * exact-name matching, Perfex's trailing-space name, and the duplicate rule (the highest id wins).
 * Every value here is synthetic.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { isSettingName, SETTINGS_ALLOW_LIST, type SettingRow } from '../model/settings.model.js';
import { SettingsService } from '../service/settings.service.js';
import { asRepository, InMemorySettingsRepository } from './fakes.js';

/** D-22 written out: branding's 10. */
const D22_NAMES = [
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
];

/** D-37 (04.1): the credit-expense mode the client's expense code reads (payment modes, plan 04.1-23). */
const D37_NAMES = ['expense_credit_payment_mode'];
const LEAD_SOURCES_NAMES = ['leads_default_source'];

function serviceWith(rows: SettingRow[] = []) {
  const repository = new InMemorySettingsRepository(rows);
  return { service: new SettingsService(asRepository(repository)), repository };
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError rejection');
  return error;
}

describe('SETTINGS_ALLOW_LIST (D-22, D-37, lead sources)', () => {
  it('holds the names of D-22, D-37 and lead sources, each once, frozen', () => {
    const expected = [...D22_NAMES, ...D37_NAMES, ...LEAD_SOURCES_NAMES];
    expect(expected).toHaveLength(12);
    expect(SETTINGS_ALLOW_LIST).toHaveLength(expected.length);
    expect(new Set(SETTINGS_ALLOW_LIST).size).toBe(SETTINGS_ALLOW_LIST.length);
    expect([...SETTINGS_ALLOW_LIST].sort()).toEqual(expected.sort());
    expect(Object.isFrozen(SETTINGS_ALLOW_LIST)).toBe(true);
  });

  it('isSettingName answers for the list only, by exact name', () => {
    expect(isSettingName('dateformat')).toBe(true);
    expect(isSettingName('default_tax')).toBe(false);
    expect(isSettingName('Companyname')).toBe(false);
  });
});

describe('SettingsService', () => {
  it("getOption answers the row's value", async () => {
    const { service } = serviceWith([{ name: 'companyname', value: 'Company One' }]);
    await expect(service.getOption('companyname')).resolves.toBe('Company One');
  });

  it("getOption('expense_credit_payment_mode') answers its row's value (D-37)", async () => {
    const { service } = serviceWith([{ name: 'expense_credit_payment_mode', value: '7' }]);
    await expect(service.getOption('expense_credit_payment_mode')).resolves.toBe('7');
  });

  it("getOption('leads_default_source') answers its row's value", async () => {
    const { service } = serviceWith([{ name: 'leads_default_source', value: '7' }]);
    await expect(service.getOption('leads_default_source')).resolves.toBe('7');
  });

  it('an allowed name with no row answers null', async () => {
    const { service } = serviceWith([{ name: 'companyname', value: 'Company One' }]);
    await expect(service.getOption('company_logo')).resolves.toBeNull();
  });

  it("a stored empty string answers ''", async () => {
    const { service } = serviceWith([{ name: 'company_logo_dark', value: '' }]);
    await expect(service.getOption('company_logo_dark')).resolves.toBe('');
  });

  it('getOptions reads once over the unique names and answers exactly those keys, null when absent', async () => {
    const { service, repository } = serviceWith([{ name: 'time_format', value: '24' }]);
    const answer = await service.getOptions(['company_logo', 'time_format', 'company_logo']);
    expect(repository.calls).toEqual([['company_logo', 'time_format']]);
    expect([...answer.entries()]).toEqual([
      ['company_logo', null],
      ['time_format', '24'],
    ]);
  });

  it('a row stored with a trailing space answers the trimmed name', async () => {
    const { service } = serviceWith([{ name: 'default_timezone ', value: 'Asia/Dubai' }]);
    await expect(service.getOption('default_timezone')).resolves.toBe('Asia/Dubai');
  });

  it('the spaced and the plain spelling of a name: the later row (the highest id) wins', async () => {
    const { service } = serviceWith([
      { name: 'default_timezone ', value: 'id-4' },
      { name: 'default_timezone', value: 'id-9' },
    ]);
    await expect(service.getOption('default_timezone')).resolves.toBe('id-9');
  });

  it('two rows of one name: the later row (the highest id) wins', async () => {
    const { service } = serviceWith([
      { name: 'company_logo', value: 'older' },
      { name: 'company_logo', value: 'newer' },
    ]);
    await expect(service.getOption('company_logo')).resolves.toBe('newer');
  });

  it('a row whose name differs only in letter case is ignored and adds no key', async () => {
    const { service } = serviceWith([{ name: 'CompanyName', value: 'Other' }]);
    const answer = await service.getOptions(['companyname']);
    expect([...answer.entries()]).toEqual([['companyname', null]]);
  });

  it('getOptions([]) answers an empty Map without a read', async () => {
    const { service, repository } = serviceWith([{ name: 'companyname', value: 'Company One' }]);
    expect((await service.getOptions([])).size).toBe(0);
    expect(repository.calls).toEqual([]);
  });

  it('refuses a name outside the list with ERP-INTERNAL-0001 before any read, naming no key', async () => {
    const { service, repository } = serviceWith([{ name: 'default_tax', value: 'synthetic' }]);
    // @ts-expect-error: default_tax is not on the allow-list (D-22); the runtime check is under test
    const error = await refusal(service.getOption('default_tax'));
    expect(error.code).toBe('ERP-INTERNAL-0001');
    expect(error.status).toBe(500);
    expect(error.message).not.toContain('default_tax');
    expect(error.message).not.toContain('synthetic');
    expect(repository.calls).toEqual([]);
  });

  it('refuses the whole batch when one name is outside the list', async () => {
    const { service, repository } = serviceWith([{ name: 'companyname', value: 'Company One' }]);
    // @ts-expect-error: default_tax is not on the allow-list (D-22); the runtime check is under test
    const pending = service.getOptions(['companyname', 'default_tax']);
    const error = await refusal(pending);
    expect(error.code).toBe('ERP-INTERNAL-0001');
    expect(error.message).not.toContain('default_tax');
    expect(repository.calls).toEqual([]);
  });
});

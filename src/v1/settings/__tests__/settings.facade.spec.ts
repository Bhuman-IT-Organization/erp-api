/**
 * SettingsFacade through `SettingsModule` (the repository replaced by the in-memory one), and ONE
 * contract run over both the real facade and the shared `FakeSettingsFacade` that branding, cost
 * centers and payment modes inject, so the fake cannot drift from the facade. The prototype holds
 * the two reads and nothing else (D-10).
 * Every value here is synthetic.
 */
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { SettingsFacade } from '../facade/settings.facade.js';
import { SettingsRepository } from '../repository/settings.repository.js';
import { SettingsModule } from '../settings.module.js';
import {
  FakeSettingsFacade,
  InMemorySettingsRepository,
  stubSettingsModule,
  type SettingRow,
} from './fakes.js';

async function facadeOver(rows: SettingRow[]) {
  const repository = new InMemorySettingsRepository(rows);
  const moduleRef = await Test.createTestingModule({ imports: [SettingsModule] })
    .overrideProvider(SettingsRepository)
    .useValue(repository)
    .compile();
  return { facade: moduleRef.get(SettingsFacade), repository };
}

async function refusal(promise: Promise<unknown>): Promise<AppError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof AppError)) throw new Error('expected an AppError rejection');
  return error;
}

describe('SettingsFacade through SettingsModule', () => {
  it('both methods delegate to the service and its one repository read', async () => {
    const { facade, repository } = await facadeOver([
      { name: 'companyname', value: 'Company One' },
      { name: 'dateformat', value: 'd.m.Y|%d.%m.%Y' },
    ]);
    await expect(facade.getOption('companyname')).resolves.toBe('Company One');
    const answer = await facade.getOptions(['dateformat', 'expense_credit_payment_mode']);
    expect([...answer.entries()]).toEqual([
      ['dateformat', 'd.m.Y|%d.%m.%Y'],
      ['expense_credit_payment_mode', null],
    ]);
    expect(repository.calls).toEqual([
      ['companyname'],
      ['dateformat', 'expense_credit_payment_mode'],
    ]);
  });

  it('has no write method (D-10)', () => {
    expect(Object.getOwnPropertyNames(SettingsFacade.prototype).sort()).toEqual([
      'constructor',
      'getOption',
      'getOptions',
    ]);
  });

  it('answers a map a consumer typed over plain strings accepts', async () => {
    const { facade } = await facadeOver([{ name: 'thousand_separator', value: '.' }]);
    const asConsumer: ReadonlyMap<string, string | null> = await facade.getOptions([
      'thousand_separator',
    ]);
    expect(asConsumer.get('thousand_separator')).toBe('.');
  });

  it('refuses default_tax at compile time and, forced past the compiler, before any read', async () => {
    const { facade, repository } = await facadeOver([{ name: 'default_tax', value: 'synthetic' }]);
    const typed: SettingsFacade = facade;
    // @ts-expect-error: default_tax is not on the allow-list (D-22)
    const pending = typed.getOption('default_tax');
    expect((await refusal(pending)).code).toBe('ERP-INTERNAL-0001');
    expect(repository.calls).toEqual([]);
  });

  it('stubSettingsModule replaces SettingsModule whole, so the facade a consumer gets is the fake', async () => {
    const fake = new FakeSettingsFacade([{ name: 'companyname', value: 'Company One' }]);
    const moduleRef = await Test.createTestingModule({ imports: [SettingsModule] })
      .overrideModule(SettingsModule)
      .useModule(stubSettingsModule(fake))
      .compile();
    expect(moduleRef.get(SettingsFacade)).toBe(fake);
  });
});

/** What a consumer calls; the real facade and the fake both satisfy it. */
type Subject = Pick<FakeSettingsFacade, 'getOption' | 'getOptions'>;

interface Arm {
  readonly subject: Subject;
  /** How many reads reached the store (the repository's calls, or the fake's recorded calls). */
  readonly reads: () => number;
}

const ARMS: readonly (readonly [string, (rows: SettingRow[]) => Promise<Arm>])[] = [
  [
    'SettingsFacade on InMemorySettingsRepository',
    async (rows) => {
      const { facade, repository } = await facadeOver(rows);
      return { subject: facade, reads: () => repository.calls.length };
    },
  ],
  [
    'FakeSettingsFacade',
    (rows) => {
      const fake = new FakeSettingsFacade(rows);
      return Promise.resolve({ subject: fake, reads: () => fake.calls.length });
    },
  ],
];

describe.each(ARMS)('the settings contract: %s', (_name, armOver) => {
  it("answers the stored value, null when absent, '' when stored empty", async () => {
    const { subject } = await armOver([
      { name: 'companyname', value: 'Company One' },
      { name: 'company_logo_dark', value: '' },
    ]);
    await expect(subject.getOption('companyname')).resolves.toBe('Company One');
    await expect(subject.getOption('company_logo')).resolves.toBeNull();
    await expect(subject.getOption('company_logo_dark')).resolves.toBe('');
    const answer = await subject.getOptions(['companyname', 'company_logo']);
    expect([...answer.entries()]).toEqual([
      ['companyname', 'Company One'],
      ['company_logo', null],
    ]);
  });

  it('matches the exact name only', async () => {
    const { subject } = await armOver([{ name: 'COMPANYNAME', value: 'Other' }]);
    await expect(subject.getOption('companyname')).resolves.toBeNull();
  });

  it('answers the highest id of a duplicated name', async () => {
    const { subject } = await armOver([
      { name: 'company_logo', value: 'older' },
      { name: 'company_logo', value: 'newer' },
    ]);
    await expect(subject.getOption('company_logo')).resolves.toBe('newer');
  });

  it('refuses a name outside the list with ERP-INTERNAL-0001 before any read', async () => {
    const { subject, reads } = await armOver([{ name: 'default_tax', value: 'synthetic' }]);
    // @ts-expect-error: default_tax is not on the allow-list (D-22); the runtime check is under test
    const pending = subject.getOptions(['companyname', 'default_tax']);
    expect((await refusal(pending)).code).toBe('ERP-INTERNAL-0001');
    expect(reads()).toBe(0);
  });
});

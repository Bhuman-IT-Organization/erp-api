/**
 * Test doubles for the settings module, shared with every module that reads a setting (branding,
 * cost centers and payment modes). Test support only: a consumer imports this file from its own
 * `__tests__/`, never from production code.
 *
 * - `InMemorySettingsRepository`: settable `rows` in id order (oldest first, as the Prisma read
 *   orders them); `findByNames` answers the rows whose name, trailing spaces ignored (MySQL's PAD
 *   SPACE collation), is in `names` exactly and records each call in `calls`.
 * - `FakeSettingsFacade`: what a consumer injects in place of `SettingsFacade`. It answers through
 *   the real `SettingsService` over its settable `options`, so it has the facade's semantics by
 *   construction (the refusal before any read, every name a key, `null` when absent, exact name, the
 *   last seeded row of a name wins); `calls` records the names of every `getOptions` call that was
 *   not refused, as passed.
 * - `stubSettingsModule(fake)`: a module providing `SettingsFacade` as the fake, for
 *   `.overrideModule(SettingsModule).useModule(stubSettingsModule(fake))` (auth's
 *   `FakeIdentityModule` form), so a test app never constructs `SettingsRepository` or a database
 *   client.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { SettingsFacade } from '../facade/settings.facade.js';
import type { SettingName, SettingRow } from '../model/settings.model.js';
import type { SettingsRepository } from '../repository/settings.repository.js';
import { SettingsService } from '../service/settings.service.js';

export type { SettingRow } from '../model/settings.model.js';

export class InMemorySettingsRepository {
  readonly calls: (readonly string[])[] = [];

  constructor(public rows: SettingRow[] = []) {}

  findByNames(names: readonly SettingName[]): Promise<readonly SettingRow[]> {
    this.calls.push([...names]);
    const asked = new Set<string>(names);
    return Promise.resolve(this.rows.filter((row) => asked.has(row.name.trimEnd())));
  }
}

/**
 * The real repository has a private `prisma` field, so TypeScript refuses the structural twin where
 * the class is expected: this is the one cast (`asRepository`).
 */
export function asRepository(fake: InMemorySettingsRepository): SettingsRepository {
  return fake as unknown as SettingsRepository;
}

export class FakeSettingsFacade {
  readonly calls: (readonly string[])[] = [];
  private readonly service: SettingsService;

  constructor(public options: readonly SettingRow[] = []) {
    const store = new InMemorySettingsRepository([]);
    // Reads `options` at call time, so a spec may replace it after construction.
    store.findByNames = (names) => {
      const asked = new Set<string>(names);
      return Promise.resolve(this.options.filter((row) => asked.has(row.name.trimEnd())));
    };
    this.service = new SettingsService(asRepository(store));
  }

  async getOption(name: SettingName): Promise<string | null> {
    return (await this.getOptions([name])).get(name) ?? null;
  }

  async getOptions<K extends SettingName>(
    names: readonly K[],
  ): Promise<ReadonlyMap<K, string | null>> {
    const answer = await this.service.getOptions(names);
    this.calls.push([...names]);
    return answer;
  }
}

export function stubSettingsModule(fake: FakeSettingsFacade): DynamicModule {
  @Module({
    providers: [{ provide: SettingsFacade, useValue: fake }],
    exports: [SettingsFacade],
  })
  class StubSettingsModule {}
  return { module: StubSettingsModule };
}

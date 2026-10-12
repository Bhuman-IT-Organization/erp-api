/**
 * Service: the read of allow-listed Perfex options (D-10, D-22). Every requested name is checked
 * against `SETTINGS_ALLOW_LIST` before anything is read; one outside it refuses the whole call with
 * `ERP-INTERNAL-0001` (a programming error, not a 404), and the detail names no key and no value.
 *
 * The answer has every requested name as a key: the stored text, `''` when stored empty, `null` when
 * there is no row. Names match exactly but for trailing spaces: every row is keyed by
 * `name.trimEnd()`, as MySQL's PAD SPACE collation matches it and as Perfex trims every asked name
 * (`get_option`), so a name stored with a trailing space is read (a row differing only in letter case
 * under the column's collation is still ignored). When two rows hold a name, the one Perfex's
 * autoload array reads wins: rows arrive id ascending and the last one seen is kept. One read per
 * call and no cache of its own: callers keep theirs (branding's `TIMINGS.branding.cacheMs`). Nothing
 * is logged, so no value can reach a log line.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import { isSettingName, type SettingName } from '../model/settings.model.js';
import { SettingsRepository } from '../repository/settings.repository.js';

@Injectable()
export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  async getOption(name: SettingName): Promise<string | null> {
    return (await this.getOptions([name])).get(name) ?? null;
  }

  async getOptions<K extends SettingName>(
    names: readonly K[],
  ): Promise<ReadonlyMap<K, string | null>> {
    if (!names.every((name) => isSettingName(name))) {
      throw new AppError('ERP-INTERNAL-0001', 'a setting outside the allow-list was asked for');
    }
    const unique = [...new Set(names)];
    const answer = new Map<K, string | null>(unique.map((name) => [name, null]));
    if (unique.length === 0) return answer;
    for (const row of await this.repository.findByNames(unique)) {
      // Only a key already in the map is set, so a row of any other name is ignored.
      const name = row.name.trimEnd() as K;
      if (!answer.has(name)) continue;
      // Rows arrive id ascending: the last row seen (the highest id) wins.
      answer.set(name, row.value);
    }
    return answer;
  }
}

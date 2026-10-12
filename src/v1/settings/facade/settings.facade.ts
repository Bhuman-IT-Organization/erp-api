/**
 * Facade: the ONLY surface other modules may import (ADR-0001, BE-03), through `settings/index.js`.
 * Reads the allow-listed Perfex options. No write, no endpoint, no event. Saving any setting stays
 * on Perfex's Settings screen (brief section 3.1, D-10).
 *
 * Values are raw `tbloptions` text; the caller parses them (a number, a flag, a date format).
 */
import { Injectable } from '@nestjs/common';
import type { SettingName } from '../model/settings.model.js';
import { SettingsService } from '../service/settings.service.js';

/** What other modules may call: two reads over the allow-list. */
@Injectable()
export class SettingsFacade {
  constructor(private readonly service: SettingsService) {}

  /** The option's stored text, `''` when stored empty, `null` when there is no row. */
  getOption(name: SettingName): Promise<string | null> {
    return this.service.getOption(name);
  }

  /** Every requested name as a key, with `getOption`'s answer for each; one read for the batch. */
  getOptions<K extends SettingName>(names: readonly K[]): Promise<ReadonlyMap<K, string | null>> {
    return this.service.getOptions(names);
  }
}

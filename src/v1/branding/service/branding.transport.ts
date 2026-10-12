/**
 * Transport: the one file in this module that reaches other modules, `SettingsFacade` through
 * `settings/index.js` and `CurrenciesFacade` through `currencies/index.js` (BE-03, BE-08). In-process
 * facade calls, so no breaker and no retry. Since W2A-07 the ten branding options come from the
 * settings module, and since W2A-05 the base currency from the currencies module (D-44); `GET
 * /api/v1/branding` answers what it answered before.
 */
import { Injectable } from '@nestjs/common';
import { CurrenciesFacade, type Currency } from '../../currencies/index.js';
import { SettingsFacade } from '../../settings/index.js';
import { BRANDING_OPTION_NAMES, type BrandingOptionName } from '../model/branding.model.js';

@Injectable()
export class BrandingTransport {
  constructor(
    private readonly settings: SettingsFacade,
    private readonly currencies: CurrenciesFacade,
  ) {}

  /** The ten branding options through the settings facade (W2A-07): every name a key, null when absent. */
  options(): Promise<ReadonlyMap<BrandingOptionName, string | null>> {
    return this.settings.getOptions(Object.values(BRANDING_OPTION_NAMES));
  }

  /** The base currency through the currencies facade (D-44): the first `isdefault` row by id, or null. */
  baseCurrency(): Promise<Currency | null> {
    return this.currencies.baseCurrency();
  }
}

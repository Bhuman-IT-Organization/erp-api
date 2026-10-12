/**
 * Public surface of the module: the facade and its public type, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { SettingsFacade } from './facade/settings.facade.js';
export type { SettingName } from './model/settings.model.js';

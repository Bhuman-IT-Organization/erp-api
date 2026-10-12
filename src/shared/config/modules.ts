/**
 * The deployment's own module switch (ADR-0042, Phase 4.2 P-01). Node rebuilds no vendor licence
 * check: a deployment switches a module off with `MODULES_DISABLED` (env.schema.ts), nothing
 * outside the system is ever asked, and nothing records who or when.
 *
 * `ModuleSwitch` is the one reader. `ModuleEnabledGuard` calls it for every controller class
 * marked `@ModuleKey(...)`; an upload purpose of a switchable module calls `assertEnabled` before
 * accepting a file; `/me` reports `disabled()` so the web hides the module. `MODULE_NAMES`,
 * `ModuleName` and `parseModulesDisabled` live in env.schema.ts (it must not import this file) and are re-exported
 * here, so callers import everything from one place.
 */
import { Injectable } from '@nestjs/common';
import { AppError } from '../errors/app-error.js';
import type { ErrorCode } from '../errors/error-codes.js';
import { AppConfig } from './app-config.js';
import type { ModuleName } from './env.schema.js';

export { MODULE_NAMES, parseModulesDisabled, type ModuleName } from './env.schema.js';

/** The 403 each switched-off module answers; a later module adds its own code beside its name. */
// eslint-disable-next-line @typescript-eslint/no-generated-empty-object-type -- empty on purpose while `MODULE_NAMES` is empty; the type fills in as a switchable module is added.
export const MODULE_DISABLED_CODES: Readonly<Record<ModuleName, ErrorCode>> = Object.freeze({});

/** Answers whether a module is on for this deployment, from the parsed `MODULES_DISABLED`. */
@Injectable()
export class ModuleSwitch {
  constructor(private readonly config: AppConfig) {}

  /** The switched-off modules in their env order (`/me`'s `disabledModules`). */
  disabled(): readonly ModuleName[] {
    return this.config.env.MODULES_DISABLED;
  }

  isEnabled(name: ModuleName): boolean {
    return !this.disabled().includes(name);
  }

  /** Throws the module's 403 (its `MODULE_DISABLED_CODES` entry) while it is switched off. */
  assertEnabled(name: ModuleName): void {
    if (!this.isEnabled(name)) throw new AppError(MODULE_DISABLED_CODES[name]);
  }
}

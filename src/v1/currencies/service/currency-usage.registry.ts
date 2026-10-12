/**
 * The currency usage counters other modules register (D-41 inverted, Currencies planning answer 4;
 * the `MailTemplateRegistry` form). A module that keeps its own rows naming a currency registers a
 * read-only counter through `CurrenciesFacade.registerUsage` from its own `onModuleInit`, so this
 * module asks it before a delete or a code change without importing it: currencies imports no other
 * v1 module, and the module that registers may import `CurrenciesModule` with no cycle.
 *
 * A malformed or duplicate counter throws at registration, so a bad registration fails at boot, not
 * in front of an administrator. A counter answers one number: no id, no price, nothing written.
 */
import { Injectable } from '@nestjs/common';

/** One module's read-only count of its own rows naming a currency. */
export interface CurrencyUsageCounter {
  /** The `registeredUsage` key on the wire, `/^[a-z][A-Za-z0-9]*$/`, at most 40 characters. */
  readonly key: string;
  /** The registering module's folder name, `/^[a-z][a-z0-9-]*$/`. */
  readonly module: string;
  /** The singular the 409 details use, plain lower-case words (`probe row`). */
  readonly noun: string;
  /** How many of the module's rows name the currency: a non-negative integer, nothing else. */
  count(currencyId: number): Promise<number>;
}

/** A counter key: camelCase, starting with a lower-case letter. */
const KEY = /^[a-z][A-Za-z0-9]*$/;
/** The longest key. */
const KEY_MAX = 40;
/** A module folder name. */
const MODULE = /^[a-z][a-z0-9-]*$/;
/** A noun: lower-case words separated by single spaces. */
const NOUN = /^[a-z]+(?: [a-z]+)*$/;
/** The longest noun. */
const NOUN_MAX = 60;

/** What is wrong with `counter`, or null when nothing is. */
function problemOf(counter: CurrencyUsageCounter): string | null {
  if (!KEY.test(counter.key) || counter.key.length > KEY_MAX) {
    return `key must match ${KEY.source} and be at most ${String(KEY_MAX)} characters`;
  }
  if (!MODULE.test(counter.module)) {
    return `module ${JSON.stringify(counter.module)} must match ${MODULE.source}`;
  }
  if (!NOUN.test(counter.noun) || counter.noun.length > NOUN_MAX) {
    return `noun must be plain lower-case words, at most ${String(NOUN_MAX)} characters`;
  }
  return typeof counter.count === 'function' ? null : 'count must be a function';
}

@Injectable()
export class CurrencyUsageRegistry {
  private readonly registered = new Map<string, CurrencyUsageCounter>();

  /** Throws on a malformed counter or a key already registered. */
  register(counter: CurrencyUsageCounter): void {
    const problem = problemOf(counter);
    if (problem !== null) throw new Error(`currency usage ${counter.key}: ${problem}`);
    if (this.registered.has(counter.key)) {
      throw new Error(`currency usage ${counter.key} is already registered`);
    }
    this.registered.set(counter.key, counter);
  }

  /** Every registered counter, sorted by key. */
  counters(): readonly CurrencyUsageCounter[] {
    return [...this.registered.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  }
}

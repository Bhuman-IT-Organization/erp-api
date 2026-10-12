# settings

## Purpose

Reads the Perfex options other modules need, and only those (W2A-07). A facade over a fixed
allow-list of 11 `tbloptions` names (D-10, D-22, D-37), so no module reads `tbloptions` wholesale
and none can be handed a credential row by accident. It is the one facade-only module (D-23): no
controller, no routes, no events and no owned table, written by hand rather than generated, and
admitted by name in `src/v1/__tests__/module-shape.spec.ts`. Who reads it: branding (its ten
options, since W2A-07; cost centers reads `default_timezone` among them) and payment modes (the
credit-expense mode, D-37).

It writes nothing.

## Owned tables

Owns no table and writes none.

Source: `tbloptions` (owner `unattributed` in the register; written by Perfex's Settings screen and
eight legacy writers). The customer saves every listed option on Perfex's Settings screen. Node
inserts, updates and deletes no row.

## Facade surface

- `getOption(name: SettingName): Promise<string | null>`: the stored text, `''` when stored empty,
  `null` when there is no row.
- `getOptions(names: readonly SettingName[]): Promise<ReadonlyMap<SettingName, string | null>>`:
  every requested name is a key with `getOption`'s answer; one read for the batch, duplicates read
  once.
- Names match exactly but for trailing spaces: every row is keyed by `name.trimEnd()` (MySQL's PAD
  SPACE collation, and Perfex trims every asked name), so a name Perfex stored with a trailing space
  is read. A row whose name differs only in letter case is ignored.
- When two rows hold the same name, the one Perfex reads wins: the highest `id` (Perfex's autoload
  array, the last row).
- A name outside the allow-list is a compile-time error (`SettingName`) and, forced past the
  compiler, a 500 `ERP-INTERNAL-0001` before any read; the whole batch is refused and the detail
  names no key and no value.
- Values are raw text; the caller parses them. Nothing is cached here: callers keep their own memo.

Other modules import only `src/v1/settings/index.ts` (`SettingsFacade` and the `SettingName` type),
from their transport, and add `SettingsModule` to their module's `imports`. A test app replaces
`SettingsModule` whole with `stubSettingsModule(new FakeSettingsFacade(rows))` from
`__tests__/fakes.ts` (branding's `create-branding-test-app.ts` is the example).

## Allow-list

`SETTINGS_ALLOW_LIST` in `model/settings.model.ts`, frozen, spelled as Perfex stores each name (04.1 D-37 for one).

| Group                | Names                                                                                                                                                                                        | Read by                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| branding             | `companyname`, `company_logo`, `company_logo_dark`, `active_language`, `dateformat`, `time_format`, `thousand_separator`, `decimal_separator`, `remove_decimals_on_zero`, `default_timezone` | branding (`BRANDING_OPTION_NAMES`) |
| payment modes (D-37) | `expense_credit_payment_mode`                                                                                                                                                                | payment modes (the delete lock)    |

D-22's rule for adding one: a later slice that needs another key adds it to the list in its own
plan, with who reads it. `default_tax` is not on the list: `v1/taxes` reads it itself (D-21).

## Endpoints

None: a facade-only module (D-23).

## Events published

None.

## Events subscribed

None.

## Jobs

None.

## Resilience

ADR-0031: database only.

- **Breaker:** none; no outbound call.
- **Retry policy:** none; one read through the pool, and a failed read is the caller's error.
- **Pool budget:** shares `POOL.db.api`; one `findMany` per read, no memo of its own.

## Layers

| File                                 | Responsibility                                                                                                                    |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `settings.module.ts`                 | Wires the three providers; exports the facade only; no controller, no imports                                                     |
| `service/settings.service.ts`        | The allow-list check before any read, the unique names, every name a key (`null` when absent), the trimmed key, the last row wins |
| `repository/settings.repository.ts`  | The only Prisma caller: one `tbloptions.findMany` over the names (bound `in`), oldest id first, rows parsed with zod; no write    |
| `model/settings.model.ts`            | `SETTINGS_ALLOW_LIST` (D-22, D-37), `SettingName`, `isSettingName`, `SettingRow`                                                  |
| `facade/settings.facade.ts`          | The ONLY surface other modules may import: `getOption`, `getOptions`                                                              |
| `index.ts`                           | Public re-exports: the facade and the `SettingName` type                                                                          |
| `__tests__/fakes.ts`                 | `InMemorySettingsRepository`, `FakeSettingsFacade` and `stubSettingsModule`, shared with every consumer's tests                   |
| `__tests__/settings.service.spec.ts` | The allow-list and the read rules on the in-memory repository                                                                     |
| `__tests__/settings.facade.spec.ts`  | The facade through the module, and one contract over the real facade and the fake                                                 |
| `__tests__/settings.repository*.ts`  | The query shape on a stub client; the real table against the local mirror, shape and names only                                   |

## How to run its tests

```bash
corepack yarn test src/v1/settings          # unit: the service, the facade and the fake, the repository on a stub client
corepack yarn test:int -- src/v1/settings   # needs the local stack (MySQL on 127.0.0.1:33061): the real tbloptions, shape and names only
```

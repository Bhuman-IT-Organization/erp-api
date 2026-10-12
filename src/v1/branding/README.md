# branding

## Purpose

Answers "who is this deployment branded for": company name and logo files, and how the customer's
Perfex renders dates, numbers and money (`formats`, plan 03.2-02), read from the customer's own settings so that ONE erp-web build serves every customer (NextGen today, Cube
next) with nothing brand-specific in code (W0-05). Theme tokens (shadcn CSS variables) join the
same payload once the settings module owns them. It is the smallest complete module and, with
`v1/auth`, one of the two reference shapes every other module copies.

## Owned tables

None. Branding owns no table and reads none directly, so it has no `repository/` folder
(Currencies planning answer 5; `TABLELESS_MODULES` in `src/v1/__tests__/module-shape.spec.ts`).

## Read-only sources

Both through another module's facade, from `service/branding.transport.ts` (BE-03, BE-08):

- the ten `tbloptions` names (`companyname`, `company_logo`, `company_logo_dark`,
  `active_language`, `dateformat`, `time_format`, `thousand_separator`, `decimal_separator`,
  `remove_decimals_on_zero`, `default_timezone`; owner `unattributed`) through
  `SettingsFacade.getOptions` (`v1/settings`, W2A-07); the customer changes them in Perfex
  Settings → Company and → Localization;
- the base currency through `CurrenciesFacade.baseCurrency()` (`v1/currencies`, D-44): the first
  `tblcurrencies` row by id with `isdefault = 1`, its fields as stored; the administrator changes
  it on the Currencies screen (`/setup/currencies`, make-base and edit).

## Facade surface

- `current(): Promise<Branding>` — `{ companyName, logoFile, logoDarkFile, defaultLocale, formats }` (the model, never the wire DTO)
- `logoPathOf(branding): string | null`: the logo path the web uses (`/uploads/company/<file>`, the transformer's `logoUrlOf`), `null` when none is set or the name is unsafe; an email makes it absolute with `PUBLIC_BASE_URL` (plan 04.3-05)

Other modules import only `src/v1/branding/index.ts` (the facade and the `Branding` type).

## Endpoints

Under `api/v1/branding` (`BRANDING_ROUTES` in `branding.routes.ts`).

| Method | Path | Guard | Success                                                                                                                                                               | Errors |
| ------ | ---- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `GET`  | ``   | none  | 200 `brandingResponseSchema` — `{ companyName, logoUrl, logoDarkUrl, theme, defaultLocale, formats }`; `Cache-Control: public, max-age=TIMINGS.branding.cacheMaxAgeS` | —      |

Anonymous by design: the login page needs it before anyone is signed in and nothing in the payload
is secret. Logo URLs are same-origin `/uploads/company/<file>` paths or `null`; the client shows
the name as text when `null`. A stored file name that is not a bare name is treated as unset.
`defaultLocale` is the deployment's locale before anyone is signed in: `tbloptions.active_language`
mapped through `shared/config/legacy-locale.ts` (`english` → `en`, `arabic` → `ar`, …), `en` when
empty or unknown (additive, plan 03-01). `formats` is additive too (plan 03.2-02, below).

## Formats

`formats` is how the customer's Perfex renders dates, times, numbers and money today (D-33, D-44):
the web's one formatter reads it, so users see what they see in Perfex. It rides on this
already-public, already-cached response, so it costs the web no extra request; a Perfex settings
change shows after the same `TIMINGS.branding.cacheMs` + `cacheMaxAgeS` as a new logo. Every field
fails closed to the Perfex install default (`DEFAULT_FORMATS` in `model/branding.model.ts`): an
administrator can type anything into those rows, and nothing malformed reaches the web.

| Field                  | Perfex source                                                                                                 | Rule                                                                                                                                                                                                                                  | Fail-closed default                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `dateFormat`           | `tbloptions.dateformat` (`"<php>\|<strftime>"`)                                                               | the PHP part, else the strftime part without `%`, when one of `PERFEX_DATE_FORMATS` (`get_available_date_formats()`)                                                                                                                  | `Y-m-d`                             |
| `timeFormat`           | `tbloptions.time_format`                                                                                      | `24` → `24`, any other non-empty value → `12`                                                                                                                                                                                         | `24`                                |
| `thousandSeparator`    | `tbloptions.thousand_separator`                                                                               | one of `,` `.` space `'` (the raw value, never trimmed)                                                                                                                                                                               | `,`                                 |
| `decimalSeparator`     | `tbloptions.decimal_separator`                                                                                | one of `.` `,`; a pair equal to the thousand separator falls back as a pair                                                                                                                                                           | `.`                                 |
| `decimalPlaces`        | none: `get_decimal_places()` is the `app_decimal_places` filter's default                                     | always `2`                                                                                                                                                                                                                            | `2`                                 |
| `removeDecimalsOnZero` | `tbloptions.remove_decimals_on_zero`                                                                          | `1` → `true`                                                                                                                                                                                                                          | `false`                             |
| `timeZone`             | `tbloptions.default_timezone`                                                                                 | an IANA zone name `Intl` knows (validation only; nothing is formatted here)                                                                                                                                                           | `null` (web falls back)             |
| `currency`             | the base currency through `CurrenciesFacade.baseCurrency()` (`tblcurrencies`, `isdefault = 1`, first by `id`) | `code` = `name` when ISO 4217 (`/^[A-Z]{3}$/`); `symbol` trimmed, control characters stripped, 1–10 chars, else the code; `placement` `after` or `before`; the currency's own separators when allowlisted, else the option-level pair | `null` (no base, or a non-ISO name) |

Money is the symbol and the amount concatenated with **no space**, in `placement` order — Perfex's
`app_format_money` does exactly that (D-44 supersedes the UI-SPEC's no-break space). The web's
branding schema gives `formats` a default, so either side can deploy first. The options moved to
the settings module in W2A-07 with the wire unchanged; `theme` still waits for W0-05 follow-up (b).

## Events published

None. Listed in `events/published.ts` (`BRANDING_PUBLISHED_EVENTS`), published through
`DOMAIN_EVENT_PUBLISHER` (`shared/events/`) when there is something to announce.

## Events subscribed

Listed in `events/subscribed.ts` (`BRANDING_SUBSCRIBED_EVENTS`, the names as wire constants,
BE-03); `events/handlers/currencies-change.handler.ts` subscribes both and drops the service's
memo, so `formats.currency` changes on the next request instead of after `TIMINGS.branding.cacheMs`.

| Event                           | From            | Why                                                                                        |
| ------------------------------- | --------------- | ------------------------------------------------------------------------------------------ |
| `currencies.record.baseChanged` | `v1/currencies` | another currency is the base (D-39)                                                        |
| `currencies.record.updated`     | `v1/currencies` | the base's symbol, separators or placement may have changed (Currencies planning answer 6) |

## Jobs

None.

## Resilience

ADR-0031: database only.

- **Breaker:** none: no outbound HTTP and no vendor call; the transport makes two in-process
  facade calls (`SettingsFacade.getOptions`, `CurrenciesFacade.baseCurrency`).
- **Retry policy:** none — one read through the pool; a failed read is the request's error.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by
  `check:db`); no extra client. One load is the settings module's `tbloptions` `findMany` plus the
  currencies module's base `findFirst`, run together. The service memoises the result for
  `TIMINGS.branding.cacheMs` as before, so the login page's per-render request reaches MySQL at most
  once a minute per replica, and once more after a currencies change drops the memo.

## Layers

| File                                           | Responsibility                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branding.module.ts`                           | Wires every layer as a provider; imports `SettingsModule` and `CurrenciesModule`; exports the facade only                                                                                                                                                                                               |
| `branding.routes.ts`                           | Route constants: single source for paths, used by controller, tests and erp-web                                                                                                                                                                                                                         |
| `controller/branding.controller.ts`            | HTTP entry for `GET api/v1/branding`; sets `Cache-Control`; returns `service.currentResponse()`. No logic, no transformer import, no try/catch                                                                                                                                                          |
| `service/branding.service.ts`                  | Use case: read the options and the base currency through the transport → model (formats parsed fail-closed by small pure functions), memoised for `TIMINGS.branding.cacheMs`; `dropMemo()` for the currencies-change handler; `currentResponse()` hands the model to the transformer for the controller |
| `service/branding.transport.ts`                | The calls into other modules: `options()` asks `SettingsFacade.getOptions` (through `settings/index.js`) for the ten `BRANDING_OPTION_NAMES`; `baseCurrency()` asks `CurrenciesFacade.baseCurrency` (through `currencies/index.js`, D-44)                                                               |
| `service/branding.transformer.ts`              | Model → `BrandingResponseDto`: the `/uploads/company/<file>` URL contract and the safe-file-name check; `formats` passes through; parsed through the zod response schema                                                                                                                                |
| `model/branding.model.ts`                      | `Branding`, `BRANDING_OPTION_NAMES` (incl. `active_language` and the six format names), `DEFAULT_COMPANY_NAME`, `Formats`, `CurrencyFormat`, `DEFAULT_FORMATS`, `PERFEX_DATE_FORMATS`, the separator allowlists                                                                                         |
| `dto/branding.dto.ts`                          | `formatsSchema` and `brandingResponseSchema` (the wire shape), `z.infer` types                                                                                                                                                                                                                          |
| `events/published.ts`, `events/subscribed.ts`  | Domain events this module emits (none) and handles (`CURRENCIES_EVENTS`: `baseChanged`, `updated`)                                                                                                                                                                                                      |
| `events/handlers/currencies-change.handler.ts` | `CurrenciesChangeEventHandler`: subscribes both currencies names on `DOMAIN_EVENT_SUBSCRIBER` from `onModuleInit` and calls `service.dropMemo()`; parses nothing                                                                                                                                        |
| `facade/branding.facade.ts`                    | The ONLY surface other modules may import; `current()`, `logoPathOf()`                                                                                                                                                                                                                                  |
| `index.ts`                                     | Public re-exports: facade and the `Branding` type                                                                                                                                                                                                                                                       |
| `__tests__/`                                   | One spec per layer (`fakes.ts` = the settings and currencies facade stand-ins and the seeds, `create-branding-test-app.ts` = the in-process Fastify app), `currencies-change.handler.spec.ts`; `branding.int.spec.ts` against the local stack                                                           |

## Legacy parity

Perfex prints `get_option('companyname')` and `get_option('company_logo')` /
`company_logo_dark` in every admin header; this endpoint is that header's data. Uploading a new
logo in Perfex Settings → Company shows on the erp-web login page within
`TIMINGS.branding.cacheMs` + `TIMINGS.branding.cacheMaxAgeS`.

## How to run its tests

```bash
corepack yarn test src/v1/branding          # unit + the in-process controller e2e spec (fake facades, no network)
corepack yarn test:int -- src/v1/branding   # needs the local stack (MySQL on 127.0.0.1:33061): the endpoint and the base currency read against the mirror, shape and ids only
```

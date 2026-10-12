/**
 * Ambient declarations needed because `skipLibCheck` is false (locked flag).
 *
 * `tinybench` (a dependency of vitest) types `performance.now()` as the DOM-lib alias
 * `DOMHighResTimeStamp`. This is a backend; the DOM lib is not loaded and `@types/node` 22 does
 * not declare the alias. It is a plain `number` in every runtime, so declare it as such rather
 * than pulling `lib: ["DOM"]` into the compiler. Remove when `@types/node` ships the alias.
 */
type DOMHighResTimeStamp = number;

/**
 * `@fastify/csrf` (a dependency of `@fastify/csrf-protection`) types its optional `hmacKey` as
 * the WebCrypto `CryptoKey`, again a DOM-lib global that `@types/node` 22 exposes only as
 * `webcrypto.CryptoKey`. Alias it to Node's own type; the api never passes an `hmacKey`.
 */
type CryptoKey = import('node:crypto').webcrypto.CryptoKey;

/**
 * `srvx` (a dependency of `@tus/server`, ADR-0041) types its adapters for every runtime it serves
 * (Bun, Deno, Cloudflare Workers, AWS Lambda, service workers) by importing their type packages,
 * none of which a Node api installs. erp-api only reaches srvx through tus's Node request type, so
 * each foreign runtime type is declared opaque here rather than installed.
 */
declare module 'aws-lambda' {
  export type Context = unknown;
  export type APIGatewayProxyEvent = unknown;
  export type APIGatewayProxyEventV2 = unknown;
}
declare module 'bun' {
  export namespace Serve {
    export type Options<T> = Partial<Record<string, T>>;
  }
  export interface Server<T> {
    readonly bunServer?: T;
  }
}
declare module '@cloudflare/workers-types' {
  export type ExecutionContext = unknown;
  export type ExportedHandlerFetchHandler = (...args: never[]) => unknown;
}
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
declare namespace Deno {
  type ServeOptions = Record<string, unknown>;
  type HttpServer = unknown;
  type NetAddr = unknown;
  interface ServeHandlerInfo<T> {
    readonly remoteAddr?: T;
  }
}
type FetchEvent = unknown;

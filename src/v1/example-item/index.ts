/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { ExampleItemFacade } from './facade/example-item.facade.js';
export type { ExampleItem, ExampleItemId } from './model/example-item.model.js';

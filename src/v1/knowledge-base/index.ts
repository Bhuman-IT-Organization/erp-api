/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { KnowledgeBaseFacade } from './facade/knowledge-base.facade.js';
export type { KnowledgeBase, KnowledgeBaseId } from './model/knowledge-base.model.js';

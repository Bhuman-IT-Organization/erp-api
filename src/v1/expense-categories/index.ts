/**
 * Public surface of the module: the facade and its public types, nothing else.
 * Other modules import from here; the architecture block in `eslint.config.mjs` forbids deeper paths.
 */
export { ExpenseCategoriesFacade } from './facade/expense-categories.facade.js';
export type { ExpenseCategory, ExpenseCategoryId } from './model/expense-categories.model.js';

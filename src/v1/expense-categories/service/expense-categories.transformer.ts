/**
 * Transformer: entity to response DTO, and the description codec. Every DTO is built field by field
 * and then parsed through its zod response schema, which strips any key the schema does not name,
 * so nothing the wire shape does not declare can ride along (T-2-14). The versioned wire shape
 * lives here and in `dto/`; the controller never imports this class (BE-08).
 *
 * The codec keeps the rows Perfex-shaped (brief section 9, RESEARCH Pitfall 6). Perfex stores a
 * description through PHP's `nl2br` and shows it for editing through its `clear_textarea_breaks`
 * helper, so Node writes the first form and reads the second: a row Node saves reads the same in
 * Perfex, and a rollback finds nothing Perfex would not have written itself.
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import {
  expenseCategoriesListResponseSchema,
  expenseCategoriesResponseSchema,
  type ExpenseCategoriesListResponseDto,
  type ExpenseCategoriesResponseDto,
} from '../dto/expense-categories.dto.js';
import type { ExpenseCategory, ExpenseCategoryUsage } from '../model/expense-categories.model.js';

/** One line break as PHP's `nl2br` sees it: the two-character pairs first, then a lone LF or CR. */
const LINE_BREAK = /\r\n|\n\r|\n|\r/g;

/** The three tags `clear_textarea_breaks` removes, in any letter case: `<br />`, `<br/>`, `<br>`. */
const BREAK_TAG = /<br(?: ?\/)?>/gi;

/** The counts a row answers when the usage map has no entry for its id. */
const NO_USAGE: ExpenseCategoryUsage = { expenses: 0, accountingMappings: 0, pettyCashAdvances: 0 };

/**
 * The stored form, as PHP's `nl2br` writes it: `<br />` inserted before each `\r\n`, `\n\r`, `\n`
 * or `\r`, the line break itself kept.
 */
export function toStoredDescription(text: string): string {
  return text.replace(LINE_BREAK, '<br />$&');
}

/**
 * The read form, as Perfex's `clear_textarea_breaks` answers it: every `<br />`, `<br/>` and `<br>`
 * removed in any letter case, then trimmed. A `NULL` column reads as `''`.
 */
export function fromStoredDescription(stored: string | null): string {
  return stored === null ? '' : stored.replace(BREAK_TAG, '').trim();
}

@Injectable()
export class ExpenseCategoriesTransformer {
  /** The id is a string on the wire (the web treats it as opaque); the description in its read form. */
  toResponse(row: ExpenseCategory): ExpenseCategoriesResponseDto {
    return expenseCategoriesResponseSchema.parse({
      id: String(row.id),
      name: row.name,
      description: fromStoredDescription(row.description),
    });
  }

  /**
   * The list envelope: each row with its three usage counts (zeros when the map has no entry for
   * the id), the four page fields copied one by one (a page object passed as the meta carries
   * nothing else) and `exportLimit`, the export cap from its one definition.
   */
  toListResponse(
    rows: readonly ExpenseCategory[],
    usage: ReadonlyMap<number, ExpenseCategoryUsage>,
    meta: ListPageMeta,
  ): ExpenseCategoriesListResponseDto {
    return expenseCategoriesListResponseSchema.parse({
      data: rows.map((row) => {
        const counts = usage.get(row.id) ?? NO_USAGE;
        return {
          ...this.toResponse(row),
          expenseCount: counts.expenses,
          mappingCount: counts.accountingMappings,
          pettyCashCount: counts.pettyCashAdvances,
        };
      }),
      meta: {
        nextCursor: meta.nextCursor,
        prevCursor: meta.prevCursor,
        total: meta.total,
        rangeStart: meta.rangeStart,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  }
}

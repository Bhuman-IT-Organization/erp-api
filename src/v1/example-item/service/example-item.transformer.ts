/**
 * Transformer: entity → response DTO. Every DTO is built field by field and then parsed through
 * its zod response schema, which strips any key the schema does not name — so `internalRef` or
 * `ownerStaffId` (or a hash, a token, a foreign key) can never ride along by accident (T-2-14). The
 * versioned wire shape lives here and in `dto/`; the controller never imports this class (BE-08).
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import {
  exampleItemListResponseSchema,
  exampleItemResponseSchema,
  type ExampleItemListResponseDto,
  type ExampleItemResponseDto,
} from '../dto/example-item.dto.js';
import type { EnrichedExampleItem } from '../model/example-item.model.js';

@Injectable()
export class ExampleItemTransformer {
  /** The id is a string on the wire: the web treats it as opaque. */
  toResponse(item: EnrichedExampleItem): ExampleItemResponseDto {
    return exampleItemResponseSchema.parse({
      id: String(item.id),
      name: item.name,
      label: item.label,
      createdAt: item.createdAt,
    });
  }

  /**
   * The list envelope: the four page fields copied one by one (a page object passed as the meta
   * carries nothing else), and `exportLimit` and `printLimit`, the export caps from their one
   * definitions.
   */
  toListResponse(
    items: readonly EnrichedExampleItem[],
    meta: ListPageMeta,
  ): ExampleItemListResponseDto {
    return exampleItemListResponseSchema.parse({
      data: items.map((item) => this.toResponse(item)),
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

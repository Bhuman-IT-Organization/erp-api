/**
 * Transformer: entity to response DTO. Every DTO is built field by field and then parsed through
 * its zod response schema, which strips any key the schema does not name. The controller never
 * imports this file (BE-08).
 */
import { Injectable } from '@nestjs/common';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import {
  customerGroupsListResponseSchema,
  customerGroupsResponseSchema,
  type CustomerGroupsListResponseDto,
  type CustomerGroupsResponseDto,
} from '../dto/customer-groups.dto.js';
import type { CustomerGroup, CustomerGroupRow } from '../model/customer-groups.model.js';

/** One customer group on the wire: the id as text and the stored name. */
export function toResponse(row: CustomerGroupRow): CustomerGroupsResponseDto {
  return customerGroupsResponseSchema.parse({
    id: String(row.id),
    name: row.name,
  });
}

/** The facade's shape: `{ id, name }`, never the wire DTO. */
export function toCustomerGroup(row: CustomerGroupRow): CustomerGroup {
  return { id: row.id, name: row.name };
}

@Injectable()
export class CustomerGroupsTransformer {
  /** One record. */
  toResponse(row: CustomerGroupRow): CustomerGroupsResponseDto {
    return toResponse(row);
  }

  /**
   * The list envelope: each row, and the page fields copied one by one.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly CustomerGroupRow[],
    meta: ListPageMeta,
  ): CustomerGroupsListResponseDto {
    return customerGroupsListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row)),
      meta: {
        nextCursor: meta.nextCursor,
        prevCursor: meta.prevCursor,
        total: meta.total,
        rangeStart: meta.rangeStart,
      },
    });
  }
}

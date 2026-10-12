/**
 * The append-only writer and reader of `tblidentity_audit` (ADR-0034 decision 3).
 *
 * **Append-only is the whole point, so it is the whole surface.** This class exposes `append` and
 * `list` and nothing else: no update, no delete, no upsert, no truncate. The log is the record of
 * who escalated whom, and a module that can edit its own audit trail has none (threat T-3.1-4G).
 * A grep gate in plan 03.1-12's verify asserts that no `identityAudit` update, delete or upsert
 * call exists anywhere under `src/v1/identity`; retention is not this phase's question.
 *
 * `append` takes the caller's transaction client, never opens its own: ADR-0034 d.3 requires the
 * row to land in the same transaction as the change it records, so a change without a row cannot
 * commit and a row without a change cannot survive (threat T-3.1-44).
 *
 * The table was created by Node with a real primary key on purpose (plan 03.1-05), so Prisma
 * addresses it with a typed delegate: **no raw SQL here**. Only `tblstaff_permissions`, which has
 * no key, needs the raw path.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import type { ListFilter, ListQuery } from '../../../shared/http/pagination.js';
import { auditRowSchema, type AuditRow } from '../dto/identity.dto.js';
import type {
  AuditListField,
  IdentityAuditEntry,
  IdentityAuditPage,
  IdentityAuditRow,
} from '../model/identity.model.js';
import type { IdentityTransaction } from './identity.repository.js';

const AUDIT_COLUMNS = {
  id: true,
  actor_staff_id: true,
  subject_staff_id: true,
  subject_role_id: true,
  change_type: true,
  permission_code: true,
  before_value: true,
  after_value: true,
  request_id: true,
  created_at: true,
} as const;

const auditRowsSchema = z.array(auditRowSchema);

/** The `tblidentity_audit` column each BE-19 filter field addresses. */
const AUDIT_FILTER_COLUMNS = {
  subjectStaffId: 'subject_staff_id',
  actorStaffId: 'actor_staff_id',
  changeType: 'change_type',
  createdAt: 'created_at',
} as const satisfies Record<AuditListField, string>;

type WhereValue = Record<string, unknown>;

function castAuditValue(field: AuditListField, raw: string): number | string | Date {
  if (field === 'subjectStaffId' || field === 'actorStaffId') return Number(raw);
  if (field === 'createdAt') return new Date(raw);
  return raw;
}

/**
 * One BE-19 filter as a Prisma `where` fragment; every value is a bound parameter and every column
 * comes from the four-entry allowlist, so a caller cannot reach a column the endpoint does not
 * expose (threat T-3.1-48).
 */
function auditFilterFragment(filter: ListFilter<AuditListField>): WhereValue | null {
  const column = AUDIT_FILTER_COLUMNS[filter.field];
  const list: readonly string[] = typeof filter.value === 'string' ? [filter.value] : filter.value;
  const single = typeof filter.value === 'string' ? filter.value : (filter.value[0] ?? '');
  const cast = (raw: string): number | string | Date => castAuditValue(filter.field, raw);
  switch (filter.op) {
    case 'eq':
      return { [column]: cast(single) };
    case 'ne':
      return { [column]: { not: cast(single) } };
    case 'in':
      return { [column]: { in: list.map(cast) } };
    case 'like':
      return filter.field === 'changeType' ? { [column]: { contains: single } } : null;
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { [column]: { [filter.op]: cast(single) } };
    default:
      return null;
  }
}

function toEntry(row: AuditRow): IdentityAuditRow {
  return {
    id: row.id.toString(),
    actorStaffId: row.actor_staff_id,
    subjectStaffId: row.subject_staff_id,
    subjectRoleId: row.subject_role_id,
    changeType: row.change_type,
    permissionCode: row.permission_code,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    requestId: row.request_id,
    createdAt: row.created_at,
  };
}

@Injectable()
export class IdentityAuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The only write. Called with the caller's transaction client so the rows land with the change or
   * not at all. An empty list is a no-op, never an empty statement.
   */
  async append(tx: IdentityTransaction, entries: readonly IdentityAuditEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await tx.tblidentity_audit.createMany({
      data: entries.map((entry) => ({
        actor_staff_id: entry.actorStaffId,
        subject_staff_id: entry.subjectStaffId,
        subject_role_id: entry.subjectRoleId,
        change_type: entry.changeType,
        permission_code: entry.permissionCode,
        before_value: entry.beforeValue,
        after_value: entry.afterValue,
        request_id: entry.requestId,
        created_at: entry.createdAt,
      })),
    });
  }

  /**
   * One page of the log, keyset-paged on `id` — the only total order the table guarantees, and the
   * order `created_at` follows because the id is a server-assigned auto-increment. Newest first
   * unless `?sort=createdAt` asks otherwise. The cursor is the id of the previous page's last row.
   */
  async list(query: ListQuery<AuditListField>): Promise<IdentityAuditPage> {
    const direction = query.sort.find((entry) => entry.field === 'createdAt')?.direction ?? 'desc';
    const and: WhereValue[] = [];
    for (const filter of query.filters) {
      const fragment = auditFilterFragment(filter);
      if (fragment !== null) and.push(fragment);
    }
    if (query.cursor !== null) {
      const after = BigInt(query.cursor);
      and.push({ id: direction === 'desc' ? { lt: after } : { gt: after } });
    }
    const where: WhereValue = and.length > 0 ? { AND: and } : {};
    const rows = await this.prisma.client.tblidentity_audit.findMany({
      where,
      orderBy: { id: direction },
      take: query.limit + 1,
      select: AUDIT_COLUMNS,
    });
    const parsed = auditRowsSchema.parse(rows).map(toEntry);
    const page = parsed.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = parsed.length > query.limit;
    return { rows: page, nextCursor: hasMore && last !== undefined ? last.id : null };
  }
}

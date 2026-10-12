/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and controller
 * specs share. `InMemoryCustomFieldsRepository` answers the repository's public (read) methods
 * structurally over two collections (fields and value rows): the keyset order both ways with ties
 * broken on the id, `total` and `rangeStart`, `q` over the name or the slug, the `fieldto` filter,
 * the grouped value counts, the definitions in Perfex's order and the value rows of records. The
 * rows Perfex would have written are seeded directly with `seed` and `addValue`; the repository
 * itself writes nothing.
 */
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import type {
  CustomField,
  CustomFieldsListRequest,
  CustomFieldsPage,
  CustomFieldsSortField,
  StoredCustomFieldValue,
} from '../model/custom-fields.model.js';
import type { CustomFieldsRepository } from '../repository/custom-fields.repository.js';

/** A stored field before the fake assigns its id (what Perfex's Setup would have written). */
export type SeedField = Omit<CustomField, 'id'>;

/** A field with every flag off; override what a case needs. */
export function newField(overrides: Partial<SeedField> = {}): SeedField {
  return {
    fieldto: 'leads',
    name: 'Field',
    slug: 'leads_field',
    type: 'input',
    options: '',
    defaultValue: null,
    fieldOrder: 0,
    bsColumn: 12,
    active: true,
    required: false,
    displayInline: false,
    onlyAdmin: false,
    disallowCustomerEdit: false,
    showOnTable: false,
    showOnPdf: false,
    showOnClientPortal: false,
    showOnTicketForm: false,
    ...overrides,
  };
}

/** Three fields, ids 1 to 3: a leads input, an items select, an inactive staff textarea. */
export const SEED_FIELDS: readonly SeedField[] = [
  newField({ fieldto: 'leads', name: 'Source', slug: 'leads_source' }),
  newField({
    fieldto: 'items',
    name: 'Grade',
    slug: 'items_grade',
    type: 'select',
    options: 'a,b',
    showOnPdf: true,
    showOnTable: true,
    showOnClientPortal: true,
  }),
  newField({
    fieldto: 'staff',
    name: 'Notes',
    slug: 'staff_notes',
    type: 'textarea',
    active: false,
  }),
];

/** The repository's public surface, which the fake answers method for method. */
export type CustomFieldsRepositoryPort = Pick<
  CustomFieldsRepository,
  'list' | 'count' | 'findById' | 'valuesCountOf' | 'definitionsOf' | 'valuesOf'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: CustomField, sortField: CustomFieldsSortField): Key {
  switch (sortField) {
    case 'name':
      return [row.name, row.id];
    case 'fieldto':
      return [row.fieldto, row.id];
    case 'type':
      return [row.type, row.id];
    case 'fieldOrder':
      return [row.fieldOrder, row.id];
    case 'id':
      return [row.id, row.id];
  }
}

interface ValueRow extends StoredCustomFieldValue {
  readonly id: number;
  readonly fieldto: string;
}

export class InMemoryCustomFieldsRepository implements CustomFieldsRepositoryPort {
  /** Every value row, as `tblcustomfieldsvalues` holds them. */
  readonly values: ValueRow[] = [];
  private readonly rows = new Map<number, CustomField>();
  private lastId = 0;
  private lastValueId = 0;

  list(request: CustomFieldsListRequest): Promise<CustomFieldsPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: CustomField): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: CustomField[];
    if (cursor?.direction === 'before') {
      const earlier = sorted.filter((row) => compareKeys(key(row), cursor.key, order) < 0);
      items = earlier.slice(Math.max(0, earlier.length - limit));
    } else {
      items = sorted
        .filter((row) => cursor === null || compareKeys(key(row), cursor.key, order) > 0)
        .slice(0, limit);
    }
    const total = sorted.length;
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) {
      return Promise.resolve({ items, nextCursor: null, prevCursor: null, total, rangeStart: 0 });
    }
    const rangeStart =
      sorted.filter((row) => compareKeys(key(row), key(first), order) < 0).length + 1;
    return Promise.resolve({
      items,
      nextCursor:
        rangeStart - 1 + items.length < total ? encodeCursor(sortField, key(last), 'after') : null,
      prevCursor: rangeStart > 1 ? encodeCursor(sortField, key(first), 'before') : null,
      total,
      rangeStart,
    });
  }

  count(request: CustomFieldsListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<CustomField | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  valuesCountOf(ids: readonly number[]): Promise<ReadonlyMap<number, number>> {
    return Promise.resolve(
      new Map(ids.map((id) => [id, this.values.filter((row) => row.fieldId === id).length])),
    );
  }

  definitionsOf(fieldto: string): Promise<readonly CustomField[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.fieldto === fieldto)
        .sort((a, b) => a.fieldOrder - b.fieldOrder || a.id - b.id),
    );
  }

  valuesOf(fieldto: string, relIds: readonly number[]): Promise<readonly StoredCustomFieldValue[]> {
    return Promise.resolve(
      this.values
        .filter((row) => row.fieldto === fieldto && relIds.includes(row.relId))
        .map(({ relId, fieldId, value }) => ({ relId, fieldId, value })),
    );
  }

  /** A field row the specs seed directly (Perfex's Setup writes them; the module never does). */
  seed(field: SeedField): CustomField {
    this.lastId += 1;
    const row: CustomField = { id: this.lastId, ...field };
    this.rows.set(row.id, row);
    return row;
  }

  /** A value row the specs seed directly (Perfex writes them; the module never does). */
  addValue(fieldId: number, relId: number, value: string): void {
    const fieldto = this.rows.get(fieldId)?.fieldto ?? '';
    this.lastValueId += 1;
    this.values.push({ id: this.lastValueId, relId, fieldId, fieldto, value });
  }

  /** `?q=` over the name or the slug, and the `fieldto` filter. */
  private matching(request: CustomFieldsListRequest): CustomField[] {
    const needle = request.search?.toLowerCase() ?? null;
    return [...this.rows.values()].filter(
      (row) =>
        (needle === null ||
          row.name.toLowerCase().includes(needle) ||
          row.slug.toLowerCase().includes(needle)) &&
        (request.fieldto === null || request.fieldto.includes(row.fieldto)),
    );
  }
}

/**
 * The fake where the module expects the repository. The real class has a private `prisma` field, so
 * TypeScript will not accept a structural twin without this one cast; `implements` keeps it honest.
 */
export function asRepository(fake: InMemoryCustomFieldsRepository): CustomFieldsRepository {
  return fake as unknown as CustomFieldsRepository;
}

/** A new fake seeded with `SEED_FIELDS` (ids 1 to 3). */
export function seededStore(): InMemoryCustomFieldsRepository {
  const repo = new InMemoryCustomFieldsRepository();
  for (const field of SEED_FIELDS) repo.seed(field);
  return repo;
}

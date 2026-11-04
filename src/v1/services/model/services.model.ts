import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tblservices` row: `serviceid` (key) and `name` (VARCHAR(50)). */
export interface ServiceRow {
  readonly id: number;
  readonly name: string;
}

export interface NewService {
  readonly name: string;
}

/** The facade's public shape. */
export interface Service {
  readonly id: number;
  readonly name: string;
}

export type ServiceId = Service['id'];

export type ServicesSortField = 'id' | 'name';

export interface ServicesListRequest {
  readonly search: string | null;
  readonly sortField: ServicesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<ServicesSortField> | null;
  readonly limit: number;
}

export interface ServicesPage extends ListPageMeta {
  readonly items: readonly ServiceRow[];
}

export const SERVICES_FACADE_MAX_ROWS = 1000;

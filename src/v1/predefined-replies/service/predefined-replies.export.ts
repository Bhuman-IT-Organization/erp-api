import type { ExportCell } from '../../../shared/http/export.js';
import type { PredefinedReplyListItem } from '../model/predefined-replies.model.js';
import { PREDEFINED_REPLIES_EXPORT_COLUMNS } from '../predefined-replies.routes.js';

export interface PredefinedReplyExportRow {
  readonly id: string;
  readonly name: string;
}

export function toPredefinedReplyExportRow(row: PredefinedReplyListItem): PredefinedReplyExportRow {
  return {
    id: String(row.id),
    name: row.name,
  };
}

export const PREDEFINED_REPLIES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
} as const satisfies Record<
  (typeof PREDEFINED_REPLIES_EXPORT_COLUMNS)[number],
  ExportCell<PredefinedReplyExportRow>
>;

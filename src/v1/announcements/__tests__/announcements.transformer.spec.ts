import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { ANNOUNCEMENTS_EXPORT_COLUMNS } from '../announcements.routes.js';
import type { AnnouncementRow } from '../model/announcements.model.js';
import {
  ANNOUNCEMENTS_EXPORT_CELLS,
  AnnouncementsTransformer,
  toAnnouncement,
  toExportRow,
  toResponse,
} from '../service/announcements.transformer.js';

const ROW: AnnouncementRow = {
  id: 7,
  name: 'Holiday',
  message: 'Closed on Friday',
  dateadded: new Date('2026-02-10T14:30:00.000Z'),
  showtousers: 1,
  showtostaff: 0,
  showname: 1,
};
const NO_MESSAGE: AnnouncementRow = { ...ROW, id: 8, message: null };

describe('toResponse', () => {
  it('writes String(id), the stored fields and the date as ISO text', () => {
    expect(toResponse(ROW)).toEqual({
      id: '7',
      name: 'Holiday',
      message: 'Closed on Friday',
      dateAdded: '2026-02-10T14:30:00.000Z',
      showToUsers: true,
      showToStaff: false,
      showName: true,
    });
  });

  it('keeps a stored NULL message as null', () => {
    expect(toResponse(NO_MESSAGE).message).toBeNull();
  });

  it('never carries a key the response schema does not name', () => {
    const result = toResponse({ ...ROW, userid: '0' } as unknown as AnnouncementRow);
    expect('userid' in result).toBe(false);
  });
});

describe('the export rows', () => {
  it('writes the id as text, the name and the date as ISO text; never the message', () => {
    expect(toExportRow(ROW)).toEqual({
      id: '7',
      name: 'Holiday',
      dateadded: '2026-02-10T14:30:00.000Z',
    });
  });

  it('has one cell definition per export column and marks the date as dateTime', () => {
    expect(ANNOUNCEMENTS_EXPORT_CELLS.dateadded.kind).toBe('dateTime');
    expect(Object.keys(ANNOUNCEMENTS_EXPORT_CELLS)).toEqual([...ANNOUNCEMENTS_EXPORT_COLUMNS]);
  });
});

describe('the facade shape', () => {
  it('hands out the stored fields, the date still a Date', () => {
    expect(toAnnouncement(ROW)).toEqual(ROW);
    expect(toAnnouncement(ROW).dateadded).toBeInstanceOf(Date);
  });
});

describe('AnnouncementsTransformer', () => {
  const transformer = new AnnouncementsTransformer();

  it('toResponse is the same as the function', () => {
    expect(transformer.toResponse(ROW)).toEqual(toResponse(ROW));
  });

  it('builds the list envelope with the pager meta and the export limits', () => {
    const response = transformer.toListResponse([ROW, NO_MESSAGE], {
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
    });
    expect(response.data.map((row) => row.id)).toEqual(['7', '8']);
    expect(response.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });
});

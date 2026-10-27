/** The stored `tbltickets_status` row, matching the existing Prisma scalar types. */
export interface TicketStatus {
  readonly ticketstatusid: number;
  readonly name: string;
  readonly isdefault: number;
  readonly statuscolor: string | null;
  readonly statusorder: number | null;
  readonly ticket_count: number;
}

/** The fields the Perfex status form may create; `isdefault` uses the database default of 0. */
export interface NewTicketStatus {
  readonly name: string;
  readonly statuscolor: string | null;
  readonly statusorder: number | null;
}

/** Only the three editable fields can be updated. */
export type TicketStatusPatch = Partial<
  Pick<NewTicketStatus, 'name' | 'statuscolor' | 'statusorder'>
>;

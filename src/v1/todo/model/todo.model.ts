export interface TodoRow {
  readonly id: number;
  readonly description: string;
  readonly staffId: number;
  readonly dateAdded: Date;
  readonly finished: boolean;
  readonly dateFinished: Date | null;
  readonly itemOrder: number | null;
}

export interface TodoCursor {
  readonly itemOrder: number | null;
  readonly todoid: number;
}

export interface NewTodo {
  readonly staffId: number;
  readonly description: string;
  readonly dateAdded: Date;
}

export type TodoStatus = 'unfinished' | 'finished';

/** One checked list request: panel, page size and the last row of the previous page. */
export interface TodoListRequest {
  readonly status: TodoStatus;
  readonly limit: number;
  readonly cursor: TodoCursor | null;
}

export interface TodoPage {
  readonly items: readonly TodoRow[];
  readonly total: number;
  readonly hasMore: boolean;
}

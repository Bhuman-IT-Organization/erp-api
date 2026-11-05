export interface TodoRow {
  readonly id: number;
  readonly description: string;
  readonly staffId: number;
  readonly dateAdded: Date;
  readonly finished: boolean;
  readonly dateFinished: Date | null;
  readonly itemOrder: number | null;
}

export interface NewTodo {
  readonly staffId: number;
  readonly description: string;
  readonly dateAdded: Date;
}

export type TodoStatus = 'unfinished' | 'finished';

/** One checked list request: the panel, the page size and the offset the cursor decoded to. */
export interface TodoListRequest {
  readonly status: TodoStatus;
  readonly limit: number;
  readonly offset: number;
}

export interface TodoPage {
  readonly items: readonly TodoRow[];
  readonly total: number;
}

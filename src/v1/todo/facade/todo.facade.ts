import { Injectable } from '@nestjs/common';
import { TodoService, type TodoDescription } from '../service/todo.service.js';

/** Provides the facade for to do feature operations. */
@Injectable()
export class TodoFacade {
  constructor(private readonly service: TodoService) {}

  /** Describes the to do feature and its available operations. */
  describe(): TodoDescription {
    return this.service.describe();
  }

  /** How many unfinished to do's this staff member has. */
  countUnfinished(staffId: number): Promise<number> {
    return this.service.countUnfinished(staffId);
  }
}

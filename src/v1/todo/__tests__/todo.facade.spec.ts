import { describe, expect, it, vi } from 'vitest';
import { TodoFacade } from '../facade/todo.facade.js';
import type { TodoService } from '../service/todo.service.js';

function build() {
  const service = {
    describe: vi.fn().mockReturnValue({ module: 'todo', version: 1 }),
    countUnfinished: vi.fn().mockResolvedValue(3),
  };
  return { service, facade: new TodoFacade(service as unknown as TodoService) };
}

describe('TodoFacade', () => {
  it('describes the module', () => {
    expect(build().facade.describe()).toEqual({ module: 'todo', version: 1 });
  });

  it('delegates countUnfinished to the service', async () => {
    const { facade, service } = build();
    expect(await facade.countUnfinished(5)).toBe(3);
    expect(service.countUnfinished).toHaveBeenCalledWith(5);
  });

  it('exposes no write method', () => {
    expect(Object.getOwnPropertyNames(TodoFacade.prototype).sort()).toEqual([
      'constructor',
      'countUnfinished',
      'describe',
    ]);
  });
});

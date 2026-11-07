import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { TodoController } from './controller/todo.controller.js';
import { TodoFacade } from './facade/todo.facade.js';
import { TodoRepository } from './repository/todo.repository.js';
import { TodoService } from './service/todo.service.js';
import { TodoTransformer } from './service/todo.transformer.js';
import { TodoTransport } from './service/todo.transport.js';
import { TodoValidator } from './service/todo.validator.js';

@Module({
  imports: [SettingsModule],
  controllers: [TodoController],
  providers: [
    TodoService,
    TodoValidator,
    TodoTransformer,
    TodoTransport,
    TodoRepository,
    TodoFacade,
  ],
  exports: [TodoFacade],
})
export class TodoModule {}

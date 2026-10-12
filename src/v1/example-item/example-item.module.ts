/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the transport resolves
 * `DOMAIN_EVENT_PUBLISHER` from the global `EventsModule`; the repository resolves `PrismaService`
 * from `DbModule`. Copy this module (or erp-docs `05-templates/backend-module`) instead of
 * designing a new shape.
 */
import { Module } from '@nestjs/common';
import { ExampleItemController } from './controller/example-item.controller.js';
import { ExampleItemFacade } from './facade/example-item.facade.js';
import { ExampleItemRepository } from './repository/example-item.repository.js';
import { ExampleItemEnricher } from './service/example-item.enricher.js';
import { ExampleItemService } from './service/example-item.service.js';
import { ExampleItemTransformer } from './service/example-item.transformer.js';
import { ExampleItemTransport } from './service/example-item.transport.js';
import { ExampleItemValidator } from './service/example-item.validator.js';

@Module({
  controllers: [ExampleItemController],
  providers: [
    ExampleItemService,
    ExampleItemValidator,
    ExampleItemEnricher,
    ExampleItemTransformer,
    ExampleItemTransport,
    ExampleItemRepository,
    ExampleItemFacade,
  ],
  exports: [ExampleItemFacade],
})
export class ExampleItemModule {}

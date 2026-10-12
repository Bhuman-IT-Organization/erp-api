/**
 * Module wiring: every layer is a provider; the facade is the export, plus the same instance
 * under `ACCESS_TOKEN_VERIFIER` so `shared/http`'s guards resolve it. Global — identity is
 * cross-cutting: every module's guards resolve the verifier from here without importing the
 * module. `ResilienceModule` and `EventsModule` are global too (the transport's breaker registry
 * and the publisher port), `DbModule` provides `PrismaService` for the repository.
 *
 * **`IdentityModule` is imported, and this is the one module edge out of `auth`** (plan 03.1-11,
 * P11): ADR-0034 decision 1 makes `v1/identity` the only module that may name
 * `tblstaff_permissions`, so `AuthService` reads the rows through `IdentityFacade.permissionsOf`
 * instead of its own `$queryRaw`. The edge runs in one direction only — `v1/identity` imports
 * nothing and resolves `PASSWORD_HASHER` and `ACCESS_TOKEN_VERIFIER` from this global module's
 * exports, which is a container lookup and not a graph edge, so there is no cycle and no
 * `forwardRef`.
 *
 * `IdentityAccessEventHandler` is a provider and not exported: it subscribes to `v1/identity`'s
 * three member events on `DOMAIN_EVENT_SUBSCRIBER` from its own `onModuleInit`, so nothing outside
 * this module resolves it and nothing here imports `v1/identity`'s `events/` (BE-03).
 *
 * `PASSWORD_HASHER` is exported for the same reason `ACCESS_TOKEN_VERIFIER` is: `v1/identity` owns
 * `tblstaff` (ADR-0034 d.1) and therefore writes the password an administrator sets, but the
 * `$2y$12$` contract is one rule with one implementation. A token avoids both a second hasher and
 * the provider cycle a facade dependency in both directions would make (plan 03.1-11 makes `auth`
 * depend on `identity.facade`).
 */
import { Global, Module } from '@nestjs/common';
import { ACCESS_TOKEN_VERIFIER } from '../../shared/http/auth/access-token-verifier.js';
import { PASSWORD_HASHER } from '../../shared/crypto/password-hasher.port.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AuthController } from './controller/auth.controller.js';
import { IdentityAccessEventHandler } from './events/handlers/identity-access.handler.js';
import { JwksController } from './controller/jwks.controller.js';
import { AuthFacade } from './facade/auth.facade.js';
import { AUTH_SESSION_STORE } from './repository/auth-session.store.js';
import { AuthRepository } from './repository/auth.repository.js';
import { RedisAuthSessionStore } from './repository/redis-auth-session.store.js';
import { AuthEnricher } from './service/auth.enricher.js';
import { AuthService } from './service/auth.service.js';
import { AuthTransformer } from './service/auth.transformer.js';
import { AuthTransport } from './service/auth.transport.js';
import { AuthValidator } from './service/auth.validator.js';
import { PasswordHasher } from './service/password-hasher.js';
import { TokenIssuer } from './service/token-issuer.js';

@Global()
@Module({
  imports: [IdentityModule],
  controllers: [AuthController, JwksController],
  providers: [
    AuthService,
    AuthValidator,
    AuthEnricher,
    AuthTransformer,
    AuthTransport,
    AuthRepository,
    PasswordHasher,
    TokenIssuer,
    { provide: AUTH_SESSION_STORE, useClass: RedisAuthSessionStore },
    AuthFacade,
    IdentityAccessEventHandler,
    { provide: ACCESS_TOKEN_VERIFIER, useExisting: AuthFacade },
    { provide: PASSWORD_HASHER, useExisting: PasswordHasher },
  ],
  exports: [AuthFacade, ACCESS_TOKEN_VERIFIER, PASSWORD_HASHER],
})
export class AuthModule {}

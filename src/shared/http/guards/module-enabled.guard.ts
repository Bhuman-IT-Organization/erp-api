/**
 * Refuses every route of a switched-off module with the module's 403 (ADR-0042; the code is the
 * module's `MODULE_DISABLED_CODES` entry). It sits at controller-class level with `@ModuleKey(...)`:
 *
 * ```ts
 * @Controller(...)
 * @ModuleKey('<module>')
 * @UseGuards(ModuleEnabledGuard)
 * export class ThingsController {}
 * ```
 *
 * so each handler's guard list stays `[JwtAuthGuard, PermissionGuard]` and no route-gates spec
 * changes for it (Phase 4.2 M6). Nest runs class guards before handler guards, so an anonymous call
 * to a switched-off module answers this 403 before the 401; it reveals only that the module is off
 * on this deployment (T-4.2-81, accepted). A class using the guard without `@ModuleKey` is a wiring
 * defect: the guard throws a plain Error (a 500), failing closed rather than letting the call in.
 *
 * ADR-0051 decisions 4 and 8: a class carrying `@ModuleOffNotFound()` (opt-in, for an anonymous
 * surface) answers a switched-off module with the generic 404 `ERP-CORE-0004` instead, and sets
 * `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow` on the reply itself: guards run
 * before interceptors, so `NoStoreInterceptor` never sees this answer.
 */
import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import { ModuleSwitch, type ModuleName } from '../../config/modules.js';
import { AppError } from '../../errors/app-error.js';
import {
  MODULE_KEY_METADATA,
  MODULE_OFF_NOT_FOUND_METADATA,
} from '../decorators/module-key.decorator.js';
import { setNoStore } from '../interceptors/no-store.interceptor.js';

/** The class-level module switch (ADR-0042); see the file docblock. */
@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly modules: ModuleSwitch,
  ) {}

  /**
   * Passes while the class's module is on; throws its 403 while off (the generic 404 under
   * `@ModuleOffNotFound()`), a plain Error without a key.
   */
  canActivate(context: ExecutionContext): boolean {
    const key: unknown = this.reflector.getAllAndOverride(MODULE_KEY_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (typeof key !== 'string') throw new Error('ModuleEnabledGuard without @ModuleKey');
    // `@ModuleKey` only accepts a `ModuleName`, so the metadata it set is one.
    const name = key as ModuleName;
    const notFound = this.reflector.getAllAndOverride<boolean | undefined>(
      MODULE_OFF_NOT_FOUND_METADATA,
      [context.getClass(), context.getHandler()],
    );
    if (notFound === true && !this.modules.isEnabled(name)) {
      setNoStore(context.switchToHttp().getResponse<FastifyReply>());
      throw new AppError('ERP-CORE-0004');
    }
    this.modules.assertEnabled(name);
    return true;
  }
}

/**
 * Requires every code declared with `@Permissions(...)` on the handler or its class, and — when
 * `@PermissionsAny(...)` is also declared — at least one of those. Runs after `JwtAuthGuard`: a
 * missing `request.user` is ERP-AUTH-0004 (the guard order is wrong — threat T-1.3-09), a missing
 * permission is ERP-AUTH-0005 naming the code (the any-of refusal names every code it tried). The
 * verifier port answers `hasPermission` from the session's permission snapshot; admin implies true.
 *
 * The all-of list is evaluated first and unconditionally, so adding the any-of form to a handler
 * can never weaken what it already required (threat T-3.1-10). The guard then resolves the
 * ADR-0033 decision 5 row scope from which any-of code admitted the caller — index 0 is the
 * full-view code by the decorator's convention, so holding it is `all` and being admitted by a
 * later code is `own` — and writes it onto the request, the one place `scopeFrom` reads it
 * (threat T-3.1-12). An admin needs no branch here: the verifier answers true for every code
 * (ADR-0033 decision 4), so index 0 holds and the scope is `all`.
 *
 * `@PermissionsRead({ all, own })` is the read several permission groups open: any `all` code is the
 * scope `all`, else any `own` code is the scope `own`, else ERP-AUTH-0005 naming every code. Declared
 * beside the other forms it can only add a requirement and only narrow the scope, never widen it.
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error.js';
import { ACCESS_TOKEN_VERIFIER, type AccessTokenVerifier } from '../auth/access-token-verifier.js';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
  PERMISSIONS_READ_KEY,
  type ReadCodes,
} from '../decorators/permissions.decorator.js';
import type { ReadScope } from '../decorators/scope.decorator.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const codes =
      this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, targets) ?? [];
    const anyCodes =
      this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_ANY_KEY, targets) ?? [];
    const read = this.reflector.getAllAndOverride<ReadCodes | undefined>(
      PERMISSIONS_READ_KEY,
      targets,
    );
    if (codes.length === 0 && anyCodes.length === 0 && read === undefined) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const { user } = request;
    if (user === undefined) throw new AppError('ERP-AUTH-0004');
    for (const code of codes) {
      if (!(await this.verifier.hasPermission(user.staffId, code))) {
        throw new AppError('ERP-AUTH-0005', `Missing permission ${code}`);
      }
    }
    let scope: ReadScope = 'all';
    if (anyCodes.length > 0) {
      let admitted: string | undefined;
      for (const code of anyCodes) {
        if (await this.verifier.hasPermission(user.staffId, code)) {
          admitted = code;
          break;
        }
      }
      if (admitted === undefined) {
        throw new AppError('ERP-AUTH-0005', `Missing permission ${anyCodes.join(' or ')}`);
      }
      scope = admitted === anyCodes[0] ? 'all' : 'own';
    }
    if (read !== undefined && (await this.readScope(user.staffId, read)) === 'own') scope = 'own';
    request.erpReadScope = scope;
    return true;
  }

  /** The scope `@PermissionsRead` gives: widest first, and a refusal names every code it tried. */
  private async readScope(staffId: number, read: ReadCodes): Promise<ReadScope> {
    if (await this.holdsAny(staffId, read.all)) return 'all';
    if (await this.holdsAny(staffId, read.own)) return 'own';
    throw new AppError(
      'ERP-AUTH-0005',
      `Missing permission ${[...read.all, ...read.own].join(' or ')}`,
    );
  }

  private async holdsAny(staffId: number, codes: readonly string[]): Promise<boolean> {
    const held = await Promise.all(codes.map((code) => this.verifier.hasPermission(staffId, code)));
    return held.includes(true);
  }
}

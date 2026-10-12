/**
 * The two permission-metadata forms `PermissionGuard` reads. `@Permissions(...)` means ALL: every
 * code it declares must hold. `@PermissionsAny(...)` means ANY: one held code admits the caller.
 * An any-of list is written widest-code-first, because the guard reads index 0 as the full-view
 * code and resolves the ADR-0033 decision 5 row scope from it — index 0 held is `all`, admitted by
 * a later code is `own`. Both forms require `@UseGuards(JwtAuthGuard, PermissionGuard)` on the
 * handler; neither decorator checks anything by itself.
 *
 * The keys are separate on purpose (threat T-3.1-10): declaring the any-of form beside an all-of
 * form can never weaken it — the guard evaluates the all-of list first and unconditionally.
 */
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'erp:permissions';

export const PERMISSIONS_ANY_KEY = 'erp:permissions-any';

/**
 * Declares the permission codes a handler (or every handler of a class) requires; ALL must hold.
 * Read by `PermissionGuard`. Use with `@UseGuards(JwtAuthGuard, PermissionGuard)`.
 */
export const Permissions = (...codes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_KEY, codes);

/**
 * Declares the permission codes ANY ONE of which admits the caller — `@PermissionsAny(VIEW,
 * VIEW_OWN)`, widest first. Read by `PermissionGuard`, which also resolves the row scope the
 * `@Scope()` param decorator hands to the handler. Use with
 * `@UseGuards(JwtAuthGuard, PermissionGuard)`.
 */
export const PermissionsAny = (...codes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(PERMISSIONS_ANY_KEY, codes);

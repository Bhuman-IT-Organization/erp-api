/**
 * The cross-module transaction token (BE-08). A module that writes its own rows and asks another
 * module to write some of its rows in the same commit (an item save writing its custom-field values
 * and tags) opens one interactive `$transaction` in its repository and hands the callback's client
 * to the other module's facade. Services and facades treat the value as opaque: only a `repository/`
 * file calls a method on it, so the rule "only repositories touch Prisma" still holds.
 *
 * Structurally the same type as `v1/identity`'s `IdentityTransaction`; this one is shared because it
 * crosses a module boundary.
 */
import type { ExtendedPrismaClient } from './prisma.service.js';

/** The client an interactive `$transaction` hands its callback; facades pass it through opaquely (BE-08). */
export type DbTransaction = Omit<
  ExtendedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

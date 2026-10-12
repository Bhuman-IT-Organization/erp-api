/**
 * Port for hashing the legacy `tblstaff.password` column, implemented by `v1/auth`'s
 * `PasswordHasher` and provided under this token by `AuthModule` — the same shape as
 * `ACCESS_TOKEN_VERIFIER` beside it: `shared/` never imports `v1/`, the dependency points inward.
 *
 * **Why the port exists, and why it is here.** ADR-0034 decision 1 makes `v1/identity` the only
 * writer of `tblstaff`, so it is the module that writes a password an administrator sets. The hash
 * contract (`$2y$12$` bcrypt, so a member who later falls back to the legacy login is still
 * verified by PHP `crypt()`) is one rule and must have one implementation: a second copy in
 * `identity` would be a second security primitive to keep in step. Importing `v1/auth`'s facade
 * instead would not do — plan 03.1-11 makes `auth` depend on `identity.facade.permissionsOf`, and a
 * facade dependency in both directions is a provider cycle. A token both modules can resolve has
 * neither problem.
 *
 * **Why it sits under `shared/crypto/` and not `shared/http/auth/`.** Plan 03.1-12 put it beside
 * `ACCESS_TOKEN_VERIFIER` because that is where `v1/auth`'s ports lived, and recorded in this
 * docblock that the folder was wrong: hashing is not an HTTP concern, and a port filed under
 * `http/` invites the next security primitive to be filed there too. Plan 03.1-11 moved it, because
 * moving it needs a `SHARED_ALLOWLIST` entry in `src/v1/__tests__/module-shape.spec.ts` and a
 * `src/shared/README.md` row in the same change and this plan owns both files. `shared/crypto/` is
 * now the home of every non-HTTP cryptographic port; nothing here reads a request.
 */

export interface PasswordHasherPort {
  /** A fresh hash in the format the legacy column stores; never reversible, never logged. */
  hash(password: string): Promise<string>;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');

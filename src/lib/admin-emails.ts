// Dependency-free so the proxy can use it too.

/**
 * The one and only admin: Mira's owner. Fixed in code on purpose, so no setting or
 * environment variable can widen access. Both must match:
 *  - the account's permanent Supabase user id: if this account were ever deleted and
 *    someone signed up again with the same email, they'd get a new id and NOT be admin;
 *  - the account's email.
 */
const OWNER = {
  id: "a6a56fe3-99a7-4776-a23b-1523c2e0784b",
  email: "oyewoledano@gmail.com",
} as const;

export function isAdminUser(id: string | null | undefined, email: string | null | undefined): boolean {
  return id === OWNER.id && email?.toLowerCase() === OWNER.email;
}

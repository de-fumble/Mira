// Shared account helpers (safe in browser and server code).

/** Longest username a user can set. */
export const USERNAME_MAX = 40;
export const PASSWORD_MIN = 8;

/** Collapses spaces and trims; returns an error message or the clean name. */
export function cleanUsername(raw: string): { name: string; error?: string } {
  const name = raw.replace(/\s+/g, " ").trim();
  if (!name) return { name, error: "Your username can’t be empty." };
  if (name.length < 2) return { name, error: "Use at least 2 characters." };
  if (name.length > USERNAME_MAX) return { name, error: `Keep it under ${USERNAME_MAX} characters.` };
  return { name };
}

/** What to call someone: their username, else the first part of their email. */
export function displayName(username: string | null | undefined, email: string | null | undefined): string {
  if (username) return username;
  const local = (email ?? "").split("@")[0].replace(/[._-]+/g, " ").trim();
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "there";
}

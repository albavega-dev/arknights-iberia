export const accountManagementPaths = new Set(["/link-social", "/unlink-account"]);

export function isRecentSession(createdAt: Date | string, now = Date.now()): boolean {
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && created <= now && now - created < 15 * 60 * 1000;
}

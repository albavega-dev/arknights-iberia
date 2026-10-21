export function mergeCnReleaseDate(
  existing: string | null | undefined,
  incoming: string | null | undefined,
  clearExplicitly = false,
): string | null {
  if (clearExplicitly) return null;
  return incoming ?? existing ?? null;
}

export class UnauthorizedError extends Error {
  constructor() { super("Unauthorized"); }
}

export async function requireSession<T>(load: () => Promise<T | null>): Promise<T> {
  const session = await load();
  if (!session) throw new UnauthorizedError();
  return session;
}

type Environment = Readonly<Record<string, string | undefined>>;

/** Authentication remains unavailable unless explicitly enabled for local review. */
export function isPublicAuthenticationEnabled(env: Environment): boolean {
  return env.AUTH_PUBLIC_ENABLED === "true" && env.NODE_ENV === "development";
}

export function authenticationDisabledResponse(): Response {
  return Response.json(
    { error: "Authentication is disabled" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

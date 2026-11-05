export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

type Environment = Readonly<Partial<Record<"NODE_ENV" | "VERCEL_ENV", string>>>;

const basePolicy: ReadonlyArray<readonly [directive: string, sources: readonly string[]]> = [
  ["default-src", ["'self'"]],
  ["script-src", ["'self'", "'unsafe-inline'"]],
  ["style-src", ["'self'", "'unsafe-inline'"]],
  ["img-src", ["'self'", "data:", "blob:"]],
  ["font-src", ["'self'"]],
  ["connect-src", ["'self'"]],
  ["frame-src", ["'self'"]],
  ["object-src", ["'none'"]],
  ["base-uri", ["'self'"]],
  ["form-action", ["'self'"]],
  ["frame-ancestors", ["'none'"]],
  ["upgrade-insecure-requests", []],
];

/** Sources the Vercel toolbar and its comments load on preview deployments. */
const vercelToolbarSources: Readonly<Record<string, readonly string[]>> = {
  "script-src": ["https://vercel.live"],
  "style-src": ["https://vercel.live"],
  "img-src": ["https://vercel.live", "https://vercel.com"],
  "font-src": ["https://vercel.live", "https://assets.vercel.com"],
  "connect-src": ["https://vercel.live", "wss://ws-us3.pusher.com"],
  "frame-src": ["https://vercel.live"],
};

/**
 * Content Security Policy without nonces, so pages can stay static. Next.js and React need inline scripts and styles;
 * development also needs `'unsafe-eval'` for React's debugging stacks, and preview deployments allow the Vercel toolbar.
 */
export function contentSecurityPolicy(env: Environment): string {
  const development = env.NODE_ENV === "development";
  const preview = env.VERCEL_ENV === "preview";
  return basePolicy.map(([directive, sources]) => [
    directive,
    ...sources,
    ...(development && directive === "script-src" ? ["'unsafe-eval'"] : []),
    ...(preview ? vercelToolbarSources[directive] ?? [] : []),
  ].join(" ")).join("; ");
}

/** Header rules for `next.config.ts`: the same headers on every route. */
export function securityHeaderRules(env: Environment = process.env) {
  return [{
    source: "/:path*",
    headers: [...securityHeaders.map((header) => ({ ...header })), { key: "Content-Security-Policy", value: contentSecurityPolicy(env) }],
  }];
}

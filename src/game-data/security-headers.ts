export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

/**
 * Content Security Policy without nonces, so pages can stay static. Next.js and React need inline scripts and styles;
 * development also needs `'unsafe-eval'` for React's debugging stacks. `upgrade-insecure-requests` is left out because
 * browsers ignore it, with a console error, in a report-only policy.
 */
export function contentSecurityPolicy(development = false): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/** Header rules for `next.config.ts`: the same headers on every route, with the policy in report-only mode. */
export function securityHeaderRules(development = false) {
  return [{
    source: "/:path*",
    headers: [...securityHeaders.map((header) => ({ ...header })), { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy(development) }],
  }];
}

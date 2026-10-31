export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()" },
  { key: "X-Frame-Options", value: "DENY" },
] as const;

/** Header rules for `next.config.ts`: the same headers on every route. */
export function securityHeaderRules() {
  return [{ source: "/:path*", headers: securityHeaders.map((header) => ({ ...header })) }];
}

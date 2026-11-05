import assert from "node:assert/strict";
import test from "node:test";

import { compareCodeUnits } from "../src/game-data/string-order";
import { contentSecurityPolicy, securityHeaderRules, securityHeaders } from "../src/game-data/security-headers";

const directives = (policy: string) => new Map(policy.split("; ").map((directive) => {
  const [name, ...sources] = directive.split(" ");
  return [name!, sources] as const;
}));

test("sends the security headers once each on every route", () => {
  const rules = securityHeaderRules();
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.source, "/:path*");
  assert.deepEqual(rules[0]!.headers.map((header) => header.key).sort(compareCodeUnits), ["Content-Security-Policy-Report-Only", "Permissions-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options"]);
  const value = (key: string) => rules[0]!.headers.find((header) => header.key === key)?.value;
  assert.equal(value("X-Content-Type-Options"), "nosniff");
  assert.equal(value("X-Frame-Options"), "DENY");
  assert.equal(value("Referrer-Policy"), "strict-origin-when-cross-origin");
  for (const feature of ["camera", "microphone", "geolocation", "payment", "usb", "browsing-topics"]) assert.match(value("Permissions-Policy")!, new RegExp(`${feature}=\(\)`));
  assert.equal(value("Content-Security-Policy-Report-Only"), contentSecurityPolicy());
});

test("does not repeat HSTS, which the platform already sets, and returns copies of the headers", () => {
  assert.ok(!securityHeaders.some((header) => String(header.key) === "Strict-Transport-Security"));
  assert.notEqual(securityHeaderRules()[0]!.headers[0], securityHeaders[0]);
});

test("the policy only allows the site itself, with inline code and no plugins, frames or eval", () => {
  const policy = directives(contentSecurityPolicy());
  assert.deepEqual(policy.get("default-src"), ["'self'"]);
  assert.deepEqual(policy.get("script-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(policy.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(policy.get("img-src"), ["'self'", "data:", "blob:"]);
  for (const name of ["font-src", "connect-src", "base-uri", "form-action"]) assert.deepEqual(policy.get(name), ["'self'"], name);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("frame-ancestors"), ["'none'"]);
  assert.ok(!contentSecurityPolicy().includes("unsafe-eval"));
  // Ignored, with a console error, in a report-only policy.
  assert.ok(!policy.has("upgrade-insecure-requests"));
});

test("allows eval only in development", () => {
  assert.deepEqual(directives(contentSecurityPolicy(true)).get("script-src"), ["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
  assert.match(securityHeaderRules(true)[0]!.headers.find((header) => header.key === "Content-Security-Policy-Report-Only")!.value, /'unsafe-eval'/);
});

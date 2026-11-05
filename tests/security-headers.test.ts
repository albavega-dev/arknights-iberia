import assert from "node:assert/strict";
import test from "node:test";

import { compareCodeUnits } from "../src/game-data/string-order";
import { contentSecurityPolicy, securityHeaderRules, securityHeaders } from "../src/game-data/security-headers";

const production = { NODE_ENV: "production", VERCEL_ENV: "production" };

const directives = (policy: string) => new Map(policy.split("; ").map((directive) => {
  const [name, ...sources] = directive.split(" ");
  return [name!, sources] as const;
}));

test("sends the security headers once each on every route", () => {
  const rules = securityHeaderRules(production);
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.source, "/:path*");
  assert.deepEqual(rules[0]!.headers.map((header) => header.key).sort(compareCodeUnits), ["Content-Security-Policy", "Permissions-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options"]);
  const value = (key: string) => rules[0]!.headers.find((header) => header.key === key)?.value;
  assert.equal(value("X-Content-Type-Options"), "nosniff");
  assert.equal(value("X-Frame-Options"), "DENY");
  assert.equal(value("Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.equal(value("Content-Security-Policy"), contentSecurityPolicy(production));
});

test("Permissions-Policy only lists features current browsers recognize", () => {
  // Retired Privacy Sandbox features (browsing-topics, interest-cohort and the like) make browsers log an error.
  assert.equal(securityHeaders.find((header) => header.key === "Permissions-Policy")!.value, "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
});

test("does not repeat HSTS, which the platform already sets, and returns copies of the headers", () => {
  assert.ok(!securityHeaders.some((header) => String(header.key) === "Strict-Transport-Security"));
  assert.notEqual(securityHeaderRules(production)[0]!.headers[0], securityHeaders[0]);
});

test("the production policy only allows the site itself, with inline code and no plugins, frames or eval", () => {
  const policy = directives(contentSecurityPolicy(production));
  assert.deepEqual(policy.get("default-src"), ["'self'"]);
  assert.deepEqual(policy.get("script-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(policy.get("style-src"), ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(policy.get("img-src"), ["'self'", "data:", "blob:"]);
  for (const name of ["font-src", "connect-src", "frame-src", "base-uri", "form-action"]) assert.deepEqual(policy.get(name), ["'self'"], name);
  assert.deepEqual(policy.get("object-src"), ["'none'"]);
  assert.deepEqual(policy.get("frame-ancestors"), ["'none'"]);
  assert.deepEqual(policy.get("upgrade-insecure-requests"), []);
  assert.ok(!contentSecurityPolicy(production).includes("vercel"));
});

test("allows eval only in development", () => {
  assert.deepEqual(directives(contentSecurityPolicy({ NODE_ENV: "development" })).get("script-src"), ["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
  assert.ok(!contentSecurityPolicy({ NODE_ENV: "production" }).includes("unsafe-eval"));
});

test("allows the Vercel toolbar only on preview deployments", () => {
  const preview = directives(contentSecurityPolicy({ NODE_ENV: "production", VERCEL_ENV: "preview" }));
  assert.deepEqual(preview.get("script-src"), ["'self'", "'unsafe-inline'", "https://vercel.live"]);
  assert.deepEqual(preview.get("connect-src"), ["'self'", "https://vercel.live", "wss://ws-us3.pusher.com"]);
  assert.deepEqual(preview.get("img-src"), ["'self'", "data:", "blob:", "https://vercel.live", "https://vercel.com"]);
  assert.deepEqual(preview.get("font-src"), ["'self'", "https://vercel.live", "https://assets.vercel.com"]);
  assert.deepEqual(preview.get("frame-src"), ["'self'", "https://vercel.live"]);
  assert.deepEqual(preview.get("default-src"), ["'self'"]);
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "development", VERCEL_ENV: "development" }]) assert.ok(!contentSecurityPolicy(env).includes("vercel"));
});

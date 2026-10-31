import assert from "node:assert/strict";
import test from "node:test";

import { compareCodeUnits } from "../src/game-data/string-order";
import { securityHeaderRules, securityHeaders } from "../src/game-data/security-headers";

test("sends the four security headers once each on every route", () => {
  const rules = securityHeaderRules();
  assert.equal(rules.length, 1);
  assert.equal(rules[0]!.source, "/:path*");
  assert.deepEqual(rules[0]!.headers.map((header) => header.key).sort(compareCodeUnits), ["Permissions-Policy", "Referrer-Policy", "X-Content-Type-Options", "X-Frame-Options"]);
  const value = (key: string) => rules[0]!.headers.find((header) => header.key === key)?.value;
  assert.equal(value("X-Content-Type-Options"), "nosniff");
  assert.equal(value("X-Frame-Options"), "DENY");
  assert.equal(value("Referrer-Policy"), "strict-origin-when-cross-origin");
  for (const feature of ["camera", "microphone", "geolocation", "payment", "usb", "browsing-topics"]) assert.match(value("Permissions-Policy")!, new RegExp(`${feature}=\(\)`));
});

test("does not repeat HSTS, which the platform already sets, and returns copies of the headers", () => {
  assert.ok(!securityHeaders.some((header) => String(header.key) === "Strict-Transport-Security"));
  assert.notEqual(securityHeaderRules()[0]!.headers[0], securityHeaders[0]);
});

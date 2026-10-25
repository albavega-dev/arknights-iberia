import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatNumber, formatPercent } from "../src/game-data/number-format";

describe("number format", () => {
  it("keeps integers without decimals and groups from five digits", () => {
    assert.equal(formatNumber(0), "0");
    assert.equal(formatNumber(6), "6");
    assert.equal(formatNumber(1234), "1234");
    assert.equal(formatNumber(12345), "12.345");
    assert.equal(formatNumber(1234567), "1.234.567");
  });

  it("uses a decimal comma and at most two decimals", () => {
    assert.equal(formatNumber(1.5), "1,5");
    assert.equal(formatNumber(0.333333), "0,33");
    assert.equal(formatNumber(2.005), "2,01");
    assert.equal(formatNumber(1.999), "2");
  });

  it("removes floating-point errors", () => {
    assert.equal(formatNumber(1.1 * 100), "110");
    assert.equal(formatNumber(110.00000000000001), "110");
    assert.equal(formatNumber(0.1 + 0.2), "0,3");
    assert.equal(formatNumber(0.7 * 100), "70");
  });

  it("keeps the sign of negative values", () => {
    assert.equal(formatNumber(-15), "-15");
    assert.equal(formatNumber(-0.25), "-0,25");
    assert.equal(formatNumber(-12345.678), "-12.345,68");
  });

  it("formats percentages with a space before the sign", () => {
    assert.equal(formatPercent(100), "100 %");
    assert.equal(formatPercent(1.1 * 100), "110 %");
    assert.equal(formatPercent(12.5), "12,5 %");
    assert.equal(formatPercent(-30), "-30 %");
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEnvironmentNumber } from "../src/config.js";

test("uses the numeric environment fallback for missing or blank values", () => {
  assert.equal(parseEnvironmentNumber("LIMIT", undefined, 5), 5);
  assert.equal(parseEnvironmentNumber("LIMIT", "  ", 5), 5);
});

test("parses values that satisfy numeric constraints", () => {
  assert.equal(
    parseEnvironmentNumber("PORT", "4020", 3000, {
      integer: true,
      min: 1,
      max: 65_535,
    }),
    4020,
  );
  assert.equal(parseEnvironmentNumber("FEE", "0.01", 1, { min: 0 }), 0.01);
});

test("rejects non-finite and out-of-range environment values", () => {
  assert.throws(
    () => parseEnvironmentNumber("FEE", "not-a-number", 1, { min: 0 }),
    /FEE must be a finite number/,
  );
  assert.throws(
    () => parseEnvironmentNumber("PORT", "1.5", 4020, { integer: true }),
    /PORT must be a finite number \(an integer\)/,
  );
  assert.throws(
    () => parseEnvironmentNumber("LIMIT", "-1", 1, { min: 0 }),
    /LIMIT must be a finite number \(at least 0\)/,
  );
});

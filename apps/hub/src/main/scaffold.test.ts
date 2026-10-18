import { expect, test } from "vitest";

// Proves the Hub package's tests run in CI. Delete once a real main-process test lands.
test("the Hub main-process test suite runs", () => {
  expect(1 + 1).toBe(2);
});

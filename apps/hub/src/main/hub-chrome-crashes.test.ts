import { expect, test } from "vitest";
import { countHubChromeCrashes } from "./hub-chrome-crashes";

/** A clock that reads the given seconds since an arbitrary start, one call at a time. */
function clockAt(...seconds: number[]): () => Date {
  const start = Date.parse("2026-03-04T05:06:07.890Z");
  return () => {
    const next = seconds.shift();
    if (next === undefined)
      throw new Error("clock read more often than expected");
    return new Date(start + next * 1000);
  };
}

test("the third crash within 60 s gives up", () => {
  const recordCrash = countHubChromeCrashes(clockAt(0, 10, 59));

  expect([recordCrash(), recordCrash(), recordCrash()]).toEqual([
    "reload",
    "reload",
    "give-up",
  ]);
});

test("3 crashes more than 60 s apart keep reloading", () => {
  const recordCrash = countHubChromeCrashes(clockAt(0, 61, 122, 183));

  expect([recordCrash(), recordCrash(), recordCrash(), recordCrash()]).toEqual([
    "reload",
    "reload",
    "reload",
    "reload",
  ]);
});

test("the window slides: crashes older than 60 s stop counting", () => {
  const recordCrash = countHubChromeCrashes(clockAt(0, 50, 60, 100));

  // At 60 s the first crash is exactly 60 s old and no longer counts; at 100 s three fall within.
  expect([recordCrash(), recordCrash(), recordCrash(), recordCrash()]).toEqual([
    "reload",
    "reload",
    "reload",
    "give-up",
  ]);
});

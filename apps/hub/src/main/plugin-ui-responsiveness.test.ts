import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { UNRESPONSIVE_GRACE_MS } from "./backend";
import { watchResponsiveness } from "./plugin-ui-responsiveness";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** A Plugin UI's `webContents`, and the crashes recorded against it. */
function watchedPluginUi(): { webContents: EventEmitter; crashes: string[] } {
  const webContents = new EventEmitter();
  const crashes: string[] = [];
  watchResponsiveness(webContents, () => {
    crashes.push("stopped-responding");
  });
  return { webContents, crashes };
}

test("a Plugin UI unresponsive past the grace period stopped responding", () => {
  const { webContents, crashes } = watchedPluginUi();

  webContents.emit("unresponsive");
  vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS - 1);
  expect(crashes).toEqual([]);
  vi.advanceTimersByTime(1);

  expect(crashes).toEqual(["stopped-responding"]);
});

test("a Plugin UI unresponsive again before the grace period ends stops responding once, on time", () => {
  const { webContents, crashes } = watchedPluginUi();

  webContents.emit("unresponsive");
  vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS / 2);
  webContents.emit("unresponsive");
  vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS / 2);
  vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS);

  expect(crashes).toEqual(["stopped-responding"]);
});

test("a Plugin UI that recovers within the grace period is left alone", () => {
  const { webContents, crashes } = watchedPluginUi();

  webContents.emit("unresponsive");
  vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS - 1);
  webContents.emit("responsive");
  vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS * 2);

  expect(crashes).toEqual([]);
});

test("a Plugin closed during the grace period records only the crash that closed it", () => {
  const { webContents, crashes } = watchedPluginUi();

  webContents.emit("unresponsive");
  vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS / 2);
  // It crashed another way, and its page is gone.
  crashes.push("crashed");
  webContents.emit("destroyed");
  vi.advanceTimersByTime(UNRESPONSIVE_GRACE_MS * 2);

  expect(crashes).toEqual(["crashed"]);
});

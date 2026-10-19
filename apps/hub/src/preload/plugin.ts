// The Plugin preload: builds each Plugin UI's one frozen `window.hub` (ADR 0009) before any Plugin
// code runs. Sandboxed, so it may import only `electron` (anything else is bundled) and is built as
// CommonJS. Only `displayLanguage` so far; `backend` and `busy` arrive in later tickets.

import { contextBridge } from "electron";
import { DISPLAY_LANGUAGE_ARG } from "../shared/plugin-preload";

// Main passes the Display Language as an argument, so it is here synchronously, before the page
// parses: fixed for this open's lifetime.
const displayLanguage = process.argv
  .find((arg) => arg.startsWith(DISPLAY_LANGUAGE_ARG))
  ?.slice(DISPLAY_LANGUAGE_ARG.length);
if (displayLanguage === undefined) {
  throw new Error(`The Plugin preload needs ${DISPLAY_LANGUAGE_ARG}`);
}

contextBridge.exposeInMainWorld("hub", Object.freeze({ displayLanguage }));

// The preload runs before the parser has made `<html>` (documentElement is null then; the smoke
// suite proves it), so the lang is set as the element is inserted. Mutation observers run at the
// microtask checkpoint before the parser runs any script, so Plugin code already sees it, and it
// wins over a lang the page's own `<html>` carries.
const observer = new MutationObserver(() => {
  // Not documentElement: its typings say it is never null, which is untrue before the parser runs.
  const root = document.querySelector("html");
  if (root === null) return;
  root.lang = displayLanguage;
  observer.disconnect();
});
observer.observe(document, { childList: true });

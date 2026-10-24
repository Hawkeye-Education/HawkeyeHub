/* global window, document, console, getComputedStyle */
// What a fixture Plugin UI observes, kept on `window.observed` for the smoke test to read, and
// logged, which the Hub writes to the Plugin's log: a `pagehide` can only be read from there.

window.observed = {
  // Read first, before this page's own code could have changed either.
  displayLanguage: window.hub.displayLanguage,
  lang: document.documentElement.lang,
  hubKeys: Object.keys(window.hub),
  hubFrozen: Object.isFrozen(window.hub),
  hubAccent: getComputedStyle(document.documentElement)
    .getPropertyValue("--hub-color-accent")
    .trim(),
  events: [],
};

function report(event) {
  window.observed.events.push(event);
  console.log(event);
}

document.addEventListener("visibilitychange", () => {
  report(`visibilitychange ${document.visibilityState}`);
});
window.addEventListener("pagehide", () => {
  report("pagehide");
});

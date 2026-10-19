// Plugin icons: what each URL serves is unit-tested in src/main/plugin-icons.test.ts. These check
// the scheme as the Hub Chrome meets it, through its session, CORS and CSP. Refusals are unit-tested.

import type { Page } from "@playwright/test";
import {
  displayLanguageOf,
  expect,
  fixtureInstall,
  installFixturePlugins,
  launchHub,
  switcherNames,
  test,
} from "./hub";

// The fixtures' ids in the order the Hub sorts their names (see plugin-switcher.smoke.ts).
const SORTED_IDS = {
  "en-HK": ["attendance", "seating-plan", "scripted-icon", "class-timer"],
  "zh-HK": ["class-timer", "attendance", "scripted-icon", "seating-plan"],
};

// Page scripts below are strings: this tsconfig has no DOM types.

/** Each listed Plugin's icon mask, top to bottom, as the Hub Chrome computed it. */
function iconMasks(hubChrome: Page): Promise<unknown> {
  return hubChrome.evaluate(
    'Array.from(document.querySelector("hub-chrome").shadowRoot.querySelector("plugin-switcher").shadowRoot.querySelectorAll("li"), (li) => getComputedStyle(li, "::before").maskImage)',
  );
}

/**
 * Loads `url` in the Hub Chrome as a CORS image, which is how a CSS mask is fetched, under the
 * same CSP: true once it decodes.
 */
function loadsAsCorsImage(hubChrome: Page, url: string): Promise<unknown> {
  return hubChrome.evaluate(
    `(async () => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = ${JSON.stringify(url)};
      await image.decode();
      return image.complete;
    })()`,
  );
}

test("each listed Plugin shows its icon.svg as a mask, and no Plugin SVG or script reaches the Hub Chrome", async ({
  dataDir,
}) => {
  const fixtures = [
    "class-timer",
    "attendance",
    "seating-plan",
    "scripted-icon",
  ];
  installFixturePlugins(dataDir, fixtures.map(fixtureInstall));

  const hub = await launchHub(dataDir);
  try {
    const hubChrome = await hub.firstWindow();
    const ids = SORTED_IDS[await displayLanguageOf(hubChrome)];
    await expect.poll(() => switcherNames(hubChrome)).toHaveLength(4);

    const urls = ids.map((id) => `hawkeye-icon://${id}/icon.svg`);
    expect(await iconMasks(hubChrome)).toEqual(
      urls.map((url) => `url("${url}")`),
    );
    for (const url of urls) {
      expect(await loadsAsCorsImage(hubChrome, url)).toBe(true);
    }

    // The locator pierces the shadow roots the Plugin Switcher lives in.
    await expect(hubChrome.locator("svg")).toHaveCount(0);
    // The scripted-icon fixture's script would mark the Hub Chrome's body if it ever ran.
    await expect(hubChrome.locator("body")).not.toHaveAttribute(
      "data-icon-script",
    );
  } finally {
    await hub.close();
  }
});

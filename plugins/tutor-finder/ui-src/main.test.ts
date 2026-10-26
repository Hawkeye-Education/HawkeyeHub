// The Plugin UI through the DOM and a fake window.hub, as staff and the Hub use it (§9.1).

import { installFakeHub } from "@hawkeye-hub/fake-hub";
import { expect, test } from "vitest";
import manifest from "../manifest.json";
import page from "./index.html?raw";

// The page's body only: happy-dom would fetch the head's stylesheet and script.
const html = page.slice(
  page.indexOf("<body>") + "<body>".length,
  page.indexOf("</body>"),
);

test("opens on the placeholder screen in English, whatever the Display Language", async () => {
  installFakeHub({ manifest, displayLanguage: "zh-HK" });
  document.body.innerHTML = html;
  await import("./main");

  expect(document.getElementById("title")?.textContent).toBe("Tutor Finder");
  expect(document.getElementById("placeholder")?.textContent).toBe(
    "Tutor Finder is being built. The tutor sheet will load here.",
  );
});

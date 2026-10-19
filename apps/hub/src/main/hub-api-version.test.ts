import { expect, test } from "vitest";
import { HUB_API_VERSION } from "./hub-api-version";

test("the Hub implements Hub API 1.0.0, the version of @hawkeye-hub/hub-api", () => {
  expect(HUB_API_VERSION).toBe("1.0.0");
});

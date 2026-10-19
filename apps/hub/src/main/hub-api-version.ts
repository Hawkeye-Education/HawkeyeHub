// The Hub API version is the version of the types package (ADR 0009). Bundled in at build time.
import hubApiPackage from "@hawkeye-hub/hub-api/package.json" with { type: "json" };
import { parseHubApiVersion } from "./ids";

export const HUB_API_VERSION = parseHubApiVersion(hubApiPackage.version);

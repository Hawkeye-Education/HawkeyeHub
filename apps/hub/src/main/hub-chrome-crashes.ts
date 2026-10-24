// ADR 0012: the Hub reloads a crashed Hub Chrome until it has crashed this often this quickly.

export const HUB_CHROME_MAX_CRASHES = 3;
export const HUB_CHROME_CRASH_WINDOW_SECONDS = 60;

/** Returns a function to call on each Hub Chrome crash; it says whether to reload or give up. */
export function countHubChromeCrashes(
  now: () => Date,
): () => "reload" | "give-up" {
  let crashTimes: number[] = [];
  return () => {
    const time = now().getTime();
    crashTimes = [
      ...crashTimes.filter(
        (crash) => time - crash < HUB_CHROME_CRASH_WINDOW_SECONDS * 1000,
      ),
      time,
    ];
    return crashTimes.length >= HUB_CHROME_MAX_CRASHES ? "give-up" : "reload";
  };
}

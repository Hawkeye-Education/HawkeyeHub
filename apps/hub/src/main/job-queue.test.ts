import { expect, test } from "vitest";
import { createJobQueue } from "./job-queue";

/** A job that logs its start and end, and ends when `finish` is called. */
function job(name: string, log: string[]) {
  let finish: () => void = () => {
    throw new Error("not started");
  };
  const run = () =>
    new Promise<string>((resolve) => {
      log.push(`${name} started`);
      finish = () => {
        log.push(`${name} ended`);
        resolve(name);
      };
    });
  return {
    run,
    finish: () => {
      finish();
    },
  };
}

test("two jobs queued together run one after the other, each answering its own result", async () => {
  const log: string[] = [];
  const queue = createJobQueue();
  const first = job("first", log);
  const second = job("second", log);

  const firstResult = queue.run(first.run);
  const secondResult = queue.run(second.run);
  await Promise.resolve();
  expect(log).toEqual(["first started"]);

  first.finish();
  await expect(firstResult).resolves.toBe("first");
  await expect
    .poll(() => log)
    .toEqual(["first started", "first ended", "second started"]);
  second.finish();
  await expect(secondResult).resolves.toBe("second");
});

test("a job that fails rejects to its caller and the next job still runs", async () => {
  const queue = createJobQueue();

  const failing = queue.run(() => Promise.reject(new Error("broke")));
  const next = queue.run(() => Promise.resolve("ran"));

  await expect(failing).rejects.toThrow("broke");
  await expect(next).resolves.toBe("ran");
});

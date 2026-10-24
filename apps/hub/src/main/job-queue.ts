// The one serial queue installs, updates and uninstalls run through (spec #91): one job at a time,
// so two jobs never write the record, or share uv's cache, at once. There is no cancel.

export interface JobQueue {
  /** Runs `job` once every job queued before it has settled; answers what `job` answers. */
  run<T>(job: () => Promise<T>): Promise<T>;
}

export function createJobQueue(): JobQueue {
  // Settles once the last queued job has; never rejects, so one failure does not stop the queue.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(job) {
      const result = tail.then(job);
      tail = result.catch(() => {
        // Not swallowed: the job's own caller gets the rejection through `result`.
      });
      return result;
    },
  };
}

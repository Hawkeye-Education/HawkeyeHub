export const enHK = {
  group: "Facebook group (URL or id)",
  output: "Output folder",
  signIn: "Sign in to Facebook",
  signingIn:
    "Sign in to Facebook in the Edge window. It closes by itself once you are signed in.",
  outcome: {
    "signed-in": "Signed in to Facebook.",
    cancelled:
      "Sign in cancelled: the Edge window was closed before you signed in.",
  },
  update: "Update",
  stopAtKnown: "Stop at already-downloaded posts",
  stop: "Stop",
  pickOutput: "Choose an output folder first.",
  busy: "Downloading test papers. Closing now stops the run; papers already saved are kept.",
  savingFiles: "Saving the Files tab: file {{done}} of {{total}}.",
  scanning: "Scanning the group feed: {{found}} new posts found.",
  downloading: "Downloading post {{done}} of {{total}}.",
  result: {
    saved: "Saved       {{item}}",
    "skipped-not-paper": "Skipped     {{item}}: not a test paper",
    "skipped-known": "Skipped     {{item}}: already downloaded",
    incomplete:
      "Incomplete  {{item}}: only {{saved}} of about {{shown}} images; retried next run",
    failed: "Failed      {{item}}: {{detail}}",
  },
  summary: {
    finished:
      "Done: files {{filesSaved}} saved, {{filesKnown}} already downloaded, {{filesFailed}} failed; posts {{saved}} saved, {{skippedNotPaper}} not papers, {{incomplete}} incomplete, {{failed}} failed.",
    cancelled:
      "Stopped: files {{filesSaved}} saved, {{filesKnown}} already downloaded, {{filesFailed}} failed; posts {{saved}} saved, {{skippedNotPaper}} not papers, {{incomplete}} incomplete, {{failed}} failed.",
    "bad-streak":
      "Stopped after 4 bad posts in a row: Facebook is probably limiting this account. Wait several hours, then press Update again. ({{saved}} saved, {{incomplete}} incomplete, {{failed}} failed.)",
  },
  error: {
    "browser-not-found":
      "Microsoft Edge could not be started. Install or repair Edge, then try again. ({{detail}})",
    "signed-out":
      "Facebook has signed the Plugin out. Press Sign in to Facebook, then Update again.",
    checkpoint:
      "Facebook is asking for a security check. Press Sign in to Facebook and complete it, wait a few hours, then Update again.",
    blocked:
      "Facebook has temporarily blocked this account. Stop for today and Update again later; papers already saved are kept.",
    "folder-missing": "The output folder no longer exists. Choose it again.",
    "group-invalid":
      "The Facebook group must be a group URL (facebook.com/groups/…) or its number.",
    "already-running": "Edge is already open for this Plugin.",
    "invalid-params": "The Plugin was asked something it cannot do: {{detail}}",
    "method-not-found": "This version of the Plugin cannot do that: {{detail}}",
    internal: "Something went wrong: {{detail}}",
  },
};

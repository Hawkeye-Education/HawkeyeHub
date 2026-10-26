export const enHK = {
  title: "Tutor Finder",
  setup: {
    title: "Connect the tutor sheet",
    hint: "Choose the Google service-account key (.json) that can read the tutor sheet. Tutor Finder keeps it encrypted on this computer.",
    file: "Service-account key file",
    invalid:
      "That file isn't a Google service-account key. Choose the .json downloaded for the service account. Nothing was saved.",
  },
  loading: "Reading the tutor sheet…",
  failed: {
    keyRejected:
      "The key isn't valid: Google refused it. Replace it with a current key for the service account.",
    noAccess:
      "This key can't see the tutor sheet. Share the sheet with {{email}}, then Retry.",
    unreachable:
      "The tutor sheet couldn't be reached. Check the internet connection, then Retry.",
    stale: "Refresh failed, so this is the roster as it was last read.",
  },
  retry: "Retry",
  replaceKey: "Replace key",
  settings: "Settings",
  refresh: "Refresh",
  column: {
    name: "Name",
    price: "Offerings & price",
    district: "District",
    lang: "Lang",
    status: "Status",
    remark: "Interview remark",
  },
  unlevelled: "Unlevelled",
  zoomOnly: "Zoom only",
  status: { noLongerAvailable: "No longer available" },
  tally_one: "{{count}} tutor",
  tally_other: "{{count}} tutors",
};

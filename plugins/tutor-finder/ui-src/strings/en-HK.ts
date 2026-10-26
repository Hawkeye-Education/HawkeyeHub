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
  loadFailed: "The tutor sheet couldn't be read.",
  refresh: "Refresh",
  filters: {
    level: "Level",
    allLevels: "All levels",
    method: {
      title: "How they teach",
      "face-to-face": "Face-to-face",
      online: "Online",
    },
    languages: {
      title: "Language",
      Cantonese: "Cantonese",
      English: "English",
      Mandarin: "Mandarin",
    },
  },
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

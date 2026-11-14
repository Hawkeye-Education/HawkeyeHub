export const enHK = {
  settings: {
    missing: "Settings: still needed: {{items}}",
    done: "Settings: template {{template}}, saving to {{folder}}",
    item: {
      key: "service-account key",
      sheet: "Cash Flow Sheet link",
      template: "Official Receipt template",
      folder: "save folder",
    },
  },
  key: {
    label: "Google service-account key (.json)",
    stored: "Stored, encrypted on this computer. Choose a file to replace it.",
    missing: "Not stored yet.",
    invalid:
      "That file isn't a Google service-account key. Choose the .json downloaded for the service account. Nothing was saved.",
  },
  sheet: {
    label: "Cash Flow Sheet link",
    invalid:
      "That isn't a Google Sheets link. Copy the link from the sheet's address bar. The previous link is kept.",
  },
  template: {
    label: "Official Receipt template (.docx)",
    stored: "Imported {{name}}. Choose a file to replace it.",
    missing: "Not imported yet.",
    notDocx:
      "That file isn't a Word .docx that opens. The previous template is kept.",
    missingPlaceholders: "Missing placeholders: {{names}}.",
    unknownPlaceholders: "Unknown placeholders: {{names}}.",
    kept: "The previous template is kept.",
  },
  folder: "Save folder",
};

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
  tab: {
    import: "Import from Cash Flow Sheet",
    fillIn: "Fill in by hand",
  },
  import: {
    placeholder: "Importing from the Cash Flow Sheet is coming soon.",
  },
  save: {
    one: "Save",
    many: "Save {{n}} Invoices",
    noTemplate: "Import the Official Receipt template in Settings first.",
    noFolder: "Choose a save folder in Settings first.",
    nothingReady: "Nothing ready to save yet.",
    toFillIn: "Fill in the flagged fields first.",
    busy: "Saving Invoices",
    written: "Saved {{name}}",
    failed: "Couldn't save {{name}}: {{message}}",
  },
  result: {
    openFolder: "Open folder",
    dismiss: "Dismiss",
    notOpened: "Couldn't open the folder: {{message}}",
  },
  editor: {
    invoiceNo: "Receipt No.",
    assignedOnSave: "Assigned on Save",
    date: "Date",
    receivedFrom: "Received from (parent or guardian)",
    studentName: "Student Name",
    lineItems: "Line items",
    itemDescription: "Description",
    itemAmount: "Amount (HKD)",
    addLineItem: "+ Line item",
    payment: {
      label: "Payment Method",
      cash: "Cash",
      "bank-transfer": "Bank Transfer",
      fps: "FPS",
      cheque: "Cheque",
      other: "Other",
      otherText: "Other payment method",
    },
    remarks: "Remarks (optional)",
    receivedBy: "Received by",
  },
  preview: {
    noTemplate:
      "Import the Official Receipt template in Settings to see the page here.",
    line: "{{label}}, line {{n}}",
  },
  problem: {
    required: "Required.",
    amount: "Enter an amount above 0, such as 1,234.50.",
    date: "Enter a date.",
    future: "This date is after today. Check it before saving.",
  },
};

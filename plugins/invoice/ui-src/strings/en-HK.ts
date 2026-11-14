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
    refresh: "↻ Refresh",
    readAgain: "Read again",
    invoiced_one: "{{count}} row already invoiced, not shown",
    invoiced_other: "{{count}} rows already invoiced, not shown",
    confirm: "Refreshing discards what you've typed into this batch.",
    discard: "Discard and refresh",
    cancel: "Keep editing",
    setup:
      "Add the service-account key and the Cash Flow Sheet link in Settings to read the sheet.",
    reading: "Reading the Cash Flow Sheet…",
    nothingNew: "Nothing new on the Cash Flow Sheet.",
    keyRejected:
      "Google rejected the service-account key. Replace it in Settings.",
    noAccess:
      "The Cash Flow Sheet isn't shared with the service account. Ask the sheet's owner to share it with {{email}}, then read again.",
    unreachable:
      "Couldn't reach Google. Check the connection, then read again.",
    layoutChanged:
      "The Cash Flow Sheet's layout changed: its header row isn't the one this Plugin reads. Nothing was imported.",
    skip: "Skip",
    unskip: "Don't skip",
    next: "Next",
    remark: "Remark on the sheet:",
    status: {
      "to-fill-in": "to fill in",
      ready: "ready",
      warned: "warned",
      blocked: "blocked: fix on sheet",
      skipped: "skipped",
    },
    blocked: {
      transactionId: "Transaction ID invalid.",
      duplicate: "Transaction ID used on rows {{rows}}.",
      amount: "Amount can't be read or isn't above 0.",
      date: "Date can't be read.",
      fix: "Item No. {{itemNo}}: fix it on the Cash Flow Sheet and import again.",
    },
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
  problem: {
    required: "Required.",
    amount: "Enter an amount above 0, such as 1,234.50.",
    date: "Enter a date.",
    future: "This date is after today. Check it before saving.",
  },
};

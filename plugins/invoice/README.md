# Invoice

Turns Revenues rows on the Cash Flow Sheet into Official Receipts filled from the company's Word template, or fills one in by hand. Each Invoice is saved as a `.docx` named after its Invoice No.

## Setting up

Open Settings and give it four things:

1. **The service-account key**: the `.json` key file of the Google service account.
2. **The Cash Flow Sheet link**: paste the sheet's address from the browser.
3. **The template**: the prepared `.docx` (below).
4. **The save folder**: where Invoices are written.

### Share the sheet with the service account

The Plugin reads the sheet as the service account, not as you. In Google Sheets, click **Share**, add the service account's email (the `client_email` in the key file, ending in `iam.gserviceaccount.com`) as a **Viewer**, and untick "Notify people". Viewer is enough: the Plugin never writes to the sheet.

## Preparing the template

1. Open the real Official Receipt in Word.
2. Type each placeholder below into its box, exactly as written, braces included.
3. Put `{{item_description}}` and `{{item_amount}}` in **one** table row. That row is repeated once per line item.
4. Leave **Signature** and **Company Chop** empty. They have no placeholder and are signed and stamped by hand.
5. Save as `.docx` and import it in Settings.

The import is refused if a placeholder is missing or one it doesn't know is present; the message names them, and the previous template is kept.

| Placeholder | Printed as |
|---|---|
| `{{invoice_no}}` | `TXN-20260315-0001` / `INV-20261114-0001` |
| `{{date}}` | `15/03/2026` (DD/MM/YYYY) |
| `{{received_from}}` | as typed |
| `{{student_name}}` | as typed |
| `{{item_description}}` | per line item, as typed |
| `{{item_amount}}` | per line item, as `1,234.50` |
| `{{total}}` | `1,234.50` |
| `{{amount_in_words}}` | 大寫 |
| `{{pay_cash}}`, `{{pay_bank_transfer}}`, `{{pay_fps}}`, `{{pay_cheque}}`, `{{pay_other}}` | `☑` / `☐` |
| `{{pay_other_text}}` | Other's text, or empty |
| `{{remarks}}` | text, or empty |
| `{{received_by}}` | as typed |

Amounts print without `HKD$`.

## Rules

These keep every Invoice No. unique:

- **Keep the Cash Flow Sheet append-only.** Add new rows at the bottom; never insert, reorder or delete rows.
- **Use one shared save folder** for every machine.
- **Never move, rename or delete a saved Invoice** out of that folder. The folder is how the Plugin knows what has been saved and which numbers are taken.

## Privacy

Nothing logs sheet rows, Remarks, typed names, template contents or the key.

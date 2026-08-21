# sheets-user-entered-for-data

**Severity:** warning  
**Applies to:** any node writing to Google Sheets (`n8n-nodes-base.googleSheets`, or an HTTP Request calling the Sheets API) whose parameters set `valueInputOption`

## What this rule checks

A Google Sheets write whose `valueInputOption` is `"USER_ENTERED"`. The rule
scans node parameters recursively for that key, wherever it is nested, and fires
once per node that carries it. It stays silent when the value is `"RAW"` or the
key is absent.

## Why it matters

The Google Sheets API has two ways to interpret the values you write:

- `RAW` — store each value exactly as sent.
- `USER_ENTERED` — run each value through the same parser Sheets uses when a
  person types into a cell.

`USER_ENTERED` is convenient for spreadsheets a human is building, but it is
lossy when a workflow is storing **data**:

- A string beginning `=` is stored as a **formula**, not text.
- A phone number beginning `+` (`+14155550123`) is read as an arithmetic
  expression — it errors or collapses to a number.
- ISO timestamps and dates coerce to Sheets' own serial date type, so
  `2026-08-21` stops being the string you sent.
- Leading-zero codes (zip codes, SKUs like `007`) silently lose their zeros.

The write returns success and the workflow reports success. Nothing errors. The
data simply arrives in Sheets subtly different from what the workflow produced,
and you find out weeks later when a downstream export is full of `#ERROR!`
cells or numbers that used to be phone numbers.

## Wrong

```json
{
  "name": "Append Row",
  "type": "n8n-nodes-base.googleSheets",
  "typeVersion": 4.5,
  "parameters": {
    "operation": "append",
    "options": {
      "valueInputOption": "USER_ENTERED"
    }
  }
}
```

Every value written is reinterpreted as if typed by hand.

## Right

```json
{
  "name": "Append Row",
  "type": "n8n-nodes-base.googleSheets",
  "typeVersion": 4.5,
  "parameters": {
    "operation": "append",
    "options": {
      "valueInputOption": "RAW"
    }
  }
}
```

Values are stored verbatim. Reach for `USER_ENTERED` only when you deliberately
want Sheets to evaluate formulas or reformat the input.

## How it was found

Distilled from the field notes behind this linter. A workflow appending contact
records to a sheet wrote phone numbers with a leading `+`; with `USER_ENTERED`,
Sheets treated each one as a formula and the column filled with parse errors.
The workflow ran green the whole time — the defect was in the stored data, not
in any node's status.

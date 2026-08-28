# sheets-user-entered-for-data

**Severity:** warning  
**Applies to:** any node writing to Google Sheets - the `n8n-nodes-base.googleSheets` node, or an HTTP Request calling the Sheets API - that asks for `USER_ENTERED` input

## What this rule checks

A Google Sheets write configured to interpret values as if a person had typed
them. The same setting goes by three names depending on how the write is made,
and the rule looks for all three:

| name | where it appears |
| --- | --- |
| `cellFormat` | the n8n Google Sheets node at v4 |
| `valueInputMode` | the same option on other Google Sheets node versions |
| `valueInputOption` | the Google Sheets REST API's own field, used when you call the API from an HTTP Request node |

It matches the name **either** as a parameter key whose value is exactly
`USER_ENTERED`, **or** as an assignment inside any parameter string - which is
where it lands when you call the API directly, in the URL query
(`...values:append?valueInputOption=USER_ENTERED`), in a JSON body, or in an
expression that builds one (`{ valueInputOption: 'USER_ENTERED' }`). Either quote
character counts: expression bodies are JavaScript, so single quotes are the
common case.

The name and the value have to appear **together**. A node that merely mentions
`USER_ENTERED` - in a comment, or in a branch that picks between modes - is not
evidence of a write configured that way, and does not fire. `RAW` never fires.

One finding per node, however many places in it are configured that way.

### What it does not catch

**A write that sets no cell-format option at all.** From `typeVersion 4.1` the
n8n Sheets node's default *is* `USER_ENTERED`, so those writes have the same
defect and this rule is silent on them. (That 4.1 boundary is read from n8n's
source - `cellFormatDefault` - rather than executed against a running instance,
so it is inferred; two independent readings agreed and 16 corpus nodes are
consistent with it.) On the validation corpus that is 149 of
172 write operations - more than the rule reports. This is deliberate for v1 and
is explained in the limits section of `docs/calibration.md`; the extension is
the first item in `docs/plans/v1.1-backlog.md`.

## Why it matters

The Google Sheets API has two ways to interpret the values you write:

- `RAW` - store each value exactly as sent.
- `USER_ENTERED` - run each value through the same parser Sheets uses when a
  person types into a cell.

`USER_ENTERED` is convenient for spreadsheets a human is building, but it is
lossy when a workflow is storing **data**:

- A string beginning `=` is stored as a **formula**, not text.
- A phone number beginning `+` or `-` (`+1-617-555-0142`) is read as an
  arithmetic expression and evaluates to a number.
- ISO timestamps and dates coerce to Sheets' own serial date type, and read back
  as a locale-formatted display string that no longer round-trips - so a
  "is this date in the past?" check downstream can flip.
- Leading-zero codes (zip codes, SKUs like `007`) silently lose their zeros.

The write returns success and the workflow reports success. Nothing errors. The
data simply arrives in Sheets subtly different from what the workflow produced,
and you find out weeks later when a downstream export is full of `#ERROR!` cells
or numbers that used to be phone numbers.

## Wrong

The n8n node:

```json
{
  "name": "Append Row",
  "type": "n8n-nodes-base.googleSheets",
  "typeVersion": 4.7,
  "parameters": {
    "operation": "append",
    "options": { "cellFormat": "USER_ENTERED" }
  }
}
```

Or the same write made against the API directly, where the option is a query
parameter:

```json
{
  "name": "Append Via API",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "method": "POST",
    "url": "https://sheets.googleapis.com/v4/spreadsheets/ID/values/Sheet1!A:D:append?valueInputOption=USER_ENTERED"
  }
}
```

Every value written is reinterpreted as if typed by hand.

## Right

```json
{
  "name": "Append Row",
  "type": "n8n-nodes-base.googleSheets",
  "typeVersion": 4.7,
  "parameters": {
    "operation": "append",
    "options": { "cellFormat": "RAW" }
  }
}
```

Values are stored verbatim. Reach for `USER_ENTERED` only when you deliberately
want Sheets to evaluate formulas or reformat the input.

### Set the option the node actually reads

The n8n Sheets node has two generations and they read **different keys**. Getting
this wrong looks like the linter being wrong:

| node `typeVersion` | key that is read | key that is ignored |
| --- | --- | --- |
| >= 4.1 (v2 node) | `options.cellFormat` | `options.valueInputMode` |
| 1 - 2 (v1 node) | `options.valueInputMode` | - |

A `valueInputMode` left on a v2 node is **inert**. Setting it to `RAW` there
changes nothing: n8n ignores it and falls back to the version default, which from
4.1 onward is `USER_ENTERED`. The write stays corrupted. Only
`options.cellFormat: "RAW"` fixes it at `typeVersion >= 4.1`.

The rule's suggestion is version-aware for this reason, and says so explicitly
when it finds the inert key.

## How it was found

Distilled from the field notes behind this linter. A workflow appending contact
records to a sheet wrote phone numbers with a leading `+`; with `USER_ENTERED`,
Sheets evaluated each one as arithmetic and the column filled with negative
numbers. A second workflow wrote ISO timestamps that came back as Sheets-parsed
dates, so a "has this passed?" check kept re-firing on the same record. Both ran
green the whole time - the defect was in the stored data, not in any node's
status.

The rule then had to be found itself. Its first version searched for the
parameter **key** `valueInputOption`, which is the REST API's name for the
option - a key that appears nowhere in 4,412 production nodes and could not,
because the n8n node uses a different name and the API path carries it inside a
string rather than as a key. It reported nothing on the entire corpus while 131
nodes were configured exactly as described above. A follow-up review found the
repaired matcher still allowed only double quotes, missing every option written
in an expression - the dominant form. The 120 findings from before that quote
fix were then checked by hand against the corpus: **zero false positives, and
not one of them stores a formula.** The quote fix added 11 more (6 HTTP Request
nodes building the same call in an expression, 5 Code nodes assembling the batch
payload), bringing the total to 131. See the zero-firing audit in
`docs/calibration.md`.

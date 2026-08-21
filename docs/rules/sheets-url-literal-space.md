# sheets-url-literal-space

**Severity:** warning  
**Applies to:** any node whose parameters hold a Google Sheets API URL (`sheets.googleapis.com/.../values/<range>`) — typically an HTTP Request node calling the Sheets REST API directly

## What this rule checks

A Sheets `values` URL whose A1 range has a **literal space in the tab name**, e.g.
`/values/Sheet One!A:Z`. The rule scans node parameters recursively for any
string that references `sheets.googleapis.com`, then inspects the tab-name
segment between `/values/` and the first `!` (the separator between the tab name
and the cell range). If that segment contains a literal space it fires. An
already-encoded `%20` contains no space, so `/values/Sheet%20One!A:Z` stays
silent.

## Why it matters

The Sheets API carries the A1 range as a **path segment**:

```
https://sheets.googleapis.com/v4/spreadsheets/{spreadsheetId}/values/{range}
```

A space is not a valid character in a URL path. When the tab name contains one,
the request that goes on the wire is not the range you intended — the API does
not resolve the tab you meant. The GET comes back empty or 404s.

The trap is that **nothing errors in the workflow**. The HTTP node receives a
response (an empty result, or a 404 that the next node happily ignores), so the
run reports success and simply returns no rows. You discover it downstream, when
a report is empty or a "no new records" branch keeps firing for a sheet you know
has data.

## Wrong

```json
{
  "name": "Read Range",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "method": "GET",
    "url": "https://sheets.googleapis.com/v4/spreadsheets/abc123/values/Sheet One!A:Z"
  }
}
```

The literal space in `Sheet One` means the API never sees the tab you meant.

## Right

```json
{
  "name": "Read Range",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "method": "GET",
    "url": "https://sheets.googleapis.com/v4/spreadsheets/abc123/values/Sheet%20One!A:Z"
  }
}
```

Percent-encode the space as `%20`. If you build the URL from an expression, wrap
the range in `encodeURIComponent()` so any tab name with a space is encoded
automatically.

## How it was found

Distilled from the field notes behind this linter. A workflow read a Sheets tab
whose name had a space in it. The URL was typed with the space intact, the GET
returned an empty range with a 2xx, and the workflow's "process new rows" branch
quietly did nothing for days — the sheet had rows the whole time; the request
was just pointed at a tab name the API could not parse.

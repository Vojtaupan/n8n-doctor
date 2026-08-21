# http-raw-body

**Severity:** warning  
**Applies to:** HTTP Request nodes (`n8n-nodes-base.httpRequest`) with `parameters.bodyContentType === 'raw'`

## What this rule checks

An HTTP Request node whose body is configured as **raw content** —
`parameters.bodyContentType` is set to `"raw"`. The rule fires on any HTTP
Request node with that setting, regardless of `typeVersion`.

## Why it matters

The raw body shape looks correct in the editor and passes every schema and
config check. What it does not survive is **programmatic creation**: when the
workflow is created or updated through n8n's public API — or imported from an
export — n8n rewrites the raw body into an empty key/value pair body. The node
then sends an **empty body**, so nothing reaches the endpoint.

The trap is that **nothing errors**. The request still goes out and still gets a
response, so the run reports success. You only notice when the receiving system
records no payload — an integration that "works" in the editor but delivers
nothing once the workflow was deployed via API or moved between instances by
export/import.

## Wrong

```json
{
  "name": "Post Payload",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 3,
  "parameters": {
    "method": "POST",
    "url": "https://api.example.com/ingest",
    "sendBody": true,
    "bodyContentType": "raw",
    "rawContentType": "application/json",
    "body": "{ \"event\": \"ping\" }"
  }
}
```

On API creation the raw `body` is dropped and replaced with an empty body — the
POST arrives with no payload.

## Right

```json
{
  "name": "Post Payload",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 3,
  "parameters": {
    "method": "POST",
    "url": "https://api.example.com/ingest",
    "sendBody": true,
    "bodyContentType": "json",
    "bodyParametersJson": "{ \"event\": \"ping\" }"
  }
}
```

Send the body as structured content — `bodyContentType: "json"` with a JSON body,
or `"form-urlencoded"` with body parameters — which round-trips through API
creation intact. If the endpoint genuinely requires a raw payload, build it in
the HTTP Request v4 body shape (`specifyBody: "json"` / `contentType: "raw"`)
rather than the legacy raw content type.

## How it was found

Distilled from the field notes behind this linter. A workflow that posted a raw
JSON body worked perfectly in the editor, then delivered empty requests after it
was pushed to another instance through the API — n8n had quietly swapped the raw
body for an empty keypair body on creation, and no error ever surfaced.

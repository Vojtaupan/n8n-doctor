# http-json-body-inline-expression

**Severity:** error  
**Applies to:** HTTP Request node (`n8n-nodes-base.httpRequest`), `typeVersion >= 4`

## What this rule checks

An HTTP Request node whose `parameters.jsonBody` is an n8n expression (it starts
with `=`) but is written as a **JSON literal with `{{ }}` expression holes punched
into it** rather than as a single expression that builds the whole body.

The signature is precise: the body starts with `=`, it contains an expression
opener `{{`, and a literal `{` appears *before* that first `{{`. That leading `{`
is the JSON object's opening brace — the tell that the body is a JSON literal
wrapping the expression instead of being wrapped by it.

## Why it matters

When `jsonBody` starts with `=`, n8n treats the **entire** value as one
expression and evaluates it with its Tournament template engine. The idiomatic,
working shape builds the object in code and stringifies it:

```
={{ JSON.stringify({ userId: $json.id, name: $json.name }) }}
```

Here the whole body is one expression; the literal braces live safely inside the
JavaScript object passed to `JSON.stringify`.

The broken shape looks almost identical and is a natural thing to write — take a
JSON body and drop expressions in where the dynamic values go:

```
={ "userId": {{ $json.id }}, "name": "{{ $json.name }}" }
```

But because the value starts with `=`, n8n parses it as an expression from the
first character. It hits the leading literal `{` and tries to interpret it as
expression syntax, and the node throws `invalid syntax` at runtime. Nothing in
the editor flags it: the JSON *looks* well-formed, the node saves, the workflow
activates. It only fails when the node actually executes.

## Wrong

```json
{
  "name": "Create User",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={ \"userId\": {{ $json.id }}, \"name\": \"{{ $json.name }}\" }"
  }
}
```

The body is a JSON literal with expression holes. n8n reads it as one expression,
chokes on the leading `{`, and throws at runtime.

## Right

```json
{
  "name": "Create User",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "parameters": {
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ userId: $json.id, name: $json.name }) }}"
  }
}
```

The whole body is a single expression that returns valid JSON. The literal braces
are inside the object argument to `JSON.stringify`, where the expression engine
expects them.

## How it was found

Distilled from the field notes behind this linter. A POST body was authored by
starting from an example JSON payload and pasting `{{ $json.* }}` expressions in
place of the dynamic values. It saved and activated without complaint, then threw
`invalid syntax` the first time the node ran in production — the kind of trap that
a schema validator, which only sees a non-empty string in `jsonBody`, cannot
catch. The fix is always the same: build the object in one expression and let
`JSON.stringify` produce the body.

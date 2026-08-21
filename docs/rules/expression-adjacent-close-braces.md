# expression-adjacent-close-braces

**Severity:** error  
**Applies to:** any node — every string parameter is scanned

## What this rule checks

An n8n expression whose intended terminator is preempted by an **adjacent `}}`**
produced by nested object literals. The rule scans every parameter string; for
each `{{`, it takes the text up to the first following `}}` and checks whether
that span leaves any `{` unclosed. If it does, the first `}}` was an inner one —
two object-closing braces sitting side by side — rather than the real end of the
expression.

## Why it matters

n8n expressions are delimited by `{{` and `}}`, and the Tournament template
engine ends the expression at the **first** `}}` it sees after the opener. That
is fine until an expression builds a nested object and the developer closes two
braces without a separator:

```
={{ JSON.stringify({ user: { id: $json.id }}) }}
```

The `}}` that closes the two objects (`... $json.id }}`) is read as the end of
the expression. n8n evaluates only the truncated fragment

```
{{ JSON.stringify({ user: { id: $json.id
```

which is not valid, and the node throws `invalid syntax` at runtime. Nothing in
the editor flags it: the expression *looks* balanced, the node saves, and the
workflow activates. It only fails when the node actually executes.

The engine never looks for a *matching* close — it just stops at the first `}}`.
So the depth of your object nesting does not matter; a single pair of adjacent
closing braces anywhere before the intended terminator is enough to break it.

## Wrong

```json
{
  "name": "Build Payload",
  "type": "n8n-nodes-base.set",
  "typeVersion": 3.4,
  "parameters": {
    "assignments": {
      "assignments": [
        {
          "id": "a1",
          "name": "payload",
          "type": "string",
          "value": "={{ JSON.stringify({ user: { id: $json.id }}) }}"
        }
      ]
    }
  }
}
```

The inner and outer objects both close on `}}`. The Tournament engine treats
that as the expression terminator and throws at runtime.

## Right

```json
{
  "name": "Build Payload",
  "type": "n8n-nodes-base.set",
  "typeVersion": 3.4,
  "parameters": {
    "assignments": {
      "assignments": [
        {
          "id": "a1",
          "name": "payload",
          "type": "string",
          "value": "={{ JSON.stringify({ user: { id: $json.id } }) }}"
        }
      ]
    }
  }
}
```

A single space separates the two closing braces (`} }`), so the only `}}` in the
string is the real terminator. The expression evaluates in full.

## How it was found

Distilled from the field notes behind this linter. A nested object was assembled
inside an expression and its braces were closed back-to-back — the natural thing
to type. The workflow saved and activated without complaint, then threw
`invalid syntax` the first time the node ran. A schema validator, which only sees
a non-empty expression string, cannot catch it: the fault is in how the template
engine tokenises the braces, not in any node parameter's shape. The fix is always
the same — put a space between the object-closing brace and the expression
terminator so `}}` appears only once, at the end.

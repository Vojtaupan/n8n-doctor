import type { Rule, Finding } from '../types.js';

/**
 * Detects an HTTP Request node whose body is configured as raw content
 * (`parameters.bodyContentType === 'raw'`).
 *
 * The raw body shape survives the editor and every schema check, but n8n does
 * not round-trip it through programmatic creation: when the workflow is created
 * or updated via the public API (or imported from an export), n8n rewrites the
 * raw body into an empty key/value pair body. The node then sends an empty body
 * — nothing arrives at the endpoint — and nothing errors, so the run reports
 * success while the request quietly carries no payload.
 *
 * Signature: any HTTP Request node with `parameters.bodyContentType === 'raw'`.
 */
export const rule: Rule = {
  id: 'http-raw-body',
  severity: 'warning',
  title: 'HTTP Request: raw body is rewritten to an empty body on programmatic creation',
  docs: 'docs/rules/http-raw-body.md',

  check(graph) {
    const findings: Omit<Finding, 'ruleId' | 'severity' | 'workflowName'>[] = [];

    for (const node of graph.nodes) {
      if (graph.shortType(node) !== 'httpRequest') continue;
      if (node.parameters.bodyContentType !== 'raw') continue;

      findings.push({
        nodeName: node.name,
        message:
          `parameters.bodyContentType is "raw". n8n rewrites a raw body into an empty ` +
          `key/value body when the workflow is created or updated programmatically (public API ` +
          `or import), so the request goes out with an empty body and nothing reaches the ` +
          `endpoint — no error is raised and the run still reports success.`,
        suggestion:
          `Send the body as structured content instead of raw: use bodyContentType "json" with a ` +
          `JSON body, or "form-urlencoded" with body parameters. If the endpoint genuinely needs a ` +
          `raw payload, build it in the HTTP Request v4 body shape (specifyBody: "json" / ` +
          `contentType: "raw") rather than the legacy raw content type, which does not survive API ` +
          `creation.`,
      });
    }

    return findings;
  },
};

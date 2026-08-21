import type { Rule } from '../types.js';
import { setIncludeOtherFields } from './set-include-other-fields.js';
import { rule as switchOptionsPlacement } from './switch-options-placement.js';
import { rule as ifV2MissingLeftValue } from './if-v2-missing-left-value.js';
import { rule as ifNotTrueOperator } from './if-not-true-operator.js';
import { rule as executeWorkflowMissingMappingMode } from './execute-workflow-missing-mapping-mode.js';
import { rule as executeWorkflowSourceNotDatabase } from './execute-workflow-source-not-database.js';
import { rule as httpJsonBodyInlineExpression } from './http-json-body-inline-expression.js';

/**
 * The default rule registry. Every rule exported from this module is run by
 * `runRules` unless the caller passes an explicit `rules` array to override.
 *
 * To add a new rule: import it and append it to this array.
 */
export const rules: Rule[] = [
  setIncludeOtherFields,
  switchOptionsPlacement,
  ifV2MissingLeftValue,
  ifNotTrueOperator,
  executeWorkflowMissingMappingMode,
  executeWorkflowSourceNotDatabase,
  httpJsonBodyInlineExpression,
];

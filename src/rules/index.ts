import type { Rule } from '../types.js';
import { setIncludeOtherFields } from './set-include-other-fields.js';

/**
 * The default rule registry. Every rule exported from this module is run by
 * `runRules` unless the caller passes an explicit `rules` array to override.
 *
 * To add a new rule: import it and append it to this array.
 */
export const rules: Rule[] = [setIncludeOtherFields];

---
name: ai-fix-guardrails
overview: Audit and harden the AI Fix + validation pipeline so structural fixes (v1→v2 BridgeDomain migrations like macLearning/macAging/tunnelIndexPool) are both allowed by the guardrails and permitted by the AI prompt, while keeping identity/scope safety.
todos:
  - id: infer-type-errors
    content: Update inferIssueKind to classify AJV 'must be object/array/string/boolean/integer/number' as issueKind 'type' (src/lib/validate-bundle/fixIssueContext.ts).
    status: completed
  - id: guard-scope-aware-line-delta
    content: "Relax validateAiFixApply: make line-delta limit scope-aware (allow higher deltas when changes are confined under fieldPath/spec) and allow structural changes for type fixes (src/lib/validate-bundle/replaceDocument.ts)."
    status: completed
  - id: guard-unknown-field-relocation
    content: Relax unknownField guardrails to allow add/modify/remove within spec (while preserving identity checks), enabling unknown-field relocation (src/lib/validate-bundle/replaceDocument.ts).
    status: completed
  - id: prompt-scope-direct-spec-children
    content: Include parentObjectSchema for direct spec children in buildFixScopedSchemaPrompt so AI can relocate unknown fields (src/lib/ai/actionPrompts.ts).
    status: completed
  - id: prompt-rules-unknownfield-type
    content: "Update AI prompt rules: stop forcing rename-only for unknownField without renameHint; allow structural wrapping for type issues and controlled relocation for unknown fields (src/lib/ai/actionPrompts.ts)."
    status: completed
  - id: tests-type-wrap-and-relocation
    content: Add regression unit tests for validateAiFixApply type wrapping and unknown-field relocation, including line-delta allowance (src/lib/validate-bundle/replaceDocument.test.ts).
    status: completed
  - id: tests-prompt-rules
    content: Add prompt rule assertions for unknownField (no renameHint) and type issues (src/lib/ai/actionPrompts.fix.test.ts).
    status: completed
  - id: run-unit-tests
    content: Run `npm run test:unit` and ensure BridgeDomain migration guard behavior is covered by tests.
    status: completed
isProject: false
---

## Goal
Make the AI Fix/Validate workflow reliably handle schema-structure changes (type changes and unknown-field relocations) so your BridgeDomain v1 example becomes valid v2 without manual intervention.

## Root cause analysis (what we will change)
1. **AI Fix guardrails are too strict for structural changes**
   - `validateAiFixApply()` enforces a “minimal structural change” policy and a tight line-delta limit (6) even when the fix only changes under the reported field.
   - This prevents structural conversions like `spec.macLearning: true` → `spec.macLearning: { enabled: true, ... }`.
   - It also prevents unknown-field relocation/moves.
2. **Issue kind inference under-detects “AJV type” errors**
   - `inferIssueKind()` currently doesn’t classify messages like “must be object” as `issueKind: 'type'`, so the AI prompt/guard treat the problem as a generic “other”.
3. **AI prompt rules forbid structural edits for unknown fields**
   - `actionPrompts.ts` hard-codes rename-only behavior for `unknownField` and “FORBIDDEN: adding new keys…” in the minimal rules.
   - That blocks the AI from relocating `macAging` → `macLearning.agingTimeSeconds` or moving `tunnelIndexPool` into `encapOptions.vxlan`.
4. **The fix prompt’s schema scope is insufficient for direct spec children**
   - `buildFixScopedSchemaPrompt()` only includes `parentObjectSchema` when the field path is deeper than 1 segment.
   - For direct children like `spec.tunnelIndexPool`, the prompt doesn’t include the parent schema (`spec`), so the AI has no schema hints for relocation.

## Implementation plan
### 1) Improve issue kind inference for AJV type errors
- **File:** `[src/lib/validate-bundle/fixIssueContext.ts](src/lib/validate-bundle/fixIssueContext.ts)`
- **Change:** Extend `inferIssueKind()` to detect AJV style messages like:
  - “must be object”, “must be array”, “must be string”, “must be boolean”, “must be integer/number”
- **Expected result:** BridgeDomain error `spec.macLearning must be object` becomes `issueKind: 'type'`, enabling type-based prompt + guard allowances.

```18:34:src/lib/validate-bundle/fixIssueContext.ts
export function inferIssueKind(issue: BundleIssue): FixIssueContext['issueKind'] {
  ...
  if (issue.message.includes('Unknown field')) return 'unknownField';
  ...
  if (issue.message.includes('is required')) return 'required';
  if (issue.message.toLowerCase().includes('type')) return 'type';
  return 'other';
}
```

### 2) Relax `validateAiFixApply` guardrails to allow structural edits in-scope
- **File:** `[src/lib/validate-bundle/replaceDocument.ts](src/lib/validate-bundle/replaceDocument.ts)`
- **Change A: line-delta limit should be scope-aware**
  - When the only structural changes are confined under:
    - the reported `fieldPath` subtree (for type fixes), or
    - the `spec` subtree (for unknown-field relocations/removals)
  - Raise the allowed line delta (e.g., from 6 → ~25–40).
- **Change B: unknown-field fixes must be allowed to relocate**
  - Replace the current unknown-field rule “only remove fieldPath” with a safer rule:
    - allow add/modify/remove as long as changes stay under `spec` (never metadata/status)
    - still keep identity constraints (no apiVersion/kind drift for the issue)
- **Change C: type fixes must allow structural conversions**
  - Ensure type issues don’t reject structural diffs that add object keys under the same `fieldPath`.
- **Expected result:** AI can produce the structural v1→v2 conversions you expect.

```450:507:src/lib/validate-bundle/replaceDocument.ts
export function validateAiFixApply(
  originalYaml: string,
  fixedYaml: string,
  issue: Pick<BundleIssue, 'id' | 'fieldPath' | 'message' | 'suggestedFix'>
): { ok: boolean; reason?: string } {
  ...
  const structuralChanges = countStructuralDiff(orig, fixed);
  ...
  const lineDelta = countSignificantLineDelta(originalYaml, fixedYaml);
  if (lineDelta > MAX_UNRELATED_LINE_DELTA) {
    return { ok: false, reason: `AI fix changed too many lines (${lineDelta}); only minimal edits are allowed.` };
  }
  return { ok: true };
}
```

### 3) Update AI prompt so unknown-field fixes can relocate and type fixes can wrap
- **File:** `[src/lib/ai/actionPrompts.ts](src/lib/ai/actionPrompts.ts)`
- **Change A: include `parentObjectSchema` for direct spec children**
  - Update `buildFixScopedSchemaPrompt()` so for `spec.<field>` (depth 1) it includes the `spec` schema as the parent.
- **Change B: unknownField rules should not force “rename only”**
  - For `unknownField` **without** a `renameHint`, instruct the AI:
    - remove the unknown field and/or
    - relocate its value to a schema-valid replacement property
    - preserve the original scalar/list value being moved
- **Change C: relax the “FORBIDDEN: adding new keys…” rule for type/unknownField issues**
  - Keep byte-identical constraints for rename/enum/required, but allow structural wrapping for type errors and structural move for unknown-field fixes.
- **Expected result:** AI prompt stops contradicting the desired structural migration behavior.

```49:90:src/lib/ai/actionPrompts.ts
export function buildFixScopedSchemaPrompt(...): string {
  const segments = fieldPathToSpecSegments(issue.fieldPath);
  const parentSchema =
    schema.specSchema && segments.length > 1
      ? schemaParentAtPath(schema.specSchema, segments)
      : null;
  const leafSchema =
    schema.specSchema && segments.length > 0
      ? schemaAtYamlPath(schema.specSchema, segments)
      : null;
  ...
}
```

### 4) Add regression tests for the exact failure modes
- **File:** `[src/lib/validate-bundle/replaceDocument.test.ts](src/lib/validate-bundle/replaceDocument.test.ts)`
  - Add a test where `validateAiFixApply()` must accept:
    - `spec.macLearning: true` → `spec.macLearning: { enabled: true }` (type structural conversion)
    - `spec.tunnelIndexPool: x` → `spec.encapOptions.vxlan.tunnelIndexPool: x` (unknown-field relocation)
  - Assert the guard passes even when line delta exceeds the old limit.
- **File:** `[src/lib/ai/actionPrompts.fix.test.ts](src/lib/ai/actionPrompts.fix.test.ts)`
  - Add prompt assertions that:
    - unknownField (no renameHint) prompts do not enforce rename-only
    - type prompts do not enforce the “no new keys” prohibition
- **(Optional, if time permits):** add a higher-level `fixAllBundle` integration test with a stub AI fix that returns the expected BridgeDomain v2-shaped YAML, validating that the remaining schema errors drop to zero.

## Validation after changes
1. Run unit tests:
   - `npm run test:unit`
2. Specifically confirm the BridgeDomain example workflow:
   - errors for `apiVersion` deprecated should be fixed by deterministic `apiVersionUpgrade`
   - remaining errors for `macLearning` (type) and `macAging`/`tunnelIndexPool` (unknown field) should be resolvable via AI with the updated guard + prompt
   - `vni`/`vniPool` should remain deterministic (misspelledField rename)

## Acceptance criteria
- `validateAiFixApply()` returns `ok: true` for type wrapping and unknown-field relocation scenarios when structural changes are scoped to `spec`.
- AI prompt no longer forces “rename only” or forbids adding keys for `type` and non-rename-hint `unknownField` issues.
- New/updated tests cover:
  - boolean→object conversion
  - direct-spec unknown-field relocation
  - line-delta regression prevention

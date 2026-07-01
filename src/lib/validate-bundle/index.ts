import { parseBundleResources } from './parser';
import { validateBundleSchema } from './schemaValidator';
import { validateEdaRules } from './edaRules';
import { isK8sStructuralSchemaIssue, validateK8sRules } from './k8sRules';
import type {
	BundleIssue,
	BundleValidationResult,
	BundleValidationSummary,
	ValidateBundleOptions
} from './types';

export * from './types';
export { EXAMPLE_BUNDLE_YAML } from './exampleBundle';
export { firstParseIssueForInput, parseBundleResources, resourceId } from './parser';
export {
	formatYamlBundle,
	applySchemaValueFixes,
	fixApiVersionUpgrade,
	fixDocumentData,
	fixK8sMetadata,
	fixManifestIdentity,
	fixYamlDocuments,
	formatFixSummary,
	type FixKind,
	type FixReport,
	type FixSummary,
	type FixSummaryItem,
	type FormatYamlOptions,
	type SchemaValueFixScope
} from './formatYaml';
export { applySuggestedFix } from './applyIssueFix';
export {
	extractDocumentYaml,
	inferManifestIdentity,
	isParseIssue,
	replaceDocumentInBundle,
	splitRawDocuments,
	validateAiFixApply
} from './replaceDocument';
export { fixAllBundle, isAiUnavailableResult, type AiFixFn, type AiFixResult, type FixAllBundleOptions, type FixAllChange, type FixAllResult } from './fixAllBundle';
export { deriveSuggestedFixForIssue, deriveRelocateFixFromSchema, enrichIssuesWithSuggestedFix } from './schemaSuggestedFix';
export { buildFixIssueContext, inferIssueKind, isDeterministicFixContext, suggestedFixFromFixContext } from './fixIssueContext';
export { bundleDocumentStartLine } from './documentLines';
export {
	buildYamlCompletions,
	buildYamlCompletionContext,
	completionDocumentation,
	schemaKeyForResource,
	schemaKeysForResources,
	yamlPropertyInsertText,
	yamlValueInsertText,
	type YamlCompletionContext,
	type YamlCompletionItem
} from './yamlCompletions';
export {
	resolveYamlFieldContext,
	yamlPathBreadcrumb,
	schemaNodeForKeyParent,
	schemaNodeForValue,
	type YamlFieldContext
} from './yamlFieldContext';
export { buildYamlHoverMarkdown, extractYamlLineKey } from './yamlHover';
export { bundleIssuesToMarkers, type YamlMarkerData } from './yamlMarkers';
export {
	collectSchemaProperties,
	resolveSchemaPropertyKey,
	schemaAtYamlPath,
	schemaLeafMeta,
	type SchemaLeafMeta
} from './schemaNavigation';
export { resolveYamlCursor, specPathFromYamlPath, type YamlCursor } from './yamlCursor';
export {
	buildShareUrl,
	decodeBundleFromUrl,
	encodeBundleForUrl,
	getBundleParamFromSearchParams,
	MAX_BUNDLE_URL_PARAM_BYTES,
	type EncodeBundleResult
} from './shareBundle';

function buildSummary(issues: BundleIssue[], resourceCount: number): BundleValidationSummary {
	return {
		resourceCount,
		errorCount: issues.filter((i) => i.severity === 'error').length,
		warningCount: issues.filter((i) => i.severity === 'warning').length,
		infoCount: issues.filter((i) => i.severity === 'info').length
	};
}

export async function validateBundle(options: ValidateBundleOptions): Promise<BundleValidationResult> {
	const { yamlInput, releaseFolder, releaseLabel, manifest } = options;

	if (!yamlInput.trim()) {
		return {
			valid: true,
			issues: [],
			summary: { resourceCount: 0, errorCount: 0, warningCount: 0, infoCount: 0 },
			resources: []
		};
	}

	const parsed = parseBundleResources(yamlInput);
	const { resources } = parsed;

	const parseIssues: BundleIssue[] = parsed.parseErrors.map((err, index) => ({
		id: `parse-${index + 1}`,
		severity: 'error',
		category: 'schema',
		message: err.message,
		docIndex: err.docIndex,
		line: err.line
	}));

	if (!parsed.ok && resources.length === 0) {
		const issues = parseIssues.length > 0 ? parseIssues : [
			{
				id: 'parse-1',
				severity: 'error' as const,
				category: 'schema' as const,
				message: parsed.message,
				line: parsed.line
			}
		];
		return {
			valid: false,
			issues,
			summary: buildSummary(issues, 0),
			resources: []
		};
	}

	const k8sIssues = validateK8sRules(resources);
	const schemaIssues = (
		await validateBundleSchema(yamlInput, resources, releaseFolder, releaseLabel, manifest)
	).filter((issue) => !isK8sStructuralSchemaIssue(issue));
	const edaIssues = validateEdaRules(resources);

	const issues = [...parseIssues, ...k8sIssues, ...schemaIssues, ...edaIssues];
	const summary = buildSummary(issues, resources.length);
	const valid = summary.errorCount === 0;

	return {
		valid,
		issues,
		summary,
		resources
	};
}

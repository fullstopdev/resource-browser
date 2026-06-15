import {
	questionAsksExampleYaml,
	questionAsksRequiredFields,
	questionMentionsCrossRelease,
	questionMentionsFieldPath
} from './resolveAskTargets';

export type AskQuestionIntent =
	| 'required_fields'
	| 'example_yaml'
	| 'relationships'
	| 'field_detail'
	| 'compare'
	| 'overview'
	| 'general';

const OVERVIEW_PATTERNS = [
	/\bwhat\s+is\s+(?:a|an|the)?\s*[\w-]+/i,
	/\bdescribe\s+(?:the\s+)?[\w-]+/i,
	/\boverview\s+of\b/i,
	/\bpurpose\s+of\b/i,
	/\bhow\s+(?:does|do)\s+[\w-]+\s+work\b/i
];

export function questionAsksOverview(question: string): boolean {
	return OVERVIEW_PATTERNS.some((p) => p.test(question));
}

const RELATIONSHIP_PATTERNS = [
	/\b(?:relate|relationship|depends?\s+on|used\s+by|references?|connects?\s+to)\b/i,
	/\bhow\s+does\b.+\b(?:relate|connect|work\s+with)\b/i,
	/\bwhat\s+(?:crds?|resources?)\s+(?:does|do)\b.+\b(?:use|require|depend)\b/i
];

export function questionAsksRelationships(question: string): boolean {
	return RELATIONSHIP_PATTERNS.some((p) => p.test(question));
}

/** Classify free-form Ask AI question intent for context assembly and prompts. */
export function classifyQuestionIntent(question: string): AskQuestionIntent {
	if (questionMentionsCrossRelease(question)) return 'compare';
	if (questionAsksRequiredFields(question)) return 'required_fields';
	if (questionAsksExampleYaml(question)) return 'example_yaml';
	if (questionMentionsFieldPath(question)) return 'field_detail';
	if (questionAsksRelationships(question)) return 'relationships';
	if (questionAsksOverview(question)) return 'overview';
	return 'general';
}

/** KV cache actions to load for a given intent (always includes full-context when warmed). */
export function kvActionsForIntent(intent: AskQuestionIntent): string[] {
	switch (intent) {
		case 'required_fields':
			return ['full-context', 'schema-summary', 'explain'];
		case 'example_yaml':
			return ['full-context', 'example', 'schema-summary'];
		case 'relationships':
			return ['full-context', 'relationships', 'dependency-map', 'schema-summary', 'explain'];
		case 'field_detail':
			return ['full-context', 'schema-summary', 'explain'];
		case 'compare':
			return ['full-context', 'schema-summary', 'explain'];
		case 'general':
		default:
			return ['full-context', 'schema-summary', 'explain'];
	}
}

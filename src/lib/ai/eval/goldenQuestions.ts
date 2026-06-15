export type GoldenQuestion = {
	label: string;
	question: string;
	expectedKind?: string;
	maxTargets?: number;
	minConfidence?: 'high' | 'medium' | 'low';
};

/** Regression suite for Global Ask AI target resolution. */
export const GOLDEN_ASK_QUESTIONS: GoldenQuestion[] = [
	{
		label: 'Policy CRD disambiguation',
		question: 'What is the Policy CRD in 26.4.2?',
		expectedKind: 'Policy',
		maxTargets: 1,
		minConfidence: 'high'
	},
	{
		label: 'Interface required fields',
		question: 'Required fields for Interface in 26.4.2?',
		expectedKind: 'Interface',
		maxTargets: 3,
		minConfidence: 'high'
	},
	{
		label: 'Fabric example YAML',
		question: 'Example YAML for a Fabric in 26.4.2?',
		expectedKind: 'Fabric',
		maxTargets: 3,
		minConfidence: 'medium'
	},
	{
		label: 'Fabric topology relationship',
		question: 'How does Fabric relate to Topology in 26.4.2?',
		expectedKind: 'Fabric',
		maxTargets: 5,
		minConfidence: 'medium'
	},
	{
		label: 'Routing policy catalog',
		question: 'What Policy CRDs exist for routing in 26.4.2?',
		maxTargets: 10,
		minConfidence: 'medium'
	}
];

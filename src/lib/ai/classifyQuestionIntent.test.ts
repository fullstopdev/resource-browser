import { describe, expect, it } from 'vitest';
import {
	classifyQuestionIntent,
	questionAsksRelationships
} from './classifyQuestionIntent';

describe('classifyQuestionIntent', () => {
	it('detects required fields intent', () => {
		expect(classifyQuestionIntent('Required fields for Interface in 26.4.2?')).toBe(
			'required_fields'
		);
	});

	it('detects example YAML intent', () => {
		expect(classifyQuestionIntent('Example YAML for a Fabric in 26.4.2?')).toBe('example_yaml');
	});

	it('detects relationships intent', () => {
		expect(questionAsksRelationships('How does Fabric relate to Topology in 26.4.2?')).toBe(
			true
		);
		expect(classifyQuestionIntent('How does Fabric relate to Topology in 26.4.2?')).toBe(
			'relationships'
		);
	});

	it('defaults to overview', () => {
		expect(classifyQuestionIntent('What is the Policy CRD in 26.4.2?')).toBe('overview');
	});
});

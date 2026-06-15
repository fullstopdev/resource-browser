import { describe, expect, it } from 'vitest';
import {
	ASK_AI_MODEL,
	extractWorkersAIText,
	WORKERS_AI_MODEL,
	workersAIErrorMessage,
	WorkersAIEmptyResponseError,
	workersAIErrorResponse
} from './runWorkersAI';

describe('runWorkersAI helpers', () => {
	it('uses the active fast llama model for cache warming', () => {
		expect(WORKERS_AI_MODEL).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
	});

	it('uses llama 3.3 70B for Ask AI', () => {
		expect(ASK_AI_MODEL).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
	});

	it('extractWorkersAIText reads legacy response field', () => {
		expect(extractWorkersAIText({ response: 'Hello.' })).toBe('Hello.');
	});

	it('extractWorkersAIText reads chat choices content', () => {
		expect(
			extractWorkersAIText({
				choices: [{ message: { role: 'assistant', content: '## Overview\nPolicy routes traffic.' } }]
			})
		).toBe('## Overview\nPolicy routes traffic.');
	});

	it('extractWorkersAIText returns empty for blank output', () => {
		expect(extractWorkersAIText({ response: '   ' })).toBe('');
		expect(extractWorkersAIText({ choices: [{ message: { content: null } }] })).toBe('');
	});

	it('workersAIErrorMessage surfaces deprecated model errors', () => {
		const msg = workersAIErrorMessage(
			new Error('AiError: Model has been deprecated: @cf/meta/llama-3.1-8b-instruct')
		);
		expect(msg).toContain('deprecated');
	});

	it('workersAIErrorMessage handles empty response error', () => {
		expect(workersAIErrorMessage(new WorkersAIEmptyResponseError())).toContain('empty');
	});

	it('workersAIErrorResponse returns API message for LLM failures', () => {
		const { status, error } = workersAIErrorResponse(
			new Error('AiError: Model has been deprecated')
		);
		expect(status).toBe(500);
		expect(error).toContain('deprecated');
	});
});

import { describe, expect, it, vi } from 'vitest';
import {
	extractWorkersAIText,
	FIX_AI_MODEL,
	runWorkersAIMessages,
	selectFixModel,
	selectFixMaxTokens,
	WORKERS_AI_MODEL,
	workersAIErrorMessage,
	WorkersAIEmptyResponseError,
	workersAIErrorResponse
} from './runWorkersAI';

describe('runWorkersAI helpers', () => {
	it('uses llama 3.1 fast for scoped fixes and 3.3 only for complex issues', () => {
		expect(WORKERS_AI_MODEL).toBe('@cf/meta/llama-3.1-8b-instruct-fast');
		expect(FIX_AI_MODEL).toBe('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
		expect(selectFixModel('syntax')).toBe(WORKERS_AI_MODEL);
		expect(selectFixModel('enum')).toBe(WORKERS_AI_MODEL);
		expect(selectFixModel('misspelledField')).toBe(WORKERS_AI_MODEL);
		expect(selectFixModel('type', { fieldPath: 'spec.os' })).toBe(WORKERS_AI_MODEL);
		expect(selectFixModel('type', { fieldPath: 'spec.macLearning.enabled' })).toBe(FIX_AI_MODEL);
		expect(
			selectFixModel('unknownField', {
				relocationHint: { from: 'a', to: 'b' },
				fieldPath: 'spec.tunnelIndexPool'
			})
		).toBe(WORKERS_AI_MODEL);
		expect(
			selectFixModel('unknownField', {
				relocationHint: { from: 'a', to: 'b' },
				fieldPath: 'spec.encapOptions.vxlan.tunnelIndexPool'
			})
		).toBe(FIX_AI_MODEL);
		expect(selectFixModel('unknownField')).toBe(FIX_AI_MODEL);
		expect(selectFixModel('other')).toBe(FIX_AI_MODEL);
		expect(selectFixModel('unknownField', { batched: true })).toBe(FIX_AI_MODEL);
	});

	it('selectFixMaxTokens scales by issue complexity', () => {
		expect(selectFixMaxTokens('enum')).toBe(768);
		expect(selectFixMaxTokens('unknownField')).toBe(1536);
		expect(selectFixMaxTokens('unknownField', { batched: true })).toBe(2048);
	});

	it('blocks Workers AI in CI unless WORKERS_AI_ALLOW is set', async () => {
		const prevCi = process.env.CI;
		const prevAllow = process.env.WORKERS_AI_ALLOW;
		process.env.CI = 'true';
		delete process.env.WORKERS_AI_ALLOW;

		const ai = {
			run: vi.fn()
		} as unknown as Ai;

		await expect(
			runWorkersAIMessages(ai, [{ role: 'user', content: 'test' }])
		).rejects.toThrow(/disabled during tests and CI/);

		process.env.WORKERS_AI_ALLOW = '1';
		(ai.run as ReturnType<typeof vi.fn>).mockResolvedValue({ response: 'ok' });
		await expect(
			runWorkersAIMessages(ai, [{ role: 'user', content: 'test' }])
		).resolves.toBe('ok');

		if (prevCi === undefined) delete process.env.CI;
		else process.env.CI = prevCi;
		if (prevAllow === undefined) delete process.env.WORKERS_AI_ALLOW;
		else process.env.WORKERS_AI_ALLOW = prevAllow;
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

import { fixRetryMessage, type ActionPrompt } from './actionPrompts';
import { parseFixResponse, type ParsedFixResponse } from './parseFixResponse';
import type { AiMessage, AiModels } from './runWorkersAI';
import type { FixVerdict } from './verifyFix';

export type FixModelRunner = (model: string, messages: AiMessage[]) => Promise<string>;

export type VerifiedFixResult = {
	answer: string;
	explanation: string;
	fixable: boolean;
	/** Full corrected document; only set when the fix passed verification. */
	fixedYaml?: string;
	verified: boolean;
	attempts: number;
	model: string;
	/** Why the last candidate was rejected, when no verified fix came out. */
	rejectReason?: string;
};

/**
 * Ask the model for a fix and only accept one that passes server-side verification. A failed or
 * unparseable first answer gets one retry on the larger model; after a verification failure the
 * retry sees its rejected answer plus the validator's reason.
 */
export async function runVerifiedFix(params: {
	prompt: ActionPrompt;
	models: AiModels;
	initialModel: string;
	run: FixModelRunner;
	/** Turns the model's YAML into the full document (splices excerpt answers back in). */
	toFullDocument: (fixedYaml: string) => string;
	verify: (fixedDoc: string) => FixVerdict;
	/** Answer parser; defaults to the FIXABLE / EXPLANATION / FIXED_YAML format. */
	parse?: (answer: string) => ParsedFixResponse;
	/**
	 * Model for the second attempt. Defaults to the larger fix model; one-line fixes retry on the
	 * same small model instead (the 70B model costs about 13 times as many neurons).
	 */
	retryModel?: string;
}): Promise<VerifiedFixResult> {
	const { prompt, models, initialModel, run, toFullDocument, verify } = params;
	const parse = params.parse ?? parseFixResponse;
	const retryModel = params.retryModel ?? models.fix;
	const baseMessages: AiMessage[] = [
		{ role: 'system', content: prompt.system },
		{ role: 'user', content: prompt.user }
	];

	let model = initialModel;
	let messages = baseMessages;
	let rejectReason: string | undefined;
	let last = { answer: '', explanation: '' };
	let attempts = 0;

	for (let attempt = 1; attempt <= 2; attempt++) {
		attempts = attempt;
		const answer = await run(model, messages);
		const parsed = parse(answer);
		last = { answer, explanation: parsed.explanation };

		if (parsed.fixable && parsed.fixedYaml) {
			const fixedDoc = toFullDocument(parsed.fixedYaml);
			const verdict = verify(fixedDoc);
			if (verdict.ok) {
				return {
					answer,
					explanation: parsed.explanation,
					fixable: true,
					fixedYaml: fixedDoc,
					verified: true,
					attempts: attempt,
					model
				};
			}
			rejectReason = verdict.reason;
			messages = [
				...baseMessages,
				{ role: 'assistant', content: answer },
				{ role: 'user', content: fixRetryMessage(verdict.reason) }
			];
		} else if (parsed.fixable && params.parse) {
			// A one-line change that could not be placed in the document: say so and retry.
			rejectReason = 'The CHANGE line could not be applied (check the field path).';
			messages = [
				...baseMessages,
				{ role: 'assistant', content: answer },
				{ role: 'user', content: fixRetryMessage(rejectReason) }
			];
		} else {
			// Not fixable or unparseable: a declared "no" from the retry model is final.
			rejectReason = parsed.fixable ? 'The answer had no YAML block.' : undefined;
			if (model === retryModel) break;
			messages = baseMessages;
		}
		model = retryModel;
	}

	return {
		answer: last.answer,
		explanation: rejectReason
			? `The AI could not produce a fix that passes validation (${rejectReason}).`
			: last.explanation,
		fixable: false,
		verified: false,
		attempts,
		model: attempts > 1 ? retryModel : initialModel,
		...(rejectReason ? { rejectReason } : {})
	};
}

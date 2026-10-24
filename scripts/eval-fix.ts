/**
 * AI Fix quality eval: sends every case in src/lib/ai/eval/fixCases.ts to /api/ai (action=fix)
 * and checks the returned document independently. Uses real Workers AI quota on cache misses.
 *
 *   npm run eval:fix -- --base-url http://localhost:8788
 *   npm run eval:fix -- --base-url https://eda-resource-browser.pages.dev --only enum
 *
 *   npm run eval:fix -- --base-url https://<preview>.eda-resource-browser.pages.dev --min-pass 0.85
 *
 * Env: HTTPS_PROXY / NODE_EXTRA_CA_CERTS (corporate proxy), EVAL_CONCURRENCY (default 2).
 * Exits 1 when the pass rate is below --min-pass (default 1, every case). With GITHUB_STEP_SUMMARY
 * set (GitHub Actions), also writes a results table there.
 */
import fs from 'fs';
import yaml from 'js-yaml';
import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { FIX_EVAL_CASES, FIX_EVAL_RELEASE, type FixEvalCase } from '../src/lib/ai/eval/fixCases';

type CaseResult = {
	id: string;
	ok: boolean;
	status: number;
	verified: boolean;
	cached: boolean;
	attempts?: number;
	model?: string;
	ms: number;
	note: string;
};

function configureFetchDispatcher(): void {
	const proxyUrl = process.env.HTTPS_PROXY?.trim() || process.env.https_proxy?.trim();
	const extraCaPath = process.env.NODE_EXTRA_CA_CERTS?.trim();
	const ca = extraCaPath ? fs.readFileSync(extraCaPath) : undefined;
	if (proxyUrl) {
		setGlobalDispatcher(
			new ProxyAgent({ uri: proxyUrl, ...(ca ? { requestTls: { ca }, proxyTls: { ca } } : {}) })
		);
	}
}

function argValue(name: string): string | undefined {
	const args = process.argv.slice(2);
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1]?.trim() : undefined;
}

async function runCase(baseUrl: string, c: FixEvalCase): Promise<CaseResult> {
	const started = Date.now();
	const res = await fetch(`${baseUrl}/api/ai`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', origin: baseUrl },
		body: JSON.stringify({
			release: FIX_EVAL_RELEASE,
			kind: c.kind,
			group: c.group,
			action: 'fix',
			userYaml: c.yaml,
			issue: {
				message: c.message,
				fieldPath: c.fieldPath,
				issueKind: c.issueKind,
				severity: 'error'
			}
		})
	});
	const ms = Date.now() - started;
	const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	const base = {
		id: c.id,
		status: res.status,
		verified: body.verified === true,
		cached: body.cached === true,
		attempts: typeof body.attempts === 'number' ? body.attempts : undefined,
		model: typeof body.model === 'string' ? body.model : undefined,
		ms
	};

	if (!res.ok) return { ...base, ok: false, note: String(body.error ?? 'request failed') };
	if (!body.fixable || typeof body.fixedYaml !== 'string') {
		return {
			...base,
			ok: false,
			note: `not fixed: ${String(body.explanation ?? '').slice(0, 90)}`
		};
	}

	let fixed: unknown;
	try {
		fixed = yaml.load(body.fixedYaml);
	} catch (err) {
		return { ...base, ok: false, note: `fixed YAML does not parse: ${(err as Error).message}` };
	}
	if (!fixed || typeof fixed !== 'object')
		return { ...base, ok: false, note: 'fixed YAML is not an object' };

	const problem = c.check(fixed as Record<string, unknown>);
	return { ...base, ok: problem === null, note: problem ?? '' };
}

function writeStepSummary(baseUrl: string, results: CaseResult[], rate: number): void {
	const file = process.env.GITHUB_STEP_SUMMARY;
	if (!file) return;
	const rows = results.map(
		(r) =>
			`| ${r.ok ? '✅' : '❌'} | \`${r.id}\` | ${r.status} | ${r.ms} | ${r.cached ? 'cached' : (r.attempts ?? '?')} | ${r.note.replace(/\|/g, '\\|')} |`
	);
	fs.appendFileSync(
		file,
		[
			`## AI Fix eval — ${Math.round(rate * 100)}% (${results.filter((r) => r.ok).length}/${results.length})`,
			'',
			`Target: ${baseUrl}, release ${FIX_EVAL_RELEASE}`,
			'',
			'| | Case | HTTP | ms | Tries | Note |',
			'| --- | --- | --- | --- | --- | --- |',
			...rows,
			''
		].join('\n')
	);
}

async function main(): Promise<void> {
	configureFetchDispatcher();
	const baseUrl = (argValue('--base-url') ?? 'http://localhost:8788').replace(/\/$/, '');
	const only = argValue('--only');
	const concurrency = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 2));
	const cases = FIX_EVAL_CASES.filter((c) => !only || c.id.includes(only) || c.issueKind === only);

	console.log(
		`AI Fix eval: ${cases.length} cases against ${baseUrl} (release ${FIX_EVAL_RELEASE})\n`
	);
	const results: CaseResult[] = [];
	for (let i = 0; i < cases.length; i += concurrency) {
		const batch = await Promise.all(
			cases.slice(i, i + concurrency).map((c) =>
				runCase(baseUrl, c).catch((err): CaseResult => ({
					id: c.id,
					ok: false,
					status: 0,
					verified: false,
					cached: false,
					ms: 0,
					note: (err as Error).message
				}))
			)
		);
		for (const r of batch) {
			console.log(
				`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(38)} ${String(r.status).padStart(3)}  ${String(r.ms).padStart(6)}ms  ${r.cached ? 'cached' : `${r.attempts ?? '?'} try`}  ${r.note}`
			);
		}
		results.push(...batch);
	}

	const passed = results.filter((r) => r.ok).length;
	const fresh = results.filter((r) => !r.cached && r.status === 200);
	const avgMs = fresh.length ? Math.round(fresh.reduce((s, r) => s + r.ms, 0) / fresh.length) : 0;
	const retried = fresh.filter((r) => (r.attempts ?? 1) > 1).length;
	console.log(
		`\n${passed}/${results.length} passed (${Math.round((passed / Math.max(1, results.length)) * 100)}%) · ` +
			`${fresh.length} uncached, avg ${avgMs}ms, ${retried} needed a retry`
	);
	const minPass = Number(argValue('--min-pass') ?? 1);
	const rate = passed / Math.max(1, results.length);
	writeStepSummary(baseUrl, results, rate);
	if (rate < minPass) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});

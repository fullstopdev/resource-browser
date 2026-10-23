/**
 * Validate YAML manifests against one release's CRD schemas, from the command line — the same
 * checks as the Validate YAML page.
 *
 *   npm run validate:yaml -- --release 26.8.2 path/to/manifests.yaml
 *   cat example.yaml | npm run validate:yaml -- --release 26.8.2 -
 *
 * Exits 1 when any error is reported (warnings and info don't fail).
 */
import fsPromises from 'fs/promises';
import path from 'path';
import { validateBundle } from '../src/lib/validate-bundle/index';

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1]?.trim() : undefined;
}

async function readInput(file: string): Promise<string> {
	if (file !== '-') return fsPromises.readFile(file, 'utf8');
	const chunks: Buffer[] = [];
	for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
	return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<void> {
	const release = arg('--release');
	const file = process.argv
		.slice(2)
		.filter((a, i, all) => all[i - 1] !== '--release' && a !== '--release')
		.pop();
	if (!release || !file) throw new Error('Usage: validate:yaml -- --release 26.8.2 <file.yaml|->');

	const releaseFolder = `resources/${release}`;
	const manifest = JSON.parse(
		await fsPromises.readFile(`static/${releaseFolder}/manifest.json`, 'utf8')
	);
	// The validator fetches schemas by site path; serve them from static/ like the deployed site.
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		try {
			return new Response(await fsPromises.readFile(path.join('static', String(input)), 'utf8'));
		} catch {
			return new Response(null, { status: 404 });
		}
	}) as typeof fetch;

	const result = await validateBundle({
		yamlInput: await readInput(file),
		releaseFolder,
		releaseLabel: `EDA ${release}`,
		manifest
	});
	for (const issue of result.issues) {
		const where = [
			issue.docIndex ? `doc ${issue.docIndex}` : '',
			issue.line ? `L${issue.line}` : ''
		]
			.filter(Boolean)
			.join(' ');
		console.log(`${issue.severity.toUpperCase().padEnd(7)} ${where.padEnd(10)} ${issue.message}`);
	}
	const { errorCount, warningCount, infoCount } = result.summary;
	console.log(
		`\n${result.summary.resourceCount} document(s): ${errorCount} error(s), ${warningCount} warning(s), ${infoCount} info`
	);
	if (errorCount > 0) process.exitCode = 1;
}

main().catch((err) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(2);
});

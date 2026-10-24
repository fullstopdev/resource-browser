import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPathBrowserData } from './pathBrowser';
import { sanitizeSpecForDisplay } from './sanitizeSpecForDisplay';
import { buildApiSections, findAction } from './apiReference';
import { actionDescription, requestBodyExample, responseExample, sentence } from './apiExamples';

const RELEASE = 'static/openapi/26.8.2';
const manifest = JSON.parse(readFileSync(`${RELEASE}/manifest.json`, 'utf8')) as Array<{
	id: string;
	file: string;
}>;

function load(id: string) {
	const entry = manifest.find((e) => e.id === id)!;
	const spec = sanitizeSpecForDisplay(JSON.parse(readFileSync(`${RELEASE}/${entry.file}`, 'utf8')));
	const sections = buildApiSections(
		buildPathBrowserData(spec).tagGroups.flatMap((g) => g.operations)
	);
	return { spec, sections };
}

describe('API examples', () => {
	it('uses the docs example for a BridgeDomain create body', () => {
		const { spec, sections } = load('services.eda.nokia.com/v2');
		const hit = findAction(sections, 'createServicesEdaNokiaComV2NamespaceBridgedomains')!;
		hit.section.title = 'BridgeDomain';
		const body = JSON.parse(requestBodyExample(hit.section, hit.action, spec)!.text);
		expect(body).toMatchObject({
			apiVersion: 'services.eda.nokia.com/v2',
			kind: 'BridgeDomain',
			metadata: { name: 'my-bridge-domain', namespace: 'eda' },
			spec: { type: 'EVPNVXLAN', eviPool: 'evi-pool' }
		});
		expect(body.status).toBeUndefined();
	});

	it('keeps only required fields, with realistic values, without a docs example', () => {
		const { spec, sections } = load('oam.eda.nokia.com/v1');
		const ping = sections.find((s) => s.plural === 'pings')!;
		const run = ping.actions.find((a) => a.key === 'run')!;
		const body = JSON.parse(requestBodyExample(ping, run, spec)!.text);
		expect(body.spec).toEqual({ address: '192.0.2.1' });
		expect(JSON.stringify(body)).not.toContain('"string"');
	});

	it('shows a transaction that creates a resource as a dry run', () => {
		const { spec, sections } = load('core');
		const hit = findAction(sections, 'transPostTransaction')!;
		const body = JSON.parse(requestBodyExample(hit.section, hit.action, spec)!.text);
		expect(body.dryRun).toBe(true);
		expect(body.crs[0].type.create.value.kind).toBe('BridgeDomain');
	});

	it('gives response examples without "string" placeholders', () => {
		const { spec, sections } = load('services.eda.nokia.com/v2');
		const hit = findAction(sections, 'readServicesEdaNokiaComV2NamespaceBridgedomains')!;
		const response = responseExample(hit.action, spec)!;
		expect(response.status).toBe('200');
		expect(response.text).not.toContain('"string"');
	});

	it('writes sentences: capitalised, with the right article', () => {
		expect(sentence('create a AccountingPolicy')).toBe('Create an AccountingPolicy.');
		const { sections } = load('services.eda.nokia.com/v2');
		const hit = findAction(sections, 'createServicesEdaNokiaComV2NamespaceIrbinterfaces')!;
		hit.section.title = 'IRBInterface';
		expect(actionDescription(hit.action, hit.section)).toMatch(/^Creates an IRBInterface\./);
	});
});

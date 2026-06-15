import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { parseBundleResources } from './parser';
import { buildYamlCompletions } from './yamlCompletions';
import { resolveYamlCursor, specPathFromYamlPath } from './yamlCursor';
import type { YamlCompletionContext } from './yamlCompletions';

const MANIFEST = JSON.parse(
	readFileSync(resolve(process.cwd(), 'static/resources/26.4.2/manifest.json'), 'utf8')
);

function topologyCtx(): YamlCompletionContext {
	const text = readFileSync(
		resolve(process.cwd(), 'static/resources/26.4.2/topologies.topologies.eda.nokia.com/v1.yaml'),
		'utf8'
	);
	const spec = loadStaticYaml(text).schema?.openAPIV3Schema?.properties?.spec;
	const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab-topology
  namespace: eda
spec:
  enabled: true
`;
	const parsed = parseBundleResources(yaml);
	return {
		releaseFolder: 'resources/26.4.2',
		manifest: MANIFEST,
		resources: parsed.resources,
		schemas: new Map([
			['/resources/26.4.2/topologies.topologies.eda.nokia.com/v1.yaml', { spec, isSpecRequired: true }]
		])
	};
}

const SPEC_HEADER = `apiVersion: topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab-topology
  namespace: eda
spec:
`;

describe('spec key-mode completions (sibling keys)', () => {
	const ctx = topologyCtx();

	it('suggests spec sibling keys when typing partial key on new line', () => {
		const yaml = `${SPEC_HEADER}  enabled: true
  over`;
		const line = yaml.split('\n').length;
		const col = yaml.split('\n').pop()!.length + 1;
		const cursor = resolveYamlCursor(yaml, line, col);
		expect(cursor?.completionKind).toBe('key');
		expect(specPathFromYamlPath(cursor!.yamlPath)).toEqual([]);
		const labels = buildYamlCompletions(yaml, line, col, ctx).map((i) => i.label);
		expect(labels).toContain('overlays');
	});

	it('keeps key mode on the colon while editing overlays', () => {
		const yaml = `${SPEC_HEADER}  enabled: true
  overlays:`;
		const line = yaml.split('\n').length;
		const lineText = yaml.split('\n').pop()!;
		const colonCol = lineText.indexOf(':') + 1;
		const cursor = resolveYamlCursor(yaml, line, colonCol);
		expect(cursor?.completionKind).toBe('key');
		expect(cursor?.valuePrefix).toBe('');
		const labels = buildYamlCompletions(yaml, line, colonCol, ctx).map((i) => i.label);
		expect(labels).toContain('enabled');
		expect(labels).toContain('overlays');
		expect(labels).toContain('uiName');
	});

	it('suggests overlay item keys when nested under overlays without a dash line', () => {
		const yaml = `${SPEC_HEADER}  overlays:
    en`;
		const line = yaml.split('\n').length;
		const col = yaml.split('\n').pop()!.length + 1;
		const cursor = resolveYamlCursor(yaml, line, col);
		expect(cursor?.completionKind).toBe('key');
		const labels = buildYamlCompletions(yaml, line, col, ctx).map((i) => i.label);
		expect(labels).toContain('enabled');
	});

	it('suggests spec sibling keys on empty indented line under spec', () => {
		const yaml = `${SPEC_HEADER}  `;
		const line = yaml.split('\n').length;
		const cursor = resolveYamlCursor(yaml, line, 3);
		expect(cursor?.completionKind).toBe('key');
		expect(specPathFromYamlPath(cursor!.yamlPath)).toEqual([]);
		const labels = buildYamlCompletions(yaml, line, 3, ctx).map((i) => i.label);
		expect(labels).toContain('enabled');
		expect(labels).toContain('overlays');
		expect(labels).toContain('uiName');
	});

	it('suggests sibling keys before colon when editing overlays key name', () => {
		const yaml = `${SPEC_HEADER}  enabled: true
  overlays`;
		const line = yaml.split('\n').length;
		const col = 2 + 'overlays'.length; // cursor before colon
		const cursor = resolveYamlCursor(yaml, line, col);
		expect(cursor?.completionKind).toBe('key');
		expect(specPathFromYamlPath(cursor!.yamlPath)).toEqual([]);
		const labels = buildYamlCompletions(yaml, line, col, ctx).map((i) => i.label);
		expect(labels).toContain('overlays');
	});

	it('after overlays: suggests overlay item keys not spec siblings', () => {
		const yaml = `${SPEC_HEADER}  overlays:`;
		const line = yaml.split('\n').length;
		const lineText = yaml.split('\n').pop()!;
		// Cursor past the colon in the value region
		const col = lineText.length + 1;
		const cursor = resolveYamlCursor(yaml, line, col);
		expect(cursor?.completionKind).toBe('value');
		expect(specPathFromYamlPath(cursor!.yamlPath)).toEqual(['overlays']);
		const labels = buildYamlCompletions(yaml, line, col, ctx).map((i) => i.label);
		expect(labels).not.toContain('uiName');
		expect(labels).toContain('key');
	});
});

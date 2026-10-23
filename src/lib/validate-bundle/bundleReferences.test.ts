import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '$lib/dependency-map/types';
import { checkBundleReferences } from './bundleReferences';
import { parseBundleResources } from './parser';

const RELEASE = 'static/resources/26.8.2';

const BUNDLE = `apiVersion: services.eda.nokia.com/v2
kind: BridgeDomain
metadata:
  name: bd-blue
  namespace: eda
spec:
  type: EVPNVXLAN
---
apiVersion: services.eda.nokia.com/v2
kind: BridgeInterface
metadata:
  name: bi-1
  namespace: eda
spec:
  bridgeDomain: bd-blue
  interface: leaf1-ethernet-1-1
---
apiVersion: services.eda.nokia.com/v2
kind: BridgeInterface
metadata:
  name: bi-2
  namespace: other
spec:
  bridgeDomain: bd-blue
  interface: leaf1-ethernet-1-2
`;

describe('checkBundleReferences (real 26.8.2 graph)', async () => {
	const graph = JSON.parse(
		await readFile(`${RELEASE}/dependency-graph.json`, 'utf8')
	) as DependencyGraph;
	const manifest = JSON.parse(await readFile(`${RELEASE}/manifest.json`, 'utf8'));

	it('notes references to resources missing from the bundle, per namespace', () => {
		const parsed = parseBundleResources(BUNDLE);
		if (!parsed.ok) throw new Error('parse failed');
		const notes = checkBundleReferences(parsed.resources, manifest, graph);
		const messages = notes.map((n) => `${n.docIndex}:${n.fieldPath}:${n.severity}`);

		// bd-blue exists in namespace eda: no note for bi-1's bridgeDomain…
		expect(messages).not.toContain('2:spec.bridgeDomain:info');
		// …but bi-2 is in namespace "other", where bd-blue doesn't exist.
		expect(messages).toContain('3:spec.bridgeDomain:info');
		// Interfaces aren't in the bundle at all.
		expect(messages).toContain('2:spec.interface:info');
		expect(notes.every((n) => n.severity === 'info' && n.rule === 'missing-reference')).toBe(true);
	});

	it('does nothing without a graph', () => {
		const parsed = parseBundleResources(BUNDLE);
		if (!parsed.ok) throw new Error('parse failed');
		expect(checkBundleReferences(parsed.resources, manifest, null)).toEqual([]);
	});
});

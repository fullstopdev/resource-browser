import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import type { DependencyGraph } from '$lib/dependency-map/types';
import {
	formatDependencyMapForKv,
	sliceDependencyMapForTargets
} from './formatDependencyMap';

const graph = JSON.parse(
	readFileSync('static/resources/26.4.2/dependency-graph.json', 'utf8')
) as DependencyGraph;

describe('formatDependencyMapForKv', () => {
	it('formats release topology with edge lines', () => {
		const text = formatDependencyMapForKv(graph, '26.4.2');
		expect(text).toContain('## EDA release dependency map — 26.4.2');
		expect(text).toContain('312 CRDs');
		expect(text).toContain('Fabric (fabrics.eda.nokia.com)');
		expect(text.split('\n').filter((l) => l.startsWith('- **')).length).toBeGreaterThan(100);
	});

	it('slices map to target kinds and neighbors', () => {
		const full = formatDependencyMapForKv(graph, '26.4.2');
		const sliced = sliceDependencyMapForTargets(full, [{ kind: 'Fabric' }], 20_000);
		expect(sliced).toContain('Fabric (fabrics.eda.nokia.com)');
		expect(sliced.length).toBeLessThan(full.length);
		expect(sliced).toContain('Showing');
	});
});

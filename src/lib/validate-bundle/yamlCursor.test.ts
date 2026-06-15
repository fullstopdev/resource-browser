import { describe, expect, it } from 'vitest';
import { resolveYamlCursor, specPathFromYamlPath } from './yamlCursor';

const FABRIC_SNIPPET = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
  leafs:
    asnPool: asn-pool
    leafNodeSelectors:
      - eda.nokia.com/role=leaf
`;

describe('resolveYamlCursor', () => {
	it('resolves value completion at spec.leafs.asnPool', () => {
		const lines = FABRIC_SNIPPET.split('\n');
		const line = lines.findIndex((l) => l.includes('asnPool:')) + 1;
		const column = lines[line - 1]!.indexOf('asn-pool') + 1;

		const cursor = resolveYamlCursor(FABRIC_SNIPPET, line, column);
		expect(cursor).toBeTruthy();
		expect(cursor!.completionKind).toBe('value');
		expect(specPathFromYamlPath(cursor!.yamlPath)).toEqual(['leafs', 'asnPool']);
	});

	it('resolves key completion under spec.leafs', () => {
		const lines = FABRIC_SNIPPET.split('\n');
		const leafsLine = lines.findIndex((l) => l.trim() === 'leafs:') + 1;
		const insertLine = leafsLine + 2;
		const yaml = `${FABRIC_SNIPPET.split('\n').slice(0, insertLine).join('\n')}\n    leaf`;
		const cursor = resolveYamlCursor(yaml, insertLine + 1, 9);
		expect(cursor?.completionKind).toBe('key');
		expect(specPathFromYamlPath(cursor!.yamlPath)).toEqual(['leafs']);
	});

	it('tracks document index across --- separators', () => {
		const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: a
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: b`;
		const cursor = resolveYamlCursor(yaml, 8, 5);
		expect(cursor?.docIndex).toBe(2);
	});

	it('resolves array item value under spec.underlayProtocol.protocols', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
  underlayProtocol:
    bfd:
      enabled: true
    bgp:
      asnPool: asn-pool
    protocols:
      - EBGP`;
		const line = yaml.split('\n').length;
		const column = yaml.split('\n').pop()!.length;
		const cursor = resolveYamlCursor(yaml, line, column);
		expect(cursor?.completionKind).toBe('array-item');
		expect(specPathFromYamlPath(cursor!.yamlPath)).toEqual(['underlayProtocol', 'protocols']);
	});

	it('does not treat scalar leaves as path parents', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab-fabric
  namespace: eda
spec:
  underlayProtocol:
    bfd:
      enabled: true
    protocols:
      - `;
		const line = yaml.split('\n').length;
		const cursor = resolveYamlCursor(yaml, line, 9);
		expect(specPathFromYamlPath(cursor!.yamlPath)).toEqual(['underlayProtocol', 'protocols']);
	});
});

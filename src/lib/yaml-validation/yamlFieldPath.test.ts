import { describe, expect, it } from 'vitest';
import { findLineForYamlFieldPath } from './yamlFieldPath';

describe('findLineForYamlFieldPath', () => {
	const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  systemPoolIPV6: root-pool
  spines:
    asnPool: asn-pool
    systemPoolIPV4: systemipv4-pool
    systemPoolIPV6: systemipv6-pool
`;

	it('resolves nested path under spines', () => {
		expect(findLineForYamlFieldPath(yaml, 'spec.spines.systemPoolIPV6')).toBe(9);
		expect(findLineForYamlFieldPath(yaml, 'spec.spines.systemPoolIPV4')).toBe(8);
	});

	it('does not match duplicate key name at a different path', () => {
		expect(findLineForYamlFieldPath(yaml, 'spec.systemPoolIPV6')).toBe(5);
		expect(findLineForYamlFieldPath(yaml, 'spec.spines.systemPoolIPV6')).toBe(9);
	});

	it('resolves overlay and underlay protocol keys independently', () => {
		const yaml = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  overlayProtocol:
    protocol: IBGP
  underlayProtocol:
    protocol:
    - EBGP
`;
		expect(findLineForYamlFieldPath(yaml, 'spec.overlayProtocol.protocol')).toBe(6);
		expect(findLineForYamlFieldPath(yaml, 'spec.underlayProtocol.protocol')).toBe(8);
	});

	it('does not match a nested key when the path omits the parent segment', () => {
		const nestedOnly = `apiVersion: fabrics.eda.nokia.com/v1
kind: Fabric
metadata:
  name: lab
spec:
  borderLeafs:
    systemPoolIPV6: pool-b
`;
		expect(findLineForYamlFieldPath(nestedOnly, 'spec.systemPoolIPV6')).toBeUndefined();
		expect(findLineForYamlFieldPath(nestedOnly, 'spec.borderLeafs.systemPoolIPV6')).toBe(6);
	});
});

describe('findLineForYamlFieldPath in lists', () => {
	const doc = `spec:
  enabled: true
  overlays:
    - enable: true
      key: default
    - enabled: false
      key: second
      nested:
        name: x
  compact:
  - a: 1
  - a: 2`;

	it('resolves list items by index, with keys on the dash line or below it', () => {
		expect(findLineForYamlFieldPath(doc, 'spec.overlays[0].enable')).toBe(3);
		expect(findLineForYamlFieldPath(doc, 'spec.overlays.0.key')).toBe(4);
		expect(findLineForYamlFieldPath(doc, 'spec.overlays[1].key')).toBe(6);
		expect(findLineForYamlFieldPath(doc, 'spec.overlays[1].nested.name')).toBe(8);
		expect(findLineForYamlFieldPath(doc, 'spec.overlays[0]')).toBe(3);
	});

	it('handles compact lists and never crosses into the next item', () => {
		expect(findLineForYamlFieldPath(doc, 'spec.compact[1].a')).toBe(11);
		expect(findLineForYamlFieldPath(doc, 'spec.overlays[0].nested')).toBeUndefined();
		expect(findLineForYamlFieldPath(doc, 'spec.overlays[5]')).toBeUndefined();
	});
});

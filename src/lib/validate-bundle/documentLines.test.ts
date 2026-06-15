import { describe, expect, it } from 'vitest';
import { bundleDocumentStartLine } from './documentLines';

describe('bundleDocumentStartLine', () => {
	it('returns 1 for first document', () => {
		const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: a
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: b`;
		expect(bundleDocumentStartLine(yaml, 1)).toBe(1);
	});

	it('returns line after --- separator for second document', () => {
		const yaml = `apiVersion: v1
kind: ConfigMap
metadata:
  name: a
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: b`;
		expect(bundleDocumentStartLine(yaml, 2)).toBe(5);
	});
});

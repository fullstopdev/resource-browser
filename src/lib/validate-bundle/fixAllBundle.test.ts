import { describe, expect, it, vi } from 'vitest';
import { fixAllBundle, isAiUnavailableResult } from './fixAllBundle';
import type { BundleIssue } from './types';

const SAMPLE = `apiVersion: Topologies.eda.nokia.com/v1
kind: Topology
metadata:
  name: lab
  namespace: eda`;

describe('fixAllBundle', () => {
	it('applies suggested fixes in one pass', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'error',
				category: 'schema',
				message: 'Invalid apiVersion',
				docIndex: 1,
				line: 1,
				suggestedFix: { field: 'apiVersion', value: 'topologies.eda.nokia.com/v1', line: 1 }
			}
		];

		const result = await fixAllBundle(SAMPLE, issues);
		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.aiFixCount).toBe(0);
		expect(result.yaml).toContain('apiVersion: topologies.eda.nokia.com/v1');
	});

	it('returns parseIssue when YAML is invalid and AI is unavailable', async () => {
		const result = await fixAllBundle('kind: [broken', []);
		expect(result.ok).toBe(false);
		expect(result.parseIssue).toBeTruthy();
	});

	it('applies suggested fixes for warnings', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'warning',
				category: 'schema',
				message: 'Kind casing',
				docIndex: 1,
				line: 2,
				suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
  namespace: eda`;

		const result = await fixAllBundle(yaml, issues);
		expect(result.ok).toBe(true);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.remainingWarnings).toBe(0);
		expect(result.yaml).toContain('kind: Topology');
	});

	it('uses AI for errors without suggestedFix then applies standard fixes', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'error',
				category: 'schema',
				message: 'Invalid enum value',
				docIndex: 1,
				fieldPath: 'spec.os'
			},
			{
				id: '2',
				severity: 'warning',
				category: 'schema',
				message: 'Kind casing',
				docIndex: 1,
				line: 2,
				suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
  namespace: eda
spec:
  os: invalid`;

		const aiFix = vi.fn(async () => ({
			fixable: true,
			fixedYaml: `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
  namespace: eda
spec:
  os: SR_LINUX`
		}));

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			aiFix
		});
		expect(result.ok).toBe(true);
		expect(result.aiFixCount).toBe(1);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.yaml).toContain('os: SR_LINUX');
		expect(result.yaml).toContain('kind: Topology');
	});

	it('falls back to standard fixes when AI hits quota', async () => {
		const issues: BundleIssue[] = [
			{
				id: '1',
				severity: 'error',
				category: 'schema',
				message: 'Invalid enum',
				docIndex: 1
			},
			{
				id: '2',
				severity: 'warning',
				category: 'schema',
				message: 'Kind casing',
				docIndex: 1,
				line: 2,
				suggestedFix: { field: 'kind', value: 'Topology', line: 2 }
			}
		];

		const yaml = `apiVersion: topologies.eda.nokia.com/v1
kind: topology
metadata:
  name: lab
  namespace: eda`;

		const aiFix = vi.fn(async () => ({
			error: 'Workers AI daily limit reached',
			fallbackReason: 'quota' as const
		}));

		const result = await fixAllBundle(yaml, issues, {
			releaseFolder: 'eda-25-4-1',
			manifest: [],
			aiFix
		});
		expect(result.ok).toBe(true);
		expect(result.aiUnavailable).toBe(true);
		expect(result.aiFixCount).toBe(0);
		expect(result.suggestedFixCount).toBe(1);
		expect(result.yaml).toContain('kind: Topology');
	});
});

describe('isAiUnavailableResult', () => {
	it('detects token limit messages', () => {
		expect(isAiUnavailableResult({ error: 'prompt is too long' })).toBe(true);
		expect(isAiUnavailableResult({ fallbackReason: 'quota' })).toBe(true);
		expect(isAiUnavailableResult({ error: 'some other error' })).toBe(false);
	});
});

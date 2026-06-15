/**
 * Corpus audit: measure how many OpenAPI reference fields
 * are matched, unresolved, or skipped by the dependency extractor.
 */

import type { CrdResource } from '$lib/structure';
import {
	buildGvkIndex,
	buildKindIndex,
	extractExplicitRefEdges,
	extractKindsFromDescription,
	extractMetaInterfaceKinds,
	extractMonitorTargetKinds,
	extractOrchestrationIntentHits,
	extractSelectorIntentHits,
	isDescriptionMetaReference,
	isExternalReferenceDescription,
	isActionableMetaInterfaceField,
	isMetaInterfaceDescription,
	isReferenceFieldName,
	resolveKindTargetWithContext,
	shouldSkipDescriptionInference,
	stemToKindForAudit,
	walkOpenApiSchemaFields,
	type CatalogEntry
} from './schemaRefs';
import { buildCatalogFromManifest } from './inferEdges';
import type { AuditMetric, LinkRelation } from './types';

export type ReferenceAuditStatus = 'matched' | 'unmatched' | 'unresolved' | 'skipped';

export type ReferenceFieldAudit = {
	crdId: string;
	crdKind: string;
	apiVersion: string;
	fieldPath: string;
	propertyName: string;
	description: string;
	status: ReferenceAuditStatus;
	extractedKinds: string[];
	resolvedTargets: string[];
};

export type RefStemFieldAudit = {
	crdId: string;
	crdKind: string;
	apiVersion: string;
	fieldPath: string;
	propertyName: string;
	description?: string;
	status: ReferenceAuditStatus;
	stemKind: string | null;
	resolvedTargets: string[];
};

export type CorpusAuditSummary = {
	releaseFolder: string;
	totalReferenceFields: number;
	matched: number;
	unmatched: number;
	unresolved: number;
	skipped: number;
	matchRate: number;
	referenceDescriptions: AuditMetric;
	refFieldStems: AuditMetric;
	metaInterface: AuditMetric;
	selectorIntent: AuditMetric;
	dependencyGapReport: Array<{ crdId: string; kind: string; fieldPath: string; expectedKind: string }>;
	byCrd: Array<{
		crdId: string;
		kind: string;
		total: number;
		matched: number;
		rate: number;
	}>;
	topUnmatched: Array<{ description: string; count: number; crdId: string; fieldPath: string }>;
};

export function getNonDeprecatedVersions(resource: CrdResource): string[] {
	return resource.versions.filter((v) => v?.name && !v.deprecated).map((v) => v.name);
}

function resolveKindsToTargets(
	kinds: string[],
	sourceGroup: string,
	fieldPath: string,
	kindIndex: ReturnType<typeof buildKindIndex>,
	catalog: Map<string, CatalogEntry>
): string[] {
	const resolvedTargets: string[] = [];
	for (const kind of kinds) {
		const resolved = resolveKindTargetWithContext(kind, sourceGroup, kindIndex, catalog, {
			fieldPath
		});
		if (resolved.targetId) resolvedTargets.push(resolved.targetId);
	}
	return [...new Set(resolvedTargets)];
}

export function auditOpenApiSchema(
	sourceId: string,
	sourceGroup: string,
	sourceKind: string,
	apiVersion: string,
	openApiRoot: unknown,
	kindIndex: ReturnType<typeof buildKindIndex>,
	catalog: Map<string, CatalogEntry>,
	_gvkIndex: ReturnType<typeof buildGvkIndex>
): ReferenceFieldAudit[] {
	const results: ReferenceFieldAudit[] = [];
	const fields = walkOpenApiSchemaFields(openApiRoot);

	for (const field of fields) {
		if (!field.description?.includes('Reference to')) continue;

		const fieldPath = field.path;
		const extractedKinds = extractKindsFromDescription(field.description);
		const resolvedTargets: string[] = [];

		if (
			isExternalReferenceDescription(field.description) ||
			shouldSkipDescriptionInference(field.name, fieldPath, field.description)
		) {
			results.push({
				crdId: sourceId,
				crdKind: sourceKind,
				apiVersion,
				fieldPath,
				propertyName: field.name,
				description: field.description ?? '',
				status: 'skipped',
				extractedKinds,
				resolvedTargets
			});
			continue;
		}

		if (isDescriptionMetaReference(field.description)) {
			results.push({
				crdId: sourceId,
				crdKind: sourceKind,
				apiVersion,
				fieldPath,
				propertyName: field.name,
				description: field.description ?? '',
				status: 'skipped',
				extractedKinds,
				resolvedTargets
			});
			continue;
		}

		if (isMetaInterfaceDescription(field.description)) {
			const metaKinds = extractMetaInterfaceKinds(
				field.name,
				field.description,
				fieldPath,
				sourceKind
			);
			const uniqueResolved = resolveKindsToTargets(
				metaKinds,
				sourceGroup,
				fieldPath,
				kindIndex,
				catalog
			);
			results.push({
				crdId: sourceId,
				crdKind: sourceKind,
				apiVersion,
				fieldPath,
				propertyName: field.name,
				description: field.description ?? '',
				status:
					uniqueResolved.length > 0
						? 'matched'
						: metaKinds.length > 0
							? 'unresolved'
							: 'unmatched',
				extractedKinds: metaKinds,
				resolvedTargets: uniqueResolved
			});
			continue;
		}

		const monitorKinds = extractMonitorTargetKinds(field.name, field.description, sourceKind);
		if (monitorKinds.length > 0) {
			const uniqueResolved = resolveKindsToTargets(
				monitorKinds,
				sourceGroup,
				fieldPath,
				kindIndex,
				catalog
			);
			results.push({
				crdId: sourceId,
				crdKind: sourceKind,
				apiVersion,
				fieldPath,
				propertyName: field.name,
				description: field.description ?? '',
				status: uniqueResolved.length > 0 ? 'matched' : 'unresolved',
				extractedKinds: monitorKinds,
				resolvedTargets: uniqueResolved
			});
			continue;
		}

		if (extractedKinds.length === 0) {
			results.push({
				crdId: sourceId,
				crdKind: sourceKind,
				apiVersion,
				fieldPath,
				propertyName: field.name,
				description: field.description ?? '',
				status: 'unmatched',
				extractedKinds,
				resolvedTargets
			});
			continue;
		}

		const uniqueResolved = resolveKindsToTargets(
			extractedKinds,
			sourceGroup,
			fieldPath,
			kindIndex,
			catalog
		);
		const status: ReferenceAuditStatus = uniqueResolved.length > 0 ? 'matched' : 'unresolved';

		results.push({
			crdId: sourceId,
			crdKind: sourceKind,
			apiVersion,
			fieldPath,
			propertyName: field.name,
			description: field.description ?? '',
			status,
			extractedKinds,
			resolvedTargets: uniqueResolved
		});
	}

	return results;
}

export function auditRefStemFields(
	sourceId: string,
	sourceGroup: string,
	sourceKind: string,
	apiVersion: string,
	openApiRoot: unknown,
	kindIndex: ReturnType<typeof buildKindIndex>,
	catalog: Map<string, CatalogEntry>
): RefStemFieldAudit[] {
	const results: RefStemFieldAudit[] = [];
	const fields = walkOpenApiSchemaFields(openApiRoot);

	for (const field of fields) {
		if (!isReferenceFieldName(field.name)) continue;
		const fieldPath = field.path;
		if (!fieldPath.startsWith('spec') && !fieldPath.startsWith('status')) continue;

		const prop = {
			name: field.name,
			description: field.description ?? '',
			path: fieldPath,
			node: field.node
		};

		const explicit = extractExplicitRefEdges(prop, { sourceKind });
		const resolvedTargets = explicit.flatMap((edge) => {
			const resolved = resolveKindTargetWithContext(edge.kind, sourceGroup, kindIndex, catalog, {
				fieldPath
			});
			return resolved.targetId ? [resolved.targetId] : [];
		});
		const uniqueResolved = [...new Set(resolvedTargets)];

		let status: ReferenceAuditStatus;
		if (
			field.description &&
			(isExternalReferenceDescription(field.description) ||
				shouldSkipDescriptionInference(field.name, fieldPath, field.description))
		) {
			status = 'skipped';
		} else if (uniqueResolved.length > 0) {
			status = 'matched';
		} else {
			const stemKind = stemToKindForAudit(field.name);
			status = stemKind ? 'unresolved' : 'unmatched';
		}

		results.push({
			crdId: sourceId,
			crdKind: sourceKind,
			apiVersion,
			fieldPath,
			propertyName: field.name,
			description: field.description ?? '',
			status,
			stemKind: stemToKindForAudit(field.name),
			resolvedTargets: uniqueResolved
		});
	}

	return results;
}

export function auditMetaInterfaceFields(
	sourceId: string,
	sourceGroup: string,
	sourceKind: string,
	apiVersion: string,
	openApiRoot: unknown,
	kindIndex: ReturnType<typeof buildKindIndex>,
	catalog: Map<string, CatalogEntry>
): ReferenceFieldAudit[] {
	const results: ReferenceFieldAudit[] = [];
	const fields = walkOpenApiSchemaFields(openApiRoot);

	for (const field of fields) {
		if (!isActionableMetaInterfaceField(field.name, field.description)) continue;

		const fieldPath = field.path;
		const extractedKinds = extractMetaInterfaceKinds(
			field.name,
			field.description ?? '',
			fieldPath,
			sourceKind
		);
		const uniqueResolved = resolveKindsToTargets(
			extractedKinds,
			sourceGroup,
			fieldPath,
			kindIndex,
			catalog
		);
		const status: ReferenceAuditStatus =
			uniqueResolved.length > 0 ? 'matched' : extractedKinds.length > 0 ? 'unresolved' : 'unmatched';

		results.push({
			crdId: sourceId,
			crdKind: sourceKind,
			apiVersion,
			fieldPath,
			propertyName: field.name,
			description: field.description ?? '',
			status,
			extractedKinds,
			resolvedTargets: uniqueResolved
		});
	}

	return results;
}

export function auditSelectorIntentFields(
	sourceId: string,
	sourceGroup: string,
	sourceKind: string,
	apiVersion: string,
	openApiRoot: unknown,
	kindIndex: ReturnType<typeof buildKindIndex>,
	catalog: Map<string, CatalogEntry>
): ReferenceFieldAudit[] {
	const results: ReferenceFieldAudit[] = [];
	const fields = walkOpenApiSchemaFields(openApiRoot);
	const rootDescription =
		openApiRoot && typeof openApiRoot === 'object'
			? (openApiRoot as { description?: string }).description
			: undefined;

	const auditHits = (fieldPath: string, propertyName: string, description: string, hits: Array<{ kind: string }>) => {
		if (hits.length === 0) return;
		const extractedKinds = [...new Set(hits.map((h) => h.kind))];
		const uniqueResolved = resolveKindsToTargets(
			extractedKinds,
			sourceGroup,
			fieldPath,
			kindIndex,
			catalog
		);
		const status: ReferenceAuditStatus =
			uniqueResolved.length > 0 ? 'matched' : extractedKinds.length > 0 ? 'unresolved' : 'unmatched';
		results.push({
			crdId: sourceId,
			crdKind: sourceKind,
			apiVersion,
			fieldPath,
			propertyName,
			description,
			status,
			extractedKinds,
			resolvedTargets: uniqueResolved
		});
	};

	for (const field of fields) {
		if (!field.description) continue;
		const selectorHits = extractSelectorIntentHits(
			field.name,
			field.description,
			field.path,
			sourceKind
		);
		auditHits(field.path, field.name, field.description, selectorHits);

		const orchestrationHits = extractOrchestrationIntentHits(field.description, field.path, sourceKind);
		auditHits(field.path, field.name, field.description, orchestrationHits);
	}

	if (rootDescription) {
		const rootHits = extractOrchestrationIntentHits(rootDescription, 'schema', sourceKind);
		auditHits('schema', 'schema', rootDescription, rootHits);
	}

	return results;
}

export function buildDependencyGapReport(
	selectorAudits: ReferenceFieldAudit[],
	graphLinks: Array<{ source: string; target: string }>
): Array<{ crdId: string; kind: string; fieldPath: string; expectedKind: string }> {
	const linked = new Set(graphLinks.map((l) => `${l.source}|${l.target}`));
	const gaps: Array<{ crdId: string; kind: string; fieldPath: string; expectedKind: string }> = [];

	for (const row of selectorAudits) {
		if (row.status !== 'matched') continue;
		for (let i = 0; i < row.extractedKinds.length; i++) {
			const target = row.resolvedTargets[i];
			if (!target) continue;
			if (linked.has(`${row.crdId}|${target}`)) continue;
			gaps.push({
				crdId: row.crdId,
				kind: row.crdKind,
				fieldPath: row.fieldPath,
				expectedKind: row.extractedKinds[i] ?? ''
			});
		}
	}

	return gaps.slice(0, 30);
}

function auditMetricFromRows(
	rows: Array<{ status: ReferenceAuditStatus }>
): AuditMetric {
	const skipped = rows.filter((r) => r.status === 'skipped').length;
	const matched = rows.filter((r) => r.status === 'matched').length;
	const total = rows.length;
	const actionable = total - skipped;
	return {
		matched,
		total: actionable,
		rate: actionable > 0 ? matched / actionable : 1
	};
}

export function summarizeCorpusAudit(
	releaseFolder: string,
	audits: ReferenceFieldAudit[],
	refStemAudits: RefStemFieldAudit[] = [],
	metaInterfaceAudits: ReferenceFieldAudit[] = [],
	selectorIntentAudits: ReferenceFieldAudit[] = [],
	dependencyGapReport: CorpusAuditSummary['dependencyGapReport'] = []
): CorpusAuditSummary {
	const matched = audits.filter((a) => a.status === 'matched').length;
	const unmatched = audits.filter((a) => a.status === 'unmatched').length;
	const unresolved = audits.filter((a) => a.status === 'unresolved').length;
	const skipped = audits.filter((a) => a.status === 'skipped').length;
	const total = audits.length;
	const actionable = total - skipped;
	const matchRate = actionable > 0 ? matched / actionable : 1;

	const byCrdMap = new Map<string, { kind: string; total: number; matched: number }>();
	for (const a of audits) {
		const entry = byCrdMap.get(a.crdId) ?? { kind: a.crdKind, total: 0, matched: 0 };
		entry.total++;
		if (a.status === 'matched') entry.matched++;
		byCrdMap.set(a.crdId, entry);
	}

	const byCrd = [...byCrdMap.entries()]
		.map(([crdId, v]) => ({
			crdId,
			kind: v.kind,
			total: v.total,
			matched: v.matched,
			rate: v.total > 0 ? v.matched / v.total : 0
		}))
		.sort((a, b) => a.rate - b.rate);

	const unmatchedCounts = new Map<string, ReferenceFieldAudit>();
	for (const a of audits.filter((x) => x.status === 'unmatched')) {
		const key = a.description.slice(0, 120);
		if (!unmatchedCounts.has(key)) unmatchedCounts.set(key, a);
	}

	const topUnmatched = [...unmatchedCounts.values()]
		.slice(0, 20)
		.map((a) => ({
			description: a.description.slice(0, 100),
			count: 1,
			crdId: a.crdId,
			fieldPath: a.fieldPath
		}));

	return {
		releaseFolder,
		totalReferenceFields: total,
		matched,
		unmatched,
		unresolved,
		skipped,
		matchRate,
		referenceDescriptions: auditMetricFromRows(audits),
		refFieldStems: auditMetricFromRows(refStemAudits),
		metaInterface: auditMetricFromRows(metaInterfaceAudits),
		selectorIntent: auditMetricFromRows(selectorIntentAudits),
		dependencyGapReport,
		byCrd,
		topUnmatched
	};
}

export function countIntentEdgesByCrd(
	links: Array<{ source: string; edgeClass?: string; rel: LinkRelation }>
): Record<string, Partial<Record<LinkRelation, number>>> {
	const counts: Record<string, Partial<Record<LinkRelation, number>>> = {};
	for (const link of links) {
		if (link.edgeClass !== 'intentDependency') continue;
		const bucket = counts[link.source] ?? {};
		bucket[link.rel] = (bucket[link.rel] ?? 0) + 1;
		counts[link.source] = bucket;
	}
	return counts;
}

export function auditManifestResources(
	releaseFolder: string,
	resources: CrdResource[],
	loadOpenApi: (resourceName: string, apiVersion: string) => unknown | null,
	graphLinks?: Array<{ source: string; target: string }>
): {
	audits: ReferenceFieldAudit[];
	refStemAudits: RefStemFieldAudit[];
	metaInterfaceAudits: ReferenceFieldAudit[];
	selectorIntentAudits: ReferenceFieldAudit[];
	summary: CorpusAuditSummary;
} {
	const catalog = buildCatalogFromManifest(resources);
	const kindIndex = buildKindIndex(catalog);
	const gvkIndex = buildGvkIndex(catalog);
	const audits: ReferenceFieldAudit[] = [];
	const refStemAudits: RefStemFieldAudit[] = [];
	const metaInterfaceAudits: ReferenceFieldAudit[] = [];
	const selectorIntentAudits: ReferenceFieldAudit[] = [];

	for (const res of resources) {
		for (const version of getNonDeprecatedVersions(res)) {
			const openApi = loadOpenApi(res.name, version);
			if (!openApi) continue;
			const entry = catalog.get(res.name);
			const group = entry?.group ?? res.group;
			const kind = entry?.kind ?? res.kind;
			audits.push(
				...auditOpenApiSchema(res.name, group, kind, version, openApi, kindIndex, catalog, gvkIndex)
			);
			refStemAudits.push(
				...auditRefStemFields(res.name, group, kind, version, openApi, kindIndex, catalog)
			);
			metaInterfaceAudits.push(
				...auditMetaInterfaceFields(res.name, group, kind, version, openApi, kindIndex, catalog)
			);
			selectorIntentAudits.push(
				...auditSelectorIntentFields(res.name, group, kind, version, openApi, kindIndex, catalog)
			);
		}
	}

	const dependencyGapReport = graphLinks
		? buildDependencyGapReport(selectorIntentAudits, graphLinks)
		: [];

	return {
		audits,
		refStemAudits,
		metaInterfaceAudits,
		selectorIntentAudits,
		summary: summarizeCorpusAudit(
			releaseFolder,
			audits,
			refStemAudits,
			metaInterfaceAudits,
			selectorIntentAudits,
			dependencyGapReport
		)
	};
}

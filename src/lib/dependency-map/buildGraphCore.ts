import type { CrdResource } from '$lib/structure';
import {
	auditMetaInterfaceFields,
	auditOpenApiSchema,
	auditRefStemFields,
	auditSelectorIntentFields,
	buildDependencyGapReport,
	countIntentEdgesByCrd,
	getNonDeprecatedVersions,
	summarizeCorpusAudit
} from './auditCorpus';
import {
	buildCatalogFromManifest,
	catalogToNodes,
	getKindIndex,
	getGvkIndex,
	inferCatalogLinks,
	inferSchemaLinksForVersions,
	mergeGraphLinks
} from './inferEdges';
import type { CorpusCoverage, DependencyGraph } from './types';

export type ParsedCrdSchema = {
	openApiRoot?: unknown;
	spec?: unknown;
	status?: unknown;
	metadata?: unknown;
	description?: string;
};

export type LoadCrdSchemaFn = (
	resourceName: string,
	apiVersion: string
) => ParsedCrdSchema | null | Promise<ParsedCrdSchema | null>;

export async function buildDependencyGraphFromResources(
	releaseFolder: string,
	resources: CrdResource[],
	loadSchema: LoadCrdSchemaFn,
	options?: { precomputed?: boolean }
): Promise<DependencyGraph> {
	const catalog = buildCatalogFromManifest(resources);
	const kindIndex = getKindIndex(catalog);
	const gvkIndex = getGvkIndex(catalog);
	const versions = new Map<string, string>();
	const descriptions = new Map<string, string>();

	for (const res of resources) {
		const nonDeprecated = getNonDeprecatedVersions(res);
		versions.set(res.name, nonDeprecated[0] ?? res.versions[0]?.name ?? '');
	}

	const catalogLinks = inferCatalogLinks(catalog, kindIndex);
	const schemaLinks: ReturnType<typeof inferCatalogLinks> = [];
	const auditRows: ReturnType<typeof auditOpenApiSchema> = [];
	const refStemRows: ReturnType<typeof auditRefStemFields> = [];
	const metaInterfaceRows: ReturnType<typeof auditMetaInterfaceFields> = [];
	const selectorIntentRows: ReturnType<typeof auditSelectorIntentFields> = [];

	for (const res of resources) {
		const versionSchemas: Array<{ apiVersion: string; openApiRoot: unknown }> = [];

		for (const apiVersion of getNonDeprecatedVersions(res)) {
			const parsed = await loadSchema(res.name, apiVersion);
			if (!parsed) continue;
			if (parsed.description && !descriptions.has(res.name)) {
				descriptions.set(res.name, parsed.description);
			}
			const openApiRoot = parsed.openApiRoot ?? parsed.spec;
			if (openApiRoot) {
				versionSchemas.push({ apiVersion, openApiRoot });
				const entry = catalog.get(res.name);
				auditRows.push(
					...auditOpenApiSchema(
						res.name,
						entry?.group ?? res.group,
						entry?.kind ?? res.kind,
						apiVersion,
						openApiRoot,
						kindIndex,
						catalog,
						gvkIndex
					)
				);
				const group = entry?.group ?? res.group;
				const kind = entry?.kind ?? res.kind;
				refStemRows.push(
					...auditRefStemFields(res.name, group, kind, apiVersion, openApiRoot, kindIndex, catalog)
				);
				metaInterfaceRows.push(
					...auditMetaInterfaceFields(
						res.name,
						group,
						kind,
						apiVersion,
						openApiRoot,
						kindIndex,
						catalog
					)
				);
				selectorIntentRows.push(
					...auditSelectorIntentFields(
						res.name,
						group,
						kind,
						apiVersion,
						openApiRoot,
						kindIndex,
						catalog
					)
				);
			}
		}

		if (versionSchemas.length === 0) continue;

		const entry = catalog.get(res.name);
		const group = entry?.group ?? res.group;
		schemaLinks.push(
			...inferSchemaLinksForVersions(res.name, group, versionSchemas, kindIndex, catalog, gvkIndex)
		);
	}

	const mergedLinks = mergeGraphLinks([...catalogLinks, ...schemaLinks]);
	const summary = summarizeCorpusAudit(
		releaseFolder,
		auditRows,
		refStemRows,
		metaInterfaceRows,
		selectorIntentRows,
		buildDependencyGapReport(
			selectorIntentRows,
			mergedLinks.map((l) => ({ source: l.source, target: l.target }))
		)
	);
	const intentEdgesByCrd = countIntentEdgesByCrd(
		mergedLinks.map((link) => ({
			source: link.source,
			edgeClass: link.edgeClass,
			rel: link.rel
		}))
	);

	const crdCoverage: Record<string, { matched: number; total: number }> = {};
	for (const row of summary.byCrd) {
		crdCoverage[row.crdId] = { matched: row.matched, total: row.total };
	}

	const coverage: CorpusCoverage = {
		matched: summary.referenceDescriptions.matched,
		total: summary.referenceDescriptions.total,
		rate: summary.referenceDescriptions.rate,
		referenceDescriptions: summary.referenceDescriptions,
		refFieldStems: summary.refFieldStems,
		metaInterface: summary.metaInterface,
		selectorIntent: summary.selectorIntent,
		intentEdgesByCrd
	};

	return {
		nodes: catalogToNodes(catalog, versions, descriptions),
		links: mergedLinks,
		releaseFolder,
		generatedAt: new Date().toISOString(),
		precomputed: options?.precomputed,
		coverage,
		crdCoverage
	};
}

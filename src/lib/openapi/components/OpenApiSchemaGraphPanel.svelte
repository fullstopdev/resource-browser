<script lang="ts">
	import { browser } from '$app/environment';

	import { Background, BackgroundVariant, MarkerType, SvelteFlow, Controls } from '@xyflow/svelte';
	import type { Edge, Node, EdgeTypes, NodeTypes } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';

	import OpenApiMethodBadge from '$lib/openapi/components/OpenApiMethodBadge.svelte';
	import OpenApiModal from '$lib/openapi/components/OpenApiModal.svelte';
	import OpenApiOperationDetail from '$lib/openapi/components/OpenApiOperationDetail.svelte';
	import OpenApiSchemaDetail from '$lib/openapi/components/OpenApiSchemaDetail.svelte';
	import {
		buildPathBrowserData,
		findOperationByDeepLinkId,
		getOperationDeepLinkId,
		type OpenApiOperation
	} from '$lib/openapi/pathBrowser';
	import {
		buildSchemaExplorer,
		createSchemaExplorerHydrator,
		findSchemaExplorerEntry,
		getSchemaExplorerPath,
		listSchemaNames
	} from '$lib/openapi/schemaBrowser';
	import { sanitizeSpecForDisplay } from '$lib/openapi/sanitizeSpecForDisplay';
	import { getGraphPalette } from '$lib/dependency-map/graphColors';
	import {
		API_MAP_X_SPACING,
		API_MAP_Y_SPACING,
		computeApiMapLayout,
		computeSchemaDepsLayout,
		estimateSchemaNodeWidthPx,
		findApiMapPathNode,
		listApiMapOperations,
		listApiMapTags,
		listEqlQuickPickSchemas,
		listSchemaRootOptions,
		PATH_NODE_WIDTH_PX,
		pickDefaultApiMapSelection,
		pickDefaultSchemaRoot,
		SCHEMA_DEPS_X_SPACING,
		SCHEMA_DEPS_Y_SPACING,
		SCHEMA_NODE_WIDTH_PX,
		type GraphViewMode,
		type UnifiedGraphLayout
	} from '$lib/schemaGraph/computeUnifiedGraphLayout';
	import type { UnifiedApiGraph, UnifiedGraphEdgeKind } from '$lib/schemaGraph/unifiedApiGraph';
	import { validateFieldsList, type FieldsValidationResult } from '$lib/schemaGraph/validateFieldsList';
	import SchemaGraphNode from '$lib/schemaGraph/SchemaGraphNode.svelte';
	import SchemaGraphEdge from '$lib/schemaGraph/SchemaGraphEdge.svelte';
	import SchemaGraphFitView from '$lib/schemaGraph/SchemaGraphFitView.svelte';

	interface Props {
		spec: Record<string, unknown>;
		darkMode?: boolean;
		resourcesReleaseFolder?: string; // API parity with schema browser; unused here
		highlightSchema?: string;
		/** Deep-link / Paths focus: force API map on this operation. */
		focusOperationId?: string;
		apiGraphUrl?: string;
		onOperationNavigate?: (operationId: string) => void;
	}

	let {
		spec,
		darkMode = false,
		highlightSchema = '',
		focusOperationId = '',
		apiGraphUrl = '',
		onOperationNavigate
	}: Props = $props();

	type SchemaGraphNodeData = {
		kind: 'path' | 'schema';
		name: string;
		label: string;
		isRecursive: boolean;
		isRoot?: boolean;
		method?: string;
		path?: string;
		operationId?: string;
		widthPx?: number;
		hint?: string;
	};

	type SchemaGraphEdgeData = {
		kind: UnifiedGraphEdgeKind;
		isBackEdge: boolean;
		color: string;
		viaProperty?: string;
		label: string;
	};

	type ApiMapEdgeKind = 'request-body' | 'response' | 'parameter';

	let graph: UnifiedApiGraph | null = $state(null);
	let graphError = $state('');
	let graphLoading = $state(false);
	/** Prefer API map on entry for an immediately useful bipartite view. */
	let viewMode = $state<GraphViewMode>('api-map');
	let rootSchemaName = $state('');
	let showAllSchemas = $state(false);
	let tagFilter = $state('');
	let tagFilterInitialized = $state(false);
	/** Last focusOperationId we applied — avoid re-forcing viewMode on every run. */
	let appliedFocusOperationId = $state('');
	let selectedPathId = $state('');
	let fieldsText = $state('');
	/** Dense $ref graphs are cleaner without property labels on every stroke. */
	let showEdgeLabels = $state(true);
	let detailModalOpen = $state(false);
	let inspectedSchemaName = $state('');
	let operationModalOpen = $state(false);
	let inspectedOperationId = $state('');
	let fitViewEpoch = $state(0);
	let showRequestEdges = $state(true);
	let showResponseEdges = $state(true);
	let showParameterEdges = $state(true);

	const fieldsTextareaId = 'openapi-schema-graph-fields-textarea';
	const fieldsPlaceholder = 'spec.foo.bar\nspec.baz';
	const rootSelectId = 'openapi-schema-graph-root-select';
	const viewModeId = 'openapi-schema-graph-view-mode';
	const tagFilterId = 'openapi-schema-graph-tag-filter';
	const detailModalTitleId = 'openapi-schema-graph-detail-title';
	const operationModalTitleId = 'openapi-schema-graph-operation-title';

	function openSchemaDetail(schemaName: string) {
		if (!schemaName) return;
		closeOperationDetail();
		inspectedSchemaName = schemaName;
		detailModalOpen = true;
	}

	function closeSchemaDetail() {
		if (!detailModalOpen) return;
		detailModalOpen = false;
		fitViewEpoch += 1;
	}

	function openOperationDetail(operationId: string) {
		if (!operationId) return;
		closeSchemaDetail();
		inspectedOperationId = operationId;
		operationModalOpen = true;
	}

	function closeOperationDetail() {
		if (!operationModalOpen) return;
		operationModalOpen = false;
		fitViewEpoch += 1;
	}

	function openOperationInPaths() {
		if (!inspectedOperationId) return;
		const op =
			findOperationByDeepLinkId(allOperations, inspectedOperationId) ??
			allOperations.find((o) => o.id === inspectedOperationId);
		if (!op) return;
		onOperationNavigate?.(getOperationDeepLinkId(op));
	}

	const nodeTypes: NodeTypes = { schemaGraphNode: SchemaGraphNode };
	const edgeTypes: EdgeTypes = { schemaGraphEdge: SchemaGraphEdge };

	let flowHostEl = $state<HTMLDivElement | null>(null);
	let flowWidth = $state(0);
	let flowHeight = $state(0);

	$effect(() => {
		const host = flowHostEl;
		if (!host || !browser) return;
		const updateSize = () => {
			const w = host.clientWidth;
			const h = host.clientHeight;
			if (w > 0) flowWidth = w;
			if (h > 0) flowHeight = h;
		};
		updateSize();
		const observer = new ResizeObserver(updateSize);
		observer.observe(host);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!browser) return;
		if (!apiGraphUrl) {
			graph = null;
			graphError = '';
			graphLoading = false;
			return;
		}
		let cancelled = false;
		graphLoading = true;
		graphError = '';
		graph = null;
		rootSchemaName = '';
		inspectedSchemaName = '';
		inspectedOperationId = '';
		showAllSchemas = false;
		detailModalOpen = false;
		operationModalOpen = false;
		tagFilterInitialized = false;
		tagFilter = '';
		selectedPathId = '';
		showRequestEdges = true;
		showResponseEdges = true;
		showParameterEdges = true;
		// Do not read focusOperationId / highlightSchema here — that would refetch the
		// graph on every Paths→Schema Graph navigation. Mode is applied in dedicated effects.
		viewMode = 'api-map';
		showEdgeLabels = true;
		appliedFocusOperationId = '';

		void (async () => {
			try {
				const resp = await fetch(apiGraphUrl);
				if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
				const data = (await resp.json()) as UnifiedApiGraph;
				if (cancelled) return;
				graph = data;
			} catch (err) {
				if (cancelled) return;
				graphError = err instanceof Error ? err.message : 'Failed to load API graph';
			} finally {
				if (!cancelled) graphLoading = false;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!graph || rootSchemaName) return;
		// Operation focus owns API map; still pick a default root for later schema-deps switches.
		if (focusOperationId.trim()) {
			const pick = pickDefaultSchemaRoot(graph);
			rootSchemaName = pick.root;
			if (pick.preferShowAll) showAllSchemas = true;
			return;
		}
		if (highlightSchema && graph.nodes.some((n) => n.schemaName === highlightSchema)) {
			rootSchemaName = highlightSchema;
			viewMode = 'schema-deps';
			showEdgeLabels = false;
			// Platform / non-owned deep-links need the unfiltered ROOT list.
			const owned = listSchemaRootOptions(
				graph.nodes
					.filter((n) => n.kind === 'schema')
					.map((n) => n.schemaName ?? '')
					.filter(Boolean),
				false
			);
			if (!owned.includes(highlightSchema)) showAllSchemas = true;
			return;
		}
		const pick = pickDefaultSchemaRoot(graph);
		rootSchemaName = pick.root;
		if (pick.preferShowAll) showAllSchemas = true;
	});

	const eqlQuickPicks = $derived(graph ? listEqlQuickPickSchemas(graph) : []);

	$effect(() => {
		if (!graph) return;
		const focus = focusOperationId.trim();
		if (focus) {
			const node = findApiMapPathNode(graph, focus);
			if (!node) return;
			// Apply once per op id. Re-forcing viewMode every run fought the View
			// dropdown; `fitViewEpoch += 1` previously infinite-looped (stuck loading).
			if (appliedFocusOperationId === focus) return;
			appliedFocusOperationId = focus;
			viewMode = 'api-map';
			showEdgeLabels = true;
			tagFilter = node.tags?.[0] ?? '';
			selectedPathId = node.id;
			tagFilterInitialized = true;
			return;
		}
		appliedFocusOperationId = '';
		if (tagFilterInitialized) return;
		const pick = pickDefaultApiMapSelection(graph, {
			schemaFocus: highlightSchema || undefined
		});
		tagFilter = pick.tagFilter;
		selectedPathId = pick.pathId;
		tagFilterInitialized = true;
	});

	/** When only schema= is in the URL (no op), open schema-deps for that root. */
	$effect(() => {
		if (!graph) return;
		if (focusOperationId.trim()) return;
		const schema = highlightSchema.trim();
		if (!schema) return;
		if (!graph.nodes.some((n) => n.schemaName === schema)) return;
		if (rootSchemaName !== schema) rootSchemaName = schema;
		if (viewMode !== 'schema-deps') viewMode = 'schema-deps';
		if (showEdgeLabels) showEdgeLabels = false;
	});

	const sanitizedSpec = $derived(sanitizeSpecForDisplay(spec));
	const explorerEntries = $derived(buildSchemaExplorer(sanitizedSpec));
	const hydrator = $derived(createSchemaExplorerHydrator(sanitizedSpec));
	const schemaNames = $derived(listSchemaNames(sanitizedSpec));
	/** ROOT options: API-owned FQDN schemas by default; full list when "Show all schemas". */
	const rootSchemaOptions = $derived(listSchemaRootOptions(schemaNames, showAllSchemas));
	const pathBrowserData = $derived(buildPathBrowserData(sanitizedSpec));
	const allOperations = $derived(pathBrowserData.tagGroups.flatMap((g) => g.operations));
	const inspectedOperation = $derived.by((): OpenApiOperation | null => {
		if (!inspectedOperationId) return null;
		return findOperationByDeepLinkId(allOperations, inspectedOperationId) ?? null;
	});
	const apiMapTags = $derived(graph ? listApiMapTags(graph) : []);

	/** When filtering ROOT options, keep the selection inside the visible list. */
	$effect(() => {
		if (!graph || !rootSchemaName || showAllSchemas) return;
		if (rootSchemaOptions.length === 0 || rootSchemaOptions.includes(rootSchemaName)) return;
		const pick = pickDefaultSchemaRoot(graph);
		rootSchemaName = rootSchemaOptions.includes(pick.root)
			? pick.root
			: (rootSchemaOptions[0] ?? '');
	});

	/** Operation dropdown options: all path nodes for the tag (not schemaFocus-filtered). */
	const apiMapOperations = $derived(
		graph && viewMode === 'api-map' ? listApiMapOperations(graph, tagFilter || undefined) : []
	);

	const activeEdgeKinds = $derived.by((): ApiMapEdgeKind[] => {
		const kinds: ApiMapEdgeKind[] = [];
		if (showRequestEdges) kinds.push('request-body');
		if (showResponseEdges) kinds.push('response');
		if (showParameterEdges) kinds.push('parameter');
		return kinds;
	});

	const selectedSchemaName = $derived.by(() => {
		if (detailModalOpen && inspectedSchemaName) return inspectedSchemaName;
		if (viewMode === 'schema-deps') return rootSchemaName;
		return highlightSchema || rootSchemaName;
	});

	const selectedExplorerEntry = $derived.by(() => {
		if (!selectedSchemaName) return null;
		const base = findSchemaExplorerEntry(explorerEntries, selectedSchemaName);
		return base ? hydrator.hydrate(base) : null;
	});

	const ancestryPath = $derived(
		selectedSchemaName ? getSchemaExplorerPath(explorerEntries, selectedSchemaName) : []
	);

	const palette = $derived(getGraphPalette(darkMode ? 'dark' : 'light'));

	const depsLayout = $derived.by((): UnifiedGraphLayout | null => {
		if (!graph || !rootSchemaName || viewMode !== 'schema-deps') return null;
		return computeSchemaDepsLayout(graph, rootSchemaName, showAllSchemas);
	});

	$effect(() => {
		if (viewMode !== 'api-map' || !graph) return;
		const pick = pickDefaultApiMapSelection(graph, {
			tagFilter,
			currentPathId: selectedPathId
		});
		if (pick.pathId !== selectedPathId) selectedPathId = pick.pathId;
	});

	/** One selected operation → schemas (bipartite). */
	const focusedApiMap = $derived.by((): UnifiedGraphLayout | null => {
		if (!graph || viewMode !== 'api-map' || !selectedPathId) return null;
		const layout = computeApiMapLayout(graph, {
			tagFilter: tagFilter || undefined,
			pathId: selectedPathId,
			edgeKinds: activeEdgeKinds
		});
		if (!layout.nodes.some((n) => n.id === selectedPathId)) return null;
		return layout;
	});

	const activeLayout = $derived.by((): UnifiedGraphLayout | null => {
		if (viewMode === 'schema-deps') return depsLayout;
		return focusedApiMap;
	});

	const layoutKey = $derived(
		[
			viewMode,
			rootSchemaName,
			showAllSchemas,
			selectedPathId,
			activeEdgeKinds.join(','),
			activeLayout?.nodes.length ?? 0,
			activeLayout?.edges.length ?? 0,
			flowWidth,
			flowHeight,
			fitViewEpoch
		].join('|')
	);

	const X_SPACING = $derived(viewMode === 'api-map' ? API_MAP_X_SPACING : SCHEMA_DEPS_X_SPACING);
	const Y_SPACING = $derived(viewMode === 'api-map' ? API_MAP_Y_SPACING : SCHEMA_DEPS_Y_SPACING);

	function edgeColor(kind: UnifiedGraphEdgeKind): string {
		switch (kind) {
			case 'request-body':
				return palette.state;
			case 'response':
				return palette.config;
			case 'parameter':
				return palette.rel.orchestrates;
			case 'schema-ref':
			default:
				return palette.rel.references;
		}
	}

	/** Center the shorter column so bipartite edges stay mostly horizontal. */
	function centeredY(indexInLevel: number, levelCount: number, peerCount: number, spacing: number): number {
		const selfSpan = Math.max(levelCount - 1, 0) * spacing;
		const peerSpan = Math.max(peerCount - 1, 0) * spacing;
		const offset = Math.max(0, (peerSpan - selfSpan) / 2);
		return offset + indexInLevel * spacing;
	}

	/** Vertically center each BFS column against the tallest column. */
	function columnCenteredY(
		indexInLevel: number,
		levelCount: number,
		maxLevelCount: number,
		spacing: number
	): number {
		const offset = Math.max(0, (maxLevelCount - levelCount) / 2) * spacing;
		return offset + indexInLevel * spacing;
	}

	const schemaCardWidthPx = $derived.by(() => {
		const layout = activeLayout;
		if (!layout) return SCHEMA_NODE_WIDTH_PX;
		const labels = layout.nodes
			.filter((n) => n.kind === 'schema')
			.map((n) => n.schemaName ?? n.label);
		return estimateSchemaNodeWidthPx(labels);
	});

	const flowNodes = $derived.by((): Node[] => {
		const layout = activeLayout;
		if (!layout) return [];
		const schemaWidth = schemaCardWidthPx;
		const xSpacing = X_SPACING;
		const ySpacing = Y_SPACING;

		if (viewMode === 'api-map') {
			const pathCount = layout.nodes.filter((n) => n.kind === 'path').length;
			const schemaCount = layout.nodes.filter((n) => n.kind === 'schema').length;
			return layout.nodes.map((node) => {
				const peerCount = node.kind === 'path' ? schemaCount : pathCount;
				const levelCount = node.kind === 'path' ? pathCount : schemaCount;
				const widthPx = node.kind === 'path' ? PATH_NODE_WIDTH_PX : schemaWidth;
				return {
					id: node.id,
					type: 'schemaGraphNode',
					position: {
						x: node.level * xSpacing,
						y: centeredY(node.indexInLevel, levelCount, peerCount, ySpacing)
					},
					data: {
						kind: node.kind,
						name: node.schemaName ?? node.label,
						label: node.label,
						isRecursive: node.isRecursive ?? false,
						method: node.method,
						path: node.path,
						operationId: node.operationId,
						widthPx,
						hint:
							node.kind === 'path'
								? 'Click to open operation'
								: 'Click to inspect schema'
					} satisfies SchemaGraphNodeData,
					connectable: false,
					selectable: true,
					selected:
						node.kind === 'path'
							? node.id === selectedPathId
							: node.kind === 'schema'
								? node.schemaName === selectedSchemaName
								: false
				};
			});
		}

		const countsByLevel = new Map<number, number>();
		for (const node of layout.nodes) {
			countsByLevel.set(node.level, (countsByLevel.get(node.level) ?? 0) + 1);
		}
		const maxLevelCount = Math.max(1, ...countsByLevel.values());

		return layout.nodes.map((node) => {
			const levelCount = countsByLevel.get(node.level) ?? 1;
			return {
				id: node.id,
				type: 'schemaGraphNode',
				position: {
					x: node.level * xSpacing,
					y: columnCenteredY(node.indexInLevel, levelCount, maxLevelCount, ySpacing)
				},
				data: {
					kind: node.kind,
					name: node.schemaName ?? node.label,
					label: node.label,
					isRecursive: node.isRecursive ?? false,
					isRoot: node.schemaName === rootSchemaName && node.level === 0,
					method: node.method,
					path: node.path,
					operationId: node.operationId,
					widthPx: schemaWidth,
					hint: 'Click to inspect schema'
				} satisfies SchemaGraphNodeData,
				connectable: false,
				selectable: true,
				selected: node.schemaName === selectedSchemaName
			};
		});
	});

	const flowEdges = $derived.by((): Edge[] => {
		const layout = activeLayout;
		if (!layout) return [];
		return layout.edges.map((e) => {
			const color = edgeColor(e.kind);
			const label = showEdgeLabels ? e.label : '';
			return {
				id: e.id,
				source: e.source,
				target: e.target,
				sourceHandle: 'source',
				targetHandle: 'target',
				type: 'schemaGraphEdge',
				zIndex: 1,
				markerEnd: {
					type: MarkerType.ArrowClosed,
					color,
					width: 22,
					height: 22
				},
				data: {
					kind: e.kind,
					isBackEdge: e.isBackEdge ?? false,
					color,
					viaProperty: e.viaProperty,
					label
				} satisfies SchemaGraphEdgeData,
				selectable: false
			};
		});
	});

	function handleNodeClick({ node }: { node: Node }) {
		const data = node.data as SchemaGraphNodeData;
		if (data.kind === 'path') {
			if (viewMode === 'api-map') {
				selectedPathId = node.id;
			}
			if (data.operationId) {
				openOperationDetail(data.operationId);
			}
			return;
		}
		if (data.name) openSchemaDetail(data.name);
	}

	function parseFieldsText(text: string): string[] {
		return text
			.split(/[\n,]+/g)
			.map((t) => t.trim())
			.filter(Boolean);
	}

	const validation = $derived.by((): FieldsValidationResult | null => {
		if (!graph || !selectedSchemaName || viewMode !== 'schema-deps') return null;
		const leafPaths = graph.leafPathsBySchema[selectedSchemaName] ?? [];
		const captured = parseFieldsText(fieldsText);
		if (!captured.length) return null;
		return validateFieldsList(captured, selectedSchemaName, leafPaths);
	});

	function onViewModeChange(mode: GraphViewMode) {
		showEdgeLabels = mode === 'api-map';
		fitViewEpoch += 1;
	}

	function toggleEdgeKind(kind: ApiMapEdgeKind) {
		if (kind === 'request-body') showRequestEdges = !showRequestEdges;
		else if (kind === 'response') showResponseEdges = !showResponseEdges;
		else showParameterEdges = !showParameterEdges;
	}
</script>

<div class="oa-schema-graph oa-root" class:oa-schema-graph--dark={darkMode}>
	{#if graph}
		<div class="oa-schema-graph__toolbar" role="toolbar" aria-label="Schema graph controls">
			<label class="oa-schema-graph__label" for={viewModeId}>View</label>
			<select
				id={viewModeId}
				class="oa-schema-graph__select oa-schema-graph__select--mode"
				bind:value={viewMode}
				aria-label="Schema graph view mode"
				onchange={(e) =>
					onViewModeChange((e.currentTarget as HTMLSelectElement).value as GraphViewMode)}
			>
				<option value="api-map">API map</option>
				<option value="schema-deps">Schema dependencies</option>
			</select>

			{#if viewMode === 'schema-deps'}
				<label class="oa-schema-graph__label" for={rootSelectId}>Root</label>
				<select
					id={rootSelectId}
					class="oa-schema-graph__select"
					bind:value={rootSchemaName}
					aria-label="Root schema for dependency graph"
				>
					{#each rootSchemaOptions as name (name)}
						<option value={name}>{name}</option>
					{/each}
				</select>
				{#if eqlQuickPicks.length > 0}
					<span class="oa-schema-graph__label" id="oa-eql-label">Query &amp; EQL</span>
					<div class="oa-schema-graph__quick-picks" role="group" aria-labelledby="oa-eql-label">
						{#each eqlQuickPicks as name (name)}
							<button
								type="button"
								class="oa-schema-graph__chip"
								class:oa-schema-graph__chip--active={rootSchemaName === name}
								onclick={() => {
									rootSchemaName = name;
									showAllSchemas = false;
								}}
							>
								{name}
							</button>
						{/each}
					</div>
				{/if}
				<label class="oa-schema-graph__checkbox">
					<input type="checkbox" bind:checked={showAllSchemas} />
					Show all schemas
				</label>
				<label class="oa-schema-graph__checkbox">
					<input type="checkbox" bind:checked={showEdgeLabels} />
					Show edge labels
				</label>
			{:else}
				<label class="oa-schema-graph__label" for={tagFilterId}>Tag</label>
				<select
					id={tagFilterId}
					class="oa-schema-graph__select"
					bind:value={tagFilter}
					aria-label="Filter API map by tag"
				>
					<option value="">All tags</option>
					{#each apiMapTags as tag (tag)}
						<option value={tag}>{tag}</option>
					{/each}
				</select>
				<label class="oa-schema-graph__label" for="oa-api-map-path">Operation</label>
				<select
					id="oa-api-map-path"
					class="oa-schema-graph__select"
					bind:value={selectedPathId}
					aria-label="Focus API map on one operation"
					disabled={apiMapOperations.length === 0}
				>
					{#if apiMapOperations.length === 0}
						<option value="">No operations in this tag</option>
					{:else}
						{#each apiMapOperations as p (p.id)}
							<option value={p.id}>{p.method?.toUpperCase()} {p.path}</option>
						{/each}
					{/if}
				</select>
				<label class="oa-schema-graph__checkbox">
					<input type="checkbox" bind:checked={showEdgeLabels} />
					Show edge labels
				</label>
			{/if}

			<span class="oa-schema-graph__meta" aria-live="polite">
				{#if activeLayout}
					{activeLayout.nodes.length} nodes · {activeLayout.edges.length} edges
					{#if viewMode === 'api-map'}
						<span class="oa-schema-graph__meta-sub">({apiMapOperations.length} ops in tag)</span>
					{:else if showAllSchemas}
						<span class="oa-schema-graph__meta-sub">(all schemas)</span>
					{:else}
						<span class="oa-schema-graph__meta-sub">(from root)</span>
					{/if}
				{:else if viewMode === 'api-map' && graph && apiMapOperations.length === 0}
					<span class="oa-schema-graph__meta-sub">No operations in this tag</span>
				{/if}
			</span>
		</div>

		<div class="oa-schema-graph__legend" aria-label="Edge legend">
			{#if viewMode === 'api-map'}
				<button
					type="button"
					class="oa-schema-graph__legend-item oa-schema-graph__legend-item--request oa-schema-graph__legend-toggle"
					class:oa-schema-graph__legend-toggle--off={!showRequestEdges}
					aria-pressed={showRequestEdges}
					onclick={() => toggleEdgeKind('request-body')}
				>
					Request
				</button>
				<button
					type="button"
					class="oa-schema-graph__legend-item oa-schema-graph__legend-item--response oa-schema-graph__legend-toggle"
					class:oa-schema-graph__legend-toggle--off={!showResponseEdges}
					aria-pressed={showResponseEdges}
					onclick={() => toggleEdgeKind('response')}
				>
					Response
				</button>
				<button
					type="button"
					class="oa-schema-graph__legend-item oa-schema-graph__legend-item--parameter oa-schema-graph__legend-toggle"
					class:oa-schema-graph__legend-toggle--off={!showParameterEdges}
					aria-pressed={showParameterEdges}
					onclick={() => toggleEdgeKind('parameter')}
				>
					Parameter
				</button>
				<span class="oa-schema-graph__legend-hint">
					Operation → schemas · toggle filters · click path for operation · click schema for detail
				</span>
			{:else}
				<span class="oa-schema-graph__legend-item oa-schema-graph__legend-item--schema">$ref</span>
				<span class="oa-schema-graph__legend-item oa-schema-graph__legend-item--back">Cycle (back-edge)</span>
				<span class="oa-schema-graph__legend-hint">Hierarchical $ref graph · click a schema to inspect</span>
			{/if}
		</div>
	{/if}

	<div class="oa-schema-graph__canvas" aria-label="Schema graph">
		{#if graphLoading}
			<p class="oa-schema-graph__status">Loading API graph…</p>
		{:else if graphError}
			<p class="oa-schema-graph__status oa-schema-graph__status--error" role="alert">
				Could not load API graph: {graphError}
			</p>
		{:else if graph && activeLayout && activeLayout.nodes.length > 0}
			<div class="oa-schema-graph__flow" bind:this={flowHostEl}>
				{#if viewMode === 'api-map'}
					<div class="oa-schema-graph__columns" aria-hidden="true">
						<span class="oa-schema-graph__column-label">Operation</span>
						<span class="oa-schema-graph__column-label">Schemas</span>
					</div>
				{/if}
				{#if flowWidth > 0 && flowHeight > 0}
					<SvelteFlow
						nodes={flowNodes}
						edges={flowEdges}
						{nodeTypes}
						{edgeTypes}
						width={flowWidth}
						height={flowHeight}
						fitView
						fitViewOptions={{ padding: 0.2, minZoom: 0.3, maxZoom: 1.2 }}
						minZoom={0.1}
						maxZoom={2}
						nodesDraggable={false}
						nodesConnectable={false}
						elementsSelectable={true}
						edgesFocusable={false}
						colorMode={darkMode ? 'dark' : 'light'}
						onnodeclick={handleNodeClick}
						proOptions={{ hideAttribution: true }}
					>
						<Background
							id="schema-graph-bg"
							variant={BackgroundVariant.Dots}
							gap={18}
							size={1.15}
							patternColor={darkMode ? 'rgba(148, 163, 184, 0.22)' : 'rgba(100, 116, 139, 0.28)'}
							bgColor="transparent"
						/>
						<Controls position="bottom-left" />
						<SchemaGraphFitView {layoutKey} {flowWidth} {flowHeight} />
					</SvelteFlow>
				{/if}
			</div>
		{:else if graph}
			<p class="oa-schema-graph__status">
				{#if viewMode === 'api-map'}
					{apiMapOperations.length === 0
						? tagFilter
							? `No operations in this tag (${tagFilter}). Try another tag.`
							: 'No operations available in this API graph.'
						: activeEdgeKinds.length === 0
							? 'Enable at least one edge filter (Request, Response, or Parameter).'
							: 'Select a tag and operation to map request/response schemas.'}
				{:else}
					Select a root schema to explore $ref dependencies.
				{/if}
			</p>
		{/if}
	</div>
</div>

{#snippet schemaDetailHeader()}
	<div class="oa-modal-header-text">
		<p class="oa-modal-eyebrow">Schema detail</p>
		<h2 id={detailModalTitleId} class="oa-modal-title">
			{selectedExplorerEntry?.presentation.label ?? selectedSchemaName}
		</h2>
		<p class="oa-modal-subtitle font-mono">{selectedSchemaName}</p>
	</div>
	<button
		type="button"
		class="oa-modal-close"
		aria-label="Close schema detail"
		onclick={closeSchemaDetail}
	>
		<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
		</svg>
	</button>
{/snippet}

{#if detailModalOpen && selectedExplorerEntry}
	<div class="oa-root" class:dark={darkMode}>
		<OpenApiModal
			open={detailModalOpen}
			titleId={detailModalTitleId}
			{darkMode}
			size="wide"
			onClose={closeSchemaDetail}
			header={schemaDetailHeader}
		>
			<OpenApiSchemaDetail
				entry={selectedExplorerEntry}
				ancestryPath={ancestryPath}
				spec={sanitizedSpec}
				{darkMode}
				onNestedSelect={(e) => openSchemaDetail(e.name)}
			/>

			{#if viewMode === 'schema-deps'}
				<section class="oa-schema-graph__fields-tool" aria-label="FIELDS clause validation">
					<h3 class="oa-schema-graph__fields-title">FIELDS clause validation</h3>
					<label class="oa-schema-graph__fields-label" for={fieldsTextareaId}>
						Paste `FIELDS` list for <code class="font-mono">{selectedSchemaName}</code>
					</label>
					<textarea
						id={fieldsTextareaId}
						class="oa-schema-graph__fields-textarea"
						rows={6}
						placeholder={fieldsPlaceholder}
						bind:value={fieldsText}
					></textarea>

					{#if validation}
						<div class="oa-schema-graph__fields-results">
							<p class="oa-schema-graph__fields-summary">
								<span class="oa-schema-graph__pill oa-schema-graph__pill--valid">
									{validation.validLeafPaths.length} valid
								</span>
								<span class="oa-schema-graph__pill oa-schema-graph__pill--unknown">
									{validation.unknownPaths.length} unknown
								</span>
								<span class="oa-schema-graph__pill oa-schema-graph__pill--redundant">
									{validation.redundantPairs.length} redundant
								</span>
							</p>

							{#if validation.unknownPaths.length > 0}
								<ul class="oa-schema-graph__fields-list">
									{#each validation.unknownPaths as p (p)}
										<li class="oa-schema-graph__fields-item">{p}</li>
									{/each}
								</ul>
							{/if}

							{#if validation.redundantPairs.length > 0}
								<ul class="oa-schema-graph__fields-list">
									{#each validation.redundantPairs as pair (pair.parent + '|' + pair.child)}
										<li class="oa-schema-graph__fields-item">
											<span class="oa-schema-graph__fields-redundant-parent">{pair.parent}</span>
											→ {pair.child}
										</li>
									{/each}
								</ul>
							{/if}
						</div>
					{:else}
						<p class="oa-schema-graph__fields-hint">Paste field paths to validate against this schema.</p>
					{/if}
				</section>
			{/if}
		</OpenApiModal>
	</div>
{/if}

{#snippet operationDetailHeader()}
	<div class="oa-modal-header-text oa-op-modal-header">
		<h2 id={operationModalTitleId} class="oa-modal-title oa-modal-title--path">
			{#if inspectedOperation}
				<OpenApiMethodBadge method={inspectedOperation.method} />
				<span class="oa-modal-path">{inspectedOperation.path}</span>
			{/if}
		</h2>
		{#if inspectedOperation?.operationId}
			<p class="oa-modal-subtitle oa-op-modal-header__id">{inspectedOperation.operationId}</p>
		{/if}
		{#if onOperationNavigate && inspectedOperation}
			<button
				type="button"
				class="oa-schema-graph__open-in-paths"
				onclick={openOperationInPaths}
			>
				Open in Paths
			</button>
		{/if}
	</div>
	<button
		type="button"
		class="oa-modal-close"
		aria-label="Close operation detail"
		onclick={closeOperationDetail}
	>
		<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
		</svg>
	</button>
{/snippet}

{#if operationModalOpen && inspectedOperation}
	<div class="oa-root" class:dark={darkMode}>
		<OpenApiModal
			open={operationModalOpen}
			titleId={operationModalTitleId}
			{darkMode}
			size="docs"
			onClose={closeOperationDetail}
			header={operationDetailHeader}
		>
			{#key inspectedOperation.id}
				<OpenApiOperationDetail
					operation={inspectedOperation}
					spec={sanitizedSpec}
					{darkMode}
				/>
			{/key}
		</OpenApiModal>
	</div>
{/if}

<style>
	.oa-schema-graph {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.oa-schema-graph__toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.55rem;
		padding: 0.65rem 0.75rem;
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius-lg);
		background: linear-gradient(180deg, var(--oa-canvas-top), var(--oa-panel));
		box-shadow: var(--oa-panel-shadow);
	}

	.oa-schema-graph__label {
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.02em;
		text-transform: uppercase;
		color: var(--oa-text-muted);
	}

	.oa-schema-graph__select {
		flex: 1 1 10rem;
		min-width: 0;
		max-width: 22rem;
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius);
		padding: 0.45rem 0.625rem;
		font-size: 0.8125rem;
		font-family: var(--oa-font-code);
		background: var(--oa-panel);
		color: var(--oa-text);
	}

	.oa-schema-graph__select--mode {
		max-width: 14rem;
		font-family: var(--oa-font);
	}

	.oa-schema-graph__checkbox {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		color: var(--oa-text-muted);
	}

	.oa-schema-graph__quick-picks {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}

	.oa-schema-graph__chip {
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius-sm);
		padding: 0.28rem 0.5rem;
		font-size: 0.68rem;
		font-family: var(--oa-font-code);
		font-weight: 650;
		background: var(--oa-panel);
		color: var(--oa-text-muted);
		cursor: pointer;
	}

	.oa-schema-graph__chip:hover {
		border-color: color-mix(in srgb, var(--oa-focus-ring) 45%, var(--oa-panel-border));
		color: var(--oa-text);
	}

	.oa-schema-graph__chip--active {
		border-color: color-mix(in srgb, var(--oa-focus-ring) 55%, var(--oa-panel-border));
		background: color-mix(in srgb, var(--oa-focus-ring) 12%, var(--oa-panel));
		color: var(--oa-text);
	}

	.oa-schema-graph__meta {
		margin-left: auto;
		font-size: 0.75rem;
		color: var(--oa-text-muted);
	}

	.oa-schema-graph__meta-sub {
		margin-left: 0.25rem;
		opacity: 0.85;
	}

	.oa-schema-graph__legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		align-items: center;
		padding: 0.35rem 0.15rem 0.1rem;
	}

	.oa-schema-graph__legend-item {
		display: inline-flex;
		align-items: center;
		padding: 0.22rem 0.6rem;
		border-radius: 9999px;
		font-size: 0.68rem;
		font-weight: 650;
		letter-spacing: 0.01em;
		border: 1px solid color-mix(in srgb, var(--oa-panel-border) 85%, transparent);
		background: color-mix(in srgb, var(--oa-panel) 88%, transparent);
	}

	.oa-schema-graph__legend-item--schema {
		border-color: color-mix(in srgb, var(--oa-link-ref) 45%, transparent);
		color: var(--oa-link-ref);
	}

	.oa-schema-graph__legend-item--back {
		border-style: dashed;
		border-color: color-mix(in srgb, var(--oa-link-ref) 35%, transparent);
		color: var(--oa-text-muted);
	}

	.oa-schema-graph__legend-item--request {
		border-color: color-mix(in srgb, var(--oa-link-request) 45%, transparent);
		color: var(--oa-link-request);
	}

	.oa-schema-graph__legend-item--response {
		border-color: color-mix(in srgb, var(--oa-link-response) 45%, transparent);
		color: var(--oa-link-response);
	}

	.oa-schema-graph__legend-item--parameter {
		border-color: color-mix(in srgb, var(--oa-link-parameter) 45%, transparent);
		color: var(--oa-link-parameter);
	}

	.oa-schema-graph__legend-toggle {
		cursor: pointer;
		font-family: inherit;
		transition:
			opacity 0.12s ease,
			background 0.12s ease,
			box-shadow 0.12s ease;
	}

	.oa-schema-graph__legend-toggle:hover {
		box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 25%, transparent);
	}

	.oa-schema-graph__legend-toggle:not(.oa-schema-graph__legend-toggle--off) {
		background: color-mix(in srgb, currentColor 12%, var(--oa-panel));
		font-weight: 750;
	}

	.oa-schema-graph__legend-toggle--off {
		opacity: 0.42;
		text-decoration: line-through;
	}

	.oa-schema-graph__legend-hint {
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--oa-text-muted);
		padding: 0.18rem 0.35rem;
	}

	.oa-schema-graph__columns {
		position: absolute;
		z-index: 5;
		top: 0.65rem;
		left: 1rem;
		right: 1rem;
		display: flex;
		justify-content: space-between;
		pointer-events: none;
		max-width: 42rem;
	}

	.oa-schema-graph__column-label {
		padding: 0.2rem 0.55rem;
		border-radius: 9999px;
		font-size: 0.65rem;
		font-weight: 750;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--oa-text-muted);
		background: color-mix(in srgb, var(--oa-panel) 88%, transparent);
		border: 1px solid color-mix(in srgb, var(--oa-panel-border) 80%, transparent);
		backdrop-filter: blur(6px);
	}

	.oa-schema-graph__canvas {
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius-lg);
		background:
			radial-gradient(
				ellipse 80% 55% at 12% 0%,
				color-mix(in srgb, var(--oa-focus-ring) 6%, transparent),
				transparent 55%
			),
			linear-gradient(180deg, var(--oa-canvas-top), var(--oa-canvas-bottom));
		box-shadow: var(--oa-panel-shadow);
		min-height: min(68vh, 860px);
		overflow: hidden;
		position: relative;
	}

	.oa-schema-graph__flow {
		position: relative;
		display: flex;
		flex-direction: column;
		width: 100%;
		height: 100%;
		min-height: min(62vh, 780px);
		overflow: hidden;
	}

	.oa-schema-graph__flow :global(.svelte-flow) {
		flex: 1;
		width: 100%;
		min-height: 0;
		background: transparent !important;
	}

	.oa-schema-graph__flow :global(.svelte-flow__edges) {
		position: absolute !important;
		inset: 0 !important;
		width: 100% !important;
		height: 100% !important;
		overflow: visible !important;
		z-index: 20 !important;
		pointer-events: none !important;
	}

	.oa-schema-graph__flow :global(.svelte-flow__edges svg) {
		position: absolute !important;
		overflow: visible !important;
		width: 100% !important;
		height: 100% !important;
		min-width: 100% !important;
		min-height: 100% !important;
		left: 0 !important;
		top: 0 !important;
		pointer-events: none !important;
	}

	.oa-schema-graph__flow :global(.svelte-flow__nodes) {
		z-index: 10 !important;
	}

	.oa-schema-graph__flow :global(.svelte-flow__node) {
		pointer-events: all !important;
	}

	.oa-schema-graph__flow :global(.svelte-flow__edge-wrapper),
	.oa-schema-graph__flow :global(.svelte-flow__edge),
	.oa-schema-graph__flow :global(.svelte-flow__edge-path),
	.oa-schema-graph__flow :global(.svelte-flow__edge-interaction) {
		overflow: visible !important;
		pointer-events: none !important;
	}

	.oa-schema-graph__flow :global(.svelte-flow__controls) {
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius-lg);
		overflow: hidden;
		box-shadow: var(--oa-panel-shadow);
		backdrop-filter: blur(8px);
	}

	.oa-schema-graph__flow :global(.svelte-flow__controls-button) {
		background: var(--oa-panel);
		border-bottom: 1px solid var(--oa-panel-border);
		color: var(--oa-text-muted);
	}

	.oa-schema-graph__status {
		margin: 0;
		padding: 3rem 1.25rem;
		text-align: center;
		font-size: 0.875rem;
		color: var(--oa-text-muted);
	}

	.oa-schema-graph__status--error {
		color: #dc2626;
	}

	:global(.oa-modal-header-text) {
		min-width: 0;
		flex: 1;
	}

	:global(.oa-modal-eyebrow) {
		margin: 0 0 0.3rem;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--oa-text-muted, #64748b);
	}

	:global(.oa-modal-title) {
		margin: 0;
		font-family: var(--oa-font-headline, 'NokiaPureHeadline', ui-sans-serif, system-ui, sans-serif);
		font-size: 1.125rem;
		font-weight: 700;
		line-height: 1.3;
		color: var(--oa-text, #0f172a);
		word-break: break-word;
	}

	:global(.oa-modal-subtitle) {
		margin: 0.3rem 0 0;
		font-size: 0.75rem;
		color: var(--oa-text-muted, #64748b);
	}

	:global(.oa-modal-close) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: var(--oa-radius, 0.5rem);
		border: 1px solid transparent;
		background: transparent;
		color: var(--oa-text-muted, #64748b);
		cursor: pointer;
		transition:
			background 0.12s ease,
			border-color 0.12s ease,
			color 0.12s ease;
	}

	:global(.oa-modal-close:hover) {
		border-color: var(--oa-panel-border, #e2e8f0);
		background: color-mix(in srgb, var(--oa-panel-border, #e2e8f0) 22%, transparent);
		color: var(--oa-text, #0f172a);
	}

	:global(.oa-modal-close:focus-visible) {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring, #2563eb) 35%, transparent);
	}

	.oa-schema-graph__fields-tool {
		margin-top: 1.25rem;
		padding-top: 1rem;
		border-top: 1px solid color-mix(in srgb, var(--oa-panel-border) 70%, transparent);
	}

	.oa-schema-graph__fields-title {
		margin: 0 0 0.5rem;
		font-size: 0.875rem;
		font-weight: 700;
		color: var(--oa-text);
	}

	.oa-schema-graph__fields-label {
		display: block;
		margin-bottom: 0.35rem;
		font-size: 0.75rem;
		color: var(--oa-text-muted);
	}

	.oa-schema-graph__fields-textarea {
		width: 100%;
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius);
		background: var(--oa-bg, #f8fafc);
		font-family: var(--oa-font-code);
		font-size: 0.75rem;
		color: var(--oa-text);
		padding: 0.55rem 0.65rem;
		resize: vertical;
	}

	.oa-schema-graph__fields-textarea:focus {
		outline: none;
		border-color: color-mix(in srgb, var(--oa-focus-ring) 55%, var(--oa-panel-border));
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--oa-focus-ring) 18%, transparent);
	}

	.oa-schema-graph__fields-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin: 0.65rem 0 0.4rem;
	}

	.oa-schema-graph__pill {
		padding: 0.15rem 0.45rem;
		border-radius: 9999px;
		font-size: 0.68rem;
		font-weight: 700;
		border: 1px solid color-mix(in srgb, var(--oa-panel-border) 85%, transparent);
	}

	.oa-schema-graph__pill--valid {
		border-color: rgba(16, 185, 129, 0.45);
		color: #059669;
	}

	.oa-schema-graph__pill--unknown {
		border-color: rgba(220, 38, 38, 0.4);
		color: #dc2626;
	}

	.oa-schema-graph__pill--redundant {
		border-color: rgba(217, 119, 6, 0.45);
		color: #d97706;
	}

	.oa-schema-graph__fields-list {
		margin: 0.35rem 0 0;
		padding-left: 1.1rem;
		font-family: var(--oa-font-code);
		font-size: 0.72rem;
		color: var(--oa-text-muted);
	}

	.oa-schema-graph__fields-item {
		margin: 0.15rem 0;
	}

	.oa-schema-graph__fields-redundant-parent {
		color: color-mix(in srgb, #d97706 80%, var(--oa-text));
	}

	.oa-schema-graph__fields-hint {
		margin: 0.5rem 0 0;
		font-size: 0.75rem;
		color: var(--oa-text-muted);
	}

	.oa-schema-graph__open-in-paths {
		margin-top: 0.5rem;
		padding: 0.3rem 0.65rem;
		border: 1px solid var(--oa-panel-border);
		border-radius: var(--oa-radius);
		background: color-mix(in srgb, var(--oa-focus-ring) 12%, transparent);
		color: var(--oa-text);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 650;
		cursor: pointer;
	}

	.oa-schema-graph__open-in-paths:hover {
		background: color-mix(in srgb, var(--oa-focus-ring) 22%, transparent);
	}

	:global(.oa-op-modal-header) {
		min-width: 0;
		flex: 1;
	}

	:global(.oa-modal-title--path) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.625rem;
		font-size: 1rem;
		line-height: 1.35;
	}

	:global(.oa-modal-path) {
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.9375rem;
		font-weight: 600;
		word-break: break-all;
		min-width: 0;
		letter-spacing: -0.01em;
	}

	:global(.oa-op-modal-header__id) {
		margin: 0.35rem 0 0;
		font-family: var(--oa-font-code, 'Fira Code', ui-monospace, monospace);
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--oa-text-muted, #64748b);
		word-break: break-all;
	}
</style>

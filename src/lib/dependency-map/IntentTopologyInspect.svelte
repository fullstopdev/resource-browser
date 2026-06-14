<script lang="ts">
	import { getRelationLabel, MAP_ROLE_LABELS } from './relationLabels';
	import type { IntentTopologyNodeData } from './intentTopologyLayout';
	import type { GraphNode } from './types';

	type DetailRow = {
		key: string;
		label: string;
		value: string;
		code?: boolean;
		relColor?: string;
	};

	let {
		selected,
		onRefocus,
		onViewCrd
	}: {
		selected: IntentTopologyNodeData;
		onRefocus?: (id: string) => void;
		onViewCrd?: (node: GraphNode) => void;
	} = $props();

	function relLabel(rel: IntentTopologyNodeData['rel']): string {
		if (!rel) return '—';
		return getRelationLabel(rel);
	}

	function positionLabel(data: IntentTopologyNodeData): string {
		if (data.isFocus) return 'Map focus';
		if (data.depth === 0) return MAP_ROLE_LABELS.focus;
		return `Hop ${data.depth} · ${data.roleLabel}`;
	}

	function statusLabel(data: IntentTopologyNodeData): string {
		if (data.confidenceTier === 3 || data.edgeSource === 'inferred') return 'Inferred';
		if (data.confidenceTier === 2 || data.edgeSource === 'semantic') return 'Semantic';
		return 'Strong';
	}

	const isWeak = $derived(selected.confidenceTier === 3 || selected.edgeSource === 'inferred');

	const detailRows = $derived.by((): DetailRow[] => {
		const rows: DetailRow[] = [
			{
				key: 'position',
				label: 'Position',
				value: positionLabel(selected)
			}
		];

		if (!selected.isFocus && selected.rel) {
			rows.push({
				key: 'relation',
				label: 'Link type',
				value: relLabel(selected.rel),
				relColor: selected.relColor
			});
		}

		if (selected.field) {
			rows.push({
				key: 'field',
				label: 'Field',
				value: selected.field,
				code: true
			});
		}

		if (selected.reason) {
			rows.push({
				key: 'reason',
				label: 'Reason',
				value: selected.reason
			});
		}

		if (selected.isFocus || selected.resourceId) {
			rows.push({
				key: 'resource',
				label: 'Resource',
				value: selected.resourceId,
				code: true
			});
		}

		if (selected.graphNode?.version) {
			rows.push({
				key: 'version',
				label: 'Version',
				value: selected.graphNode.version,
				code: true
			});
		}

		const groupValue = selected.shortGroup || selected.group;
		if (groupValue) {
			rows.push({
				key: 'group',
				label: 'API group',
				value: groupValue,
				code: true
			});
		}

		return rows;
	});
</script>

<div
	class="intent-topo-inspect"
	class:intent-topo-inspect-focus={selected.isFocus}
	class:intent-topo-inspect-weak={isWeak}
	aria-live="polite"
	style:--intent-status-color={selected.statusColor}
	style:--intent-rel-color={selected.relColor}
>
	<div class="intent-topo-inspect-card">
		<span class="intent-topo-inspect-rail" aria-hidden="true"></span>

		<header class="intent-topo-inspect-header">
			<div class="intent-topo-inspect-title-row">
				<span class="intent-topo-inspect-status" aria-label={statusLabel(selected)} title={statusLabel(selected)}></span>
				<h3 class="intent-topo-inspect-name">{selected.kind}</h3>
			</div>

			<div class="intent-topo-inspect-chips">
				<span class="intent-topo-inspect-chip intent-topo-inspect-chip-type intent-topo-inspect-chip-type-{selected.type}">
					{selected.type}
				</span>
				<span class="intent-topo-inspect-chip intent-topo-inspect-chip-role">{selected.roleLabel}</span>
				{#if selected.shortGroup || selected.group}
					<span
						class="intent-topo-inspect-chip intent-topo-inspect-chip-group"
						title={selected.group || selected.shortGroup}
					>
						{selected.shortGroup || selected.group}
					</span>
				{/if}
			</div>

			{#if selected.graphNode?.description}
				<p class="intent-topo-inspect-summary">{selected.graphNode.description}</p>
			{/if}
		</header>

		<div class="intent-topo-inspect-table-wrap">
			<table class="intent-topo-inspect-table">
				<tbody>
					{#each detailRows as row (row.key)}
						<tr>
							<th scope="row">{row.label}</th>
							<td class:intent-topo-inspect-value-code={row.code}>
								{#if row.relColor}
									<span class="intent-topo-inspect-rel">
										<span class="intent-topo-inspect-rel-swatch" style:background={row.relColor} aria-hidden="true"></span>
										{row.value}
									</span>
								{:else}
									{row.value}
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="intent-topo-inspect-actions">
			{#if !selected.isFocus}
				<button
					type="button"
					class="intent-topo-inspect-btn intent-topo-inspect-btn-primary"
					onclick={() => onRefocus?.(selected.nodeId)}
				>
					Refocus map
				</button>
			{/if}
			{#if onViewCrd && selected.graphNode}
				<button
					type="button"
					class="intent-topo-inspect-btn intent-topo-inspect-btn-secondary"
					onclick={() => onViewCrd(selected.graphNode!)}
				>
					View CRD
				</button>
			{/if}
		</div>
	</div>
</div>

<style>
	.intent-topo-inspect {
		min-width: 0;
		margin-top: 0;
		font-family: var(--dep-font, inherit);
		color: var(--dep-text);
	}

	.intent-topo-inspect-card {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.5rem 0.55rem 0.55rem 0.68rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: var(--dep-radius-sm, 0.375rem);
		background: color-mix(in srgb, var(--dep-bg) 40%, var(--dep-panel));
		overflow: hidden;
	}

	.intent-topo-inspect-rail {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 4px;
		background: var(--intent-status-color, var(--dep-chip-active));
		border-radius: 0.5rem 0 0 0.5rem;
	}

	.intent-topo-inspect-focus .intent-topo-inspect-card {
		border-color: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 40%, var(--dep-panel-border));
	}

	.intent-topo-inspect-weak .intent-topo-inspect-card {
		border-style: dashed;
	}

	.intent-topo-inspect-header {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		min-width: 0;
	}

	.intent-topo-inspect-title-row {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		min-width: 0;
	}

	.intent-topo-inspect-status {
		flex-shrink: 0;
		width: 0.55rem;
		height: 0.55rem;
		border-radius: 9999px;
		background: var(--intent-status-color, var(--dep-chip-active));
		box-shadow:
			0 0 0 2px color-mix(in srgb, var(--intent-status-color, var(--dep-chip-active)) 22%, transparent),
			0 0 8px color-mix(in srgb, var(--intent-status-color, var(--dep-chip-active)) 35%, transparent);
	}

	.intent-topo-inspect-name {
		margin: 0;
		font-size: 0.9375rem;
		font-weight: 700;
		line-height: 1.2;
		letter-spacing: -0.015em;
		color: var(--dep-text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.intent-topo-inspect-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.28rem;
	}

	.intent-topo-inspect-chip {
		padding: 0.08rem 0.42rem;
		border-radius: 9999px;
		font-size: 0.58rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		line-height: 1.35;
		border: 1px solid transparent;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.intent-topo-inspect-chip-type-config {
		background: color-mix(in srgb, var(--dep-config, #2563eb) 12%, var(--dep-panel));
		color: var(--dep-config, #2563eb);
		border-color: color-mix(in srgb, var(--dep-config, #2563eb) 20%, var(--dep-panel-border));
	}

	.intent-topo-inspect-chip-type-state {
		background: color-mix(in srgb, var(--dep-state, #16a34a) 12%, var(--dep-panel));
		color: var(--dep-state, #16a34a);
		border-color: color-mix(in srgb, var(--dep-state, #16a34a) 20%, var(--dep-panel-border));
	}

	.intent-topo-inspect-chip-type-other {
		background: color-mix(in srgb, var(--dep-text-muted) 12%, var(--dep-panel));
		color: var(--dep-text-muted);
		border-color: color-mix(in srgb, var(--dep-text-muted) 18%, var(--dep-panel-border));
	}

	:global(.dark) .intent-topo-inspect-chip-type-config {
		color: #60a5fa;
	}

	:global(.dark) .intent-topo-inspect-chip-type-state {
		color: #4ade80;
	}

	.intent-topo-inspect-chip-role {
		background: color-mix(in srgb, var(--intent-status-color, var(--dep-chip-active)) 14%, var(--dep-panel));
		color: var(--intent-status-color, var(--dep-chip-active));
		border-color: color-mix(in srgb, var(--intent-status-color, var(--dep-chip-active)) 24%, var(--dep-panel-border));
	}

	.intent-topo-inspect-chip-group {
		font-family: var(--dep-font-code, ui-monospace, monospace);
		font-size: 0.56rem;
		font-weight: 600;
		text-transform: none;
		letter-spacing: 0;
		background: color-mix(in srgb, var(--dep-panel-border) 28%, var(--dep-panel));
		color: var(--dep-text-muted);
		border-color: var(--dep-panel-border);
	}

	.intent-topo-inspect-summary {
		margin: 0;
		font-size: 0.7rem;
		line-height: 1.45;
		color: var(--dep-text-muted);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.intent-topo-inspect-table-wrap {
		border: 1px solid var(--dep-panel-border);
		border-radius: 0.4rem;
		background: color-mix(in srgb, var(--dep-bg, var(--dep-panel)) 55%, transparent);
		overflow: hidden;
	}

	.intent-topo-inspect-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.6875rem;
		line-height: 1.45;
	}

	.intent-topo-inspect-table tr + tr {
		border-top: 1px solid color-mix(in srgb, var(--dep-panel-border) 65%, transparent);
	}

	.intent-topo-inspect-table th {
		width: 4.75rem;
		padding: 0.35rem 0.45rem 0.35rem 0.5rem;
		font-weight: 650;
		font-size: 0.625rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		text-align: left;
		vertical-align: top;
		color: var(--dep-text-muted);
		white-space: nowrap;
	}

	.intent-topo-inspect-table td {
		padding: 0.35rem 0.5rem 0.35rem 0;
		color: var(--dep-text);
		vertical-align: top;
		word-break: break-word;
	}

	.intent-topo-inspect-value-code {
		font-family: var(--dep-font-code, ui-monospace, monospace);
		font-size: 0.64rem;
		font-weight: 500;
	}

	.intent-topo-inspect-rel {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-weight: 600;
	}

	.intent-topo-inspect-rel-swatch {
		flex-shrink: 0;
		width: 0.85rem;
		height: 0.18rem;
		border-radius: 9999px;
		box-shadow: 0 0 0 1px color-mix(in srgb, var(--dep-panel-border) 60%, transparent);
	}

	.intent-topo-inspect-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		padding-top: 0.1rem;
	}

	.intent-topo-inspect-btn {
		padding: 0.375rem 0.7rem;
		border: 1px solid var(--dep-panel-border);
		border-radius: var(--dep-radius-sm, 0.375rem);
		background: color-mix(in srgb, var(--dep-bg) 25%, var(--dep-panel));
		font-family: var(--dep-font, inherit);
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--dep-text);
		cursor: pointer;
		transition:
			border-color 0.15s ease,
			color 0.15s ease,
			background 0.15s ease,
			box-shadow 0.15s ease,
			transform 0.15s ease;
	}

	.intent-topo-inspect-btn:hover {
		border-color: var(--dep-focus-ring, var(--dep-chip-active));
		color: var(--dep-focus-ring, var(--dep-chip-active));
		background: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 6%, var(--dep-panel));
		transform: translateY(-1px);
	}

	.intent-topo-inspect-btn-primary {
		border-color: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 45%, var(--dep-panel-border));
		background: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 12%, var(--dep-panel));
		color: var(--dep-focus-ring, var(--dep-chip-active));
		box-shadow: 0 1px 3px color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 12%, transparent);
	}

	.intent-topo-inspect-btn-primary:hover {
		border-color: var(--dep-focus-ring, var(--dep-chip-active));
		background: color-mix(in srgb, var(--dep-focus-ring, var(--dep-chip-active)) 18%, var(--dep-panel));
		color: var(--dep-focus-ring, var(--dep-chip-active));
	}

	.intent-topo-inspect-btn-secondary {
		color: var(--dep-text-muted);
	}

	.intent-topo-inspect-btn-secondary:hover {
		color: var(--dep-text);
	}
</style>

<script lang="ts">
	import type { Schema } from '$lib/structure';
	import Tree from './Tree.svelte';
	import { getDescription, getScope } from './functions';

	export let hash: string = '';
	export let source: string;
	export let type: string;
	export let leftData: Schema;
	export let rightData: Schema | null = null;
	export let side: 'left' | 'right' = 'left';

	const data = side === 'left' ? leftData : rightData || leftData;
	const compareData = side === 'left' ? rightData : leftData;

	const desc = getDescription(data);
	const scope = getScope(data);

	const borderColor =
		type === 'status'
			? 'border-green-400 dark:border-green-700'
			: 'border-gray-300 dark:border-gray-600';

	function fieldExists(key: string): boolean {
		if (!compareData) return true;
		const compareScope = getScope(compareData);
		return 'properties' in compareScope && key in compareScope.properties;
	}

	function fieldDifferent(key: string): boolean {
		if (!compareData) return false;
		const compareScope = getScope(compareData);
		if (!('properties' in scope) || !('properties' in compareScope)) return false;
		return JSON.stringify(scope.properties[key]) !== JSON.stringify(compareScope.properties[key]);
	}

	/**
	 * Diff status from this side's perspective:
	 * - LEFT side: field only here → removed (red); field only on right → gap (unchanged)
	 * - RIGHT side: field only here → added (green); field only on left → gap (unchanged)
	 */
	function getDiffStatus(key: string): 'added' | 'removed' | 'modified' | 'unchanged' {
		if (!compareData) return 'unchanged';

		const existsHere = 'properties' in scope && key in scope.properties;
		const existsThere = fieldExists(key);

		if (existsHere && !existsThere) return side === 'left' ? 'removed' : 'added';
		if (!existsHere && existsThere) return 'unchanged'; // shown as ghost for alignment
		if (existsHere && existsThere && fieldDifferent(key)) return 'modified';

		return 'unchanged';
	}

	function hasDescendantChanges(obj: any, compareObj: any): boolean {
		if (!obj && !compareObj) return false;
		if (!obj || !compareObj) return true;
		return JSON.stringify(obj) !== JSON.stringify(compareObj);
	}

	function isObjectSchema(sch: any): boolean {
		if (!sch) return false;
		try {
			return 'properties' in getScope(sch);
		} catch {
			return false;
		}
	}

	const compareScope = compareData ? getScope(compareData) : null;

	// Use the newer (right) scope as the canonical key order so both sides render in sync.
	const canonicalScope = rightData ? getScope(rightData) : scope;

	function getCombinedKeys(): string[] {
		const baseKeys =
			canonicalScope && 'properties' in canonicalScope
				? Object.keys(canonicalScope.properties)
				: 'properties' in scope
					? Object.keys(scope.properties)
					: [];

		const otherScope = canonicalScope === scope ? compareScope : scope;
		const otherKeys =
			otherScope && 'properties' in otherScope ? Object.keys(otherScope.properties) : [];

		const combined = [...baseKeys];
		for (const k of otherKeys) {
			if (!combined.includes(k)) combined.push(k);
		}
		return combined;
	}
</script>

<p class="mb-0 py-1 text-sm text-gray-900 dark:text-gray-200">{type.toUpperCase()}</p>
<ul class="ml-2 border-l px-3 dark:bg-gray-800 {borderColor}">
	<li class="px-1 pt-1.5 text-sm leading-relaxed font-light whitespace-normal text-gray-600 dark:text-gray-300">
		{desc}
	</li>

	{#if 'properties' in scope || (compareScope && 'properties' in compareScope)}
		{#each getCombinedKeys() as key (key)}
			{@const requiredList = 'required' in scope ? scope.required : []}
			{@const existsHere = 'properties' in scope && key in scope.properties}
			{@const folder = existsHere ? (scope as any).properties[key] : null}
			{@const diffStatus = getDiffStatus(key)}
			{@const bgClass =
				diffStatus === 'added'
					? 'bg-green-100 dark:bg-green-900/20 border-l-3 border-green-600 dark:border-green-500'
					: diffStatus === 'removed'
						? 'bg-red-100 dark:bg-red-900/20 border-l-3 border-red-600 dark:border-red-500'
						: diffStatus === 'modified'
							? 'bg-amber-100 dark:bg-yellow-900/20 border-l-3 border-amber-600 dark:border-yellow-500'
							: ''}
			{@const fieldCompareData =
				compareScope && 'properties' in compareScope && key in compareScope.properties
					? compareScope.properties[key]
					: null}
			{@const localField = 'properties' in scope ? ((scope as any).properties[key] ?? null) : null}

			<div class="relative {bgClass} {bgClass ? 'my-1 rounded-md' : ''}">
				{#if existsHere}
					<!--
						Tree already renders all metadata (enum, format, default, constraints, array size)
						with full diff-aware placeholder rows for alignment. No duplication needed here.
					-->
					<Tree
						{hash}
						{source}
						{key}
						folder={folder as Schema}
						{requiredList}
						{borderColor}
						parent={type}
						expanded={diffStatus !== 'unchanged' || hasDescendantChanges(folder, fieldCompareData)}
						diffMode={!!compareData}
						diffCompareData={fieldCompareData}
						diffSide={side}
						diffCurrentData={existsHere ? (scope as any).properties[key] : null}
					/>
				{:else}
					<!--
						Field does not exist on this side — render a ghost Tree using the compare-side
						schema so the row height and indentation match the other panel for alignment.
						Tree handles its own ghost placeholder rows for metadata.
					-->
					<Tree
						{hash}
						{source}
						{key}
						folder={fieldCompareData as Schema}
						{requiredList}
						{borderColor}
						parent={type}
						expanded={hasDescendantChanges(fieldCompareData, localField)}
						diffMode={!!compareData}
						diffCompareData={null}
						diffSide={side}
						diffCurrentData={null}
						ghost={true}
					/>
				{/if}
			</div>
		{/each}
	{/if}
</ul>
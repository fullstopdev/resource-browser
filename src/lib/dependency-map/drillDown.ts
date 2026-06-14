/** History excludes the current focus; strip current focus and consecutive duplicates. */
export function normalizeFocusHistory(
	focusHistory: string[],
	currentFocusId: string
): string[] {
	const withoutCurrent = focusHistory.filter((id) => id !== currentFocusId);
	return withoutCurrent.filter((id, i) => i === 0 || id !== withoutCurrent[i - 1]);
}

/** Full drill-down trail from history plus current focus. */
export function breadcrumbPath(focusHistory: string[], currentFocusId: string): string[] {
	return [...normalizeFocusHistory(focusHistory, currentFocusId), currentFocusId];
}

/**
 * History after drilling from current focus into a neighbor.
 * Appends the current focus to preserve the full trail; if the target is already
 * on the trail, truncate to that point instead of duplicating.
 */
export function historyAfterRefocus(
	focusHistory: string[],
	currentFocusId: string,
	targetId: string
): string[] {
	const history = normalizeFocusHistory(focusHistory, currentFocusId);
	if (targetId === currentFocusId) return history;

	const fullPath = [...history, currentFocusId];
	const existingIndex = fullPath.lastIndexOf(targetId);
	if (existingIndex >= 0 && existingIndex < fullPath.length - 1) {
		return fullPath.slice(0, existingIndex);
	}

	return [...history, currentFocusId];
}

/** History after navigating breadcrumb to an earlier focus in the path. */
export function historyAfterBreadcrumb(
	focusHistory: string[],
	currentFocusId: string,
	targetId: string
): string[] | null {
	if (targetId === currentFocusId) return null;
	const history = normalizeFocusHistory(focusHistory, currentFocusId);
	const fullPath = [...history, currentFocusId];
	const index = fullPath.lastIndexOf(targetId);
	if (index < 0) return null;
	return fullPath.slice(0, index);
}

/** Consecutive node pairs along a breadcrumb trail (for path-edge highlighting). */
export function breadcrumbSegmentPairs(
	pathIds: string[]
): Array<{ from: string; to: string }> {
	const pairs: Array<{ from: string; to: string }> = [];
	for (let i = 0; i < pathIds.length - 1; i++) {
		pairs.push({ from: pathIds[i], to: pathIds[i + 1] });
	}
	return pairs;
}

export function edgeConnectsPair(
	source: string,
	target: string,
	from: string,
	to: string
): boolean {
	return (source === from && target === to) || (source === to && target === from);
}

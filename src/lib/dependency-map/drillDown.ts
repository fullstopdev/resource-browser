/** History after drilling from current focus into a neighbor. */
export function historyAfterRefocus(focusHistory: string[], currentFocusId: string): string[] {
	return [...focusHistory, currentFocusId];
}

/** History after navigating breadcrumb to an earlier focus in the path. */
export function historyAfterBreadcrumb(
	focusHistory: string[],
	currentFocusId: string,
	targetId: string
): string[] | null {
	if (targetId === currentFocusId) return null;
	const fullPath = [...focusHistory, currentFocusId];
	const index = fullPath.indexOf(targetId);
	if (index < 0) return null;
	return fullPath.slice(0, index);
}

export function breadcrumbPath(focusHistory: string[], currentFocusId: string): string[] {
	return [...focusHistory, currentFocusId];
}

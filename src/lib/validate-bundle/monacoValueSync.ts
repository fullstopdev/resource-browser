/** True when bind:value changed from the parent, not echoed from the editor. */
export function isExternalValueUpdate(boundValue: string, lastEmittedValue: string): boolean {
	return boundValue !== lastEmittedValue;
}

import { writable } from 'svelte/store';

export type GlobalAskContext = {
	release?: string;
	kind?: string;
	group?: string;
	name?: string;
	version?: string;
	question?: string;
};

export const globalAskOpen = writable(false);
export const globalAskContext = writable<GlobalAskContext | null>(null);

export function openGlobalAsk(context?: GlobalAskContext): void {
	if (context) {
		globalAskContext.set(context);
	}
	globalAskOpen.set(true);
}

export function closeGlobalAsk(): void {
	globalAskOpen.set(false);
}

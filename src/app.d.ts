/// <reference types="@cloudflare/workers-types" />

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				AI: Ai;
				AI_CACHE?: KVNamespace;
			};
			/** Cloudflare execution context (waitUntil for background KV writes). */
			context?: ExecutionContext;
		}
	}
}

export {};

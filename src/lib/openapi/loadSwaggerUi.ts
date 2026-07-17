import swaggerBundleUrl from 'swagger-ui-dist/swagger-ui-bundle.js?url';

export interface SwaggerUiBundle {
	(config: Record<string, unknown>): unknown;
	presets: { apis: unknown };
}

declare global {
	interface Window {
		SwaggerUIBundle?: SwaggerUiBundle;
	}
}

let cssLoaded = false;
let loadPromise: Promise<SwaggerUiBundle> | null = null;

function loadStylesheet(href: string): Promise<void> {
	return new Promise((resolve, reject) => {
		if (document.querySelector(`link[data-openapi-swagger-ui="true"]`)) {
			resolve();
			return;
		}
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		link.dataset.openapiSwaggerUi = 'true';
		link.onload = () => resolve();
		link.onerror = () => reject(new Error('Failed to load Swagger UI stylesheet'));
		document.head.appendChild(link);
	});
}

function loadScript(src: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = src;
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
		document.head.appendChild(script);
	});
}

/** Load Swagger UI bundle once (browser-only). */
export async function loadSwaggerUiBundle(): Promise<SwaggerUiBundle> {
	if (loadPromise) return loadPromise;

	loadPromise = (async () => {
		if (typeof window === 'undefined') {
			throw new Error('Swagger UI can only load in the browser');
		}
		if (window.SwaggerUIBundle) return window.SwaggerUIBundle;

		if (!cssLoaded) {
			const cssModule = await import('swagger-ui-dist/swagger-ui.css?url');
			await loadStylesheet(cssModule.default);
			cssLoaded = true;
		}

		await loadScript(swaggerBundleUrl);

		if (!window.SwaggerUIBundle) {
			throw new Error('Swagger UI bundle failed to initialize');
		}

		return window.SwaggerUIBundle;
	})();

	return loadPromise;
}

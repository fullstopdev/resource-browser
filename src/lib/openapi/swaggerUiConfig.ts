import type { SwaggerUiBundle } from './loadSwaggerUi';
import { createSwaggerOpsFilterPlugin } from './swaggerOpsFilter';

export type OpenApiDocView = 'paths' | 'schemaGraph';

export type SwaggerUiConfigOptions = {
	specId?: string;
};

/** Read-only Swagger UI options aligned with resource-browser UX. */
export function buildSwaggerUiConfig(
	SwaggerUIBundle: SwaggerUiBundle,
	spec: Record<string, unknown>,
	mountEl: HTMLElement,
	view: OpenApiDocView = 'paths',
	_options: SwaggerUiConfigOptions = {}
): Record<string, unknown> {
	return {
		spec,
		domNode: mountEl,
		deepLinking: view === 'paths',
		filter: view === 'paths',
		tryItOutEnabled: false,
		supportedSubmitMethods: [],
		docExpansion: 'list',
		defaultModelsExpandDepth: view === 'paths' ? -1 : 1,
		defaultModelExpandDepth: 1,
		displayOperationId: false,
		operationsSorter: 'alpha',
		tagsSorter: 'alpha',
		displayRequestDuration: false,
		persistAuthorization: false,
		showExtensions: false,
		showCommonExtensions: false,
		validatorUrl: null,
		syntaxHighlight: { activate: true, theme: 'monokai' },
		presets: [SwaggerUIBundle.presets.apis],
		plugins: [createSwaggerOpsFilterPlugin()],
		layout: 'BaseLayout'
	};
}

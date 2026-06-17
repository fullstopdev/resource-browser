import type Ajv from 'ajv';

let ajvInstance: Ajv | null = null;
let ajvLoad: Promise<Ajv> | null = null;

/** Reuse one AJV instance across validations — compiling validators is cached separately. */
export async function getSharedAjv(): Promise<Ajv> {
	if (ajvInstance) return ajvInstance;
	if (!ajvLoad) {
		ajvLoad = import('ajv').then(({ default: AjvCtor }) => {
			ajvInstance = new AjvCtor({
				allErrors: true,
				verbose: true,
				strict: false,
				validateFormats: false,
				coerceTypes: false
			});
			return ajvInstance;
		});
	}
	return ajvLoad;
}

import type Ajv from 'ajv';
import type { Format } from 'ajv';

let ajvInstance: Ajv | null = null;
let ajvLoad: Promise<Ajv> | null = null;

const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;

/**
 * The `format` values used by EDA CRDs, with Kubernetes semantics. Deliberately not ajv-formats:
 * Kubernetes `duration` is a Go duration (`30s`, `1h30m`), not ISO 8601 (`PT30S`).
 * Formats not listed here are ignored (strict mode is off).
 */
export const CRD_FORMATS: Record<string, Format> = {
	int32: {
		type: 'number',
		validate: (n: number) => Number.isInteger(n) && n >= INT32_MIN && n <= INT32_MAX
	},
	// JS numbers can't represent the full int64 range; any integer is accepted.
	int64: { type: 'number', validate: (n: number) => Number.isInteger(n) },
	ipv4: /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/,
	'date-time':
		/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt]([01]\d|2[0-3]):[0-5]\d:([0-5]\d|60)(\.\d+)?([Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/,
	duration: /^-?(\d+(\.\d+)?(ns|us|µs|ms|s|m|h))+$|^0$/,
	uri: (value: string) => {
		try {
			return Boolean(new URL(value).protocol);
		} catch {
			return false;
		}
	}
};

/** Reuse one AJV instance across validations — compiling validators is cached separately. */
export async function getSharedAjv(): Promise<Ajv> {
	if (ajvInstance) return ajvInstance;
	if (!ajvLoad) {
		ajvLoad = import('ajv').then(({ default: AjvCtor }) => {
			ajvInstance = new AjvCtor({
				allErrors: true,
				verbose: true,
				strict: false,
				validateFormats: true,
				formats: CRD_FORMATS,
				coerceTypes: false,
				// Unknown formats are ignored by design; don't log a warning for each one.
				logger: false
			});
			return ajvInstance;
		});
	}
	return ajvLoad;
}

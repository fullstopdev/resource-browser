import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import {
	collectMissingRequiredFields,
	getRequiredFields,
	normalizeSchemaForAjv,
	resolveObjectSchema
} from './requiredFields';
import { getOrCompileValidator } from '$lib/yaml-validation/schemaCache';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const targetNodeYaml = readFileSync(
	join(root, 'static/resources/26.4.2/targetnodes.core.eda.nokia.com/v1.yaml'),
	'utf8'
);
const targetNodeSchema = loadStaticYaml(targetNodeYaml) as {
	schema?: { openAPIV3Schema?: { properties?: { spec?: unknown } } };
};
const specSchema = targetNodeSchema.schema?.openAPIV3Schema?.properties?.spec;

const topoNodeYaml = readFileSync(
	join(root, 'static/resources/26.4.2/toponodes.core.eda.nokia.com/v1.yaml'),
	'utf8'
);
const topoNodeSchema = loadStaticYaml(topoNodeYaml) as {
	schema?: { openAPIV3Schema?: { properties?: { spec?: unknown } } };
};
const topoNodeSpecSchema = topoNodeSchema.schema?.openAPIV3Schema?.properties?.spec;

describe('requiredFields', () => {
	it('resolves top-level spec required fields', () => {
		expect(getRequiredFields(specSchema)).toEqual(['address', 'operatingSystem']);
	});

	it('resolves nested required fields from object properties', () => {
		const dhcp4 = resolveObjectSchema(specSchema)?.properties.dhcp4;
		expect(getRequiredFields(dhcp4)).toEqual(['address', 'options']);
	});

	it('resolves required fields on array item objects', () => {
		const dhcp4 = resolveObjectSchema(specSchema)?.properties.dhcp4;
		const optionsSchema = resolveObjectSchema(dhcp4)?.properties.options;
		const itemsSchema = (optionsSchema as Record<string, unknown>).items;
		expect(getRequiredFields(itemsSchema)).toEqual(['option', 'value']);
	});

	it('merges required fields from allOf branches', () => {
		const merged = resolveObjectSchema({
			allOf: [{ required: ['configs'] }, { properties: { version: { type: 'string' } } }]
		});
		expect(merged?.required).toEqual(['configs']);
		expect(merged?.properties.version).toBeDefined();
	});

	it('reports missing top-level and nested required fields', () => {
		const missing = collectMissingRequiredFields(
			{
				dhcp4: {
					options: [{}]
				}
			},
			specSchema
		);
		const paths = missing.map((err) => err.path).sort();
		expect(paths).toContain('address');
		expect(paths).toContain('operatingSystem');
		expect(paths).toContain('dhcp4.address');
		expect(paths).toContain('dhcp4.options[0].option');
		expect(paths).toContain('dhcp4.options[0].value');
	});

	it('accepts explicit null on optional TopoNode string fields after AJV normalization', () => {
		const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
		const validator = getOrCompileValidator(
			ajv,
			'toponode-null-test::spec',
			topoNodeSpecSchema
		);
		const spec = {
			license: null,
			macAddress: null,
			nodeProfile: 'srlinux-ghcr-25.10.1-dcf-bp',
			operatingSystem: 'srl',
			platform: '8250',
			version: '25.10.1'
		};
		expect(validator(spec)).toBe(true);
		expect(validator.errors).toBeNull();
	});

	it('does not treat explicit null on optional fields as missing required', () => {
		const missing = collectMissingRequiredFields(
			{
				license: null,
				macAddress: null,
				nodeProfile: 'profile-a'
			},
			topoNodeSpecSchema
		);
		expect(missing.map((err) => err.path)).not.toContain('license');
		expect(missing.map((err) => err.path)).not.toContain('macAddress');
	});

	it('adds null to optional scalar property types during normalization', () => {
		const normalized = normalizeSchemaForAjv({
			type: 'object',
			properties: {
				license: { type: 'string' },
				nodeProfile: { type: 'string' }
			},
			required: ['nodeProfile']
		}) as { properties: Record<string, { type: string | string[] }> };

		expect(normalized.properties.license.type).toEqual(['string', 'null']);
		expect(normalized.properties.nodeProfile.type).toBe('string');
	});
});

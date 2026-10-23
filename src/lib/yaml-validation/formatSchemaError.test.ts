import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { CRD_FORMATS } from './ajvInstance';
import { collapseCompositeErrors, formatAjvError } from './formatSchemaError';

const ajv = new Ajv({ allErrors: true, strict: false, formats: CRD_FORMATS, logger: false });

function messages(schema: object, data: unknown): string[] {
	const validate = ajv.compile(schema);
	validate(data);
	return collapseCompositeErrors(validate.errors ?? []).map((err) => {
		const path = err.instancePath.replace(/^\//, '').replace(/\//g, '.');
		return formatAjvError(err, data, path ? `spec.${path}` : 'spec');
	});
}

describe('formatAjvError', () => {
	const schema = {
		type: 'object',
		properties: {
			vlan: { type: 'integer', minimum: 1, maximum: 4094 },
			name: { type: 'string', pattern: '^[a-z]+$', maxLength: 5 },
			ip: { type: 'string', format: 'ipv4' },
			when: { type: 'string', format: 'date-time' },
			every: { type: 'string', format: 'duration' },
			port: { type: 'integer', format: 'int32' }
		}
	};

	it('names the field, the value and the limit', () => {
		expect(messages(schema, { vlan: 5000 })).toEqual(['spec.vlan is 5000; it must be <= 4094']);
		expect(messages(schema, { vlan: '10' })).toEqual([
			'spec.vlan must be integer (found string "10")'
		]);
		expect(messages(schema, { name: 'ABC' })).toEqual([
			'spec.name value "ABC" does not match the required pattern ^[a-z]+$'
		]);
		expect(messages(schema, { name: 'abcdefg' })).toEqual([
			'spec.name must be at most 5 characters (found 7)'
		]);
	});

	it('checks the formats EDA CRDs use, with Kubernetes semantics', () => {
		expect(messages(schema, { ip: '10.0.0.256' })).toEqual([
			'spec.ip value "10.0.0.256" is not a valid ipv4'
		]);
		expect(messages(schema, { ip: '10.0.0.1' })).toEqual([]);
		expect(messages(schema, { when: '2026-10-23T10:00:00Z' })).toEqual([]);
		expect(messages(schema, { when: 'yesterday' })).toHaveLength(1);
		// Go durations, not ISO 8601
		expect(messages(schema, { every: '1h30m' })).toEqual([]);
		expect(messages(schema, { every: 'PT30S' })).toHaveLength(1);
		expect(messages(schema, { port: 2 ** 31 })).toEqual([
			`spec.port value ${2 ** 31} is not a valid int32`
		]);
	});

	it('collapses anyOf branch noise into one message', () => {
		const out = messages(
			{
				type: 'object',
				properties: { v: { anyOf: [{ type: 'integer' }, { type: 'string', pattern: '^\\d+%$' }] } }
			},
			{ v: 'abc' }
		);
		expect(out).toEqual(['spec.v does not match any of the allowed forms for this field']);
	});
});

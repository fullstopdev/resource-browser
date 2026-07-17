import { describe, expect, it } from 'vitest';
import { sanitizeSpecForDisplay } from './sanitizeSpecForDisplay';

describe('sanitizeSpecForDisplay', () => {
	it('removes top-level servers and Swagger 2 host fields', () => {
		const spec = {
			openapi: '3.0.1',
			servers: [{ url: 'https://100.124.224.215:9443' }],
			host: '100.124.224.215:9443',
			basePath: '/api',
			schemes: ['https'],
			paths: {}
		};

		const result = sanitizeSpecForDisplay(spec);

		expect(result.servers).toBeUndefined();
		expect(result.host).toBeUndefined();
		expect(result.basePath).toBeUndefined();
		expect(result.schemes).toBeUndefined();
	});

	it('removes path- and operation-level server overrides', () => {
		const spec = {
			paths: {
				'/foo': {
					servers: [{ url: 'https://cluster.example:9443' }],
					get: {
						servers: [{ url: 'https://cluster.example:9443/v2' }],
						responses: { '200': { description: 'ok' } }
					}
				}
			}
		};

		const result = sanitizeSpecForDisplay(spec);
		const pathItem = (result.paths as Record<string, Record<string, unknown>>)['/foo'];

		expect(pathItem.servers).toBeUndefined();
		expect(pathItem.get).toEqual({
			responses: { '200': { description: 'ok' } }
		});
	});

	it('preserves schema properties named servers that are not URL lists', () => {
		const spec = {
			components: {
				schemas: {
					NtpConfig: {
						properties: {
							servers: {
								description: 'NTP servers',
								type: 'array',
								items: { type: 'string' }
							}
						}
					}
				}
			}
		};

		const result = sanitizeSpecForDisplay(spec);

		expect(
			(result.components as { schemas: { NtpConfig: { properties: { servers: unknown } } } })
				.schemas.NtpConfig.properties.servers
		).toEqual({
			description: 'NTP servers',
			type: 'array',
			items: { type: 'string' }
		});
	});

	it('does not mutate the original spec', () => {
		const spec = {
			servers: [{ url: 'https://100.124.224.215:9443' }],
			paths: {}
		};

		sanitizeSpecForDisplay(spec);

		expect(spec.servers).toHaveLength(1);
	});

	it('preserves x-eda-nokia-com vendor extensions', () => {
		const spec = {
			'x-eda-nokia-com': { 'ui-title': 'Spec root' },
			paths: {
				'/auth': {
					get: {
						'x-eda-nokia-com': { 'ui-title': 'List auth' },
						responses: { '200': { description: 'ok' } }
					}
				}
			},
			components: {
				schemas: {
					AuthProvider: {
						properties: {
							enabled: {
								type: 'boolean',
								'x-eda-nokia-com': { 'ui-title': 'Enabled' }
							}
						}
					}
				}
			}
		};

		const result = sanitizeSpecForDisplay(spec);

		expect(result['x-eda-nokia-com']).toEqual({ 'ui-title': 'Spec root' });
		const pathItem = (result.paths as Record<string, Record<string, unknown>>)['/auth'];
		expect((pathItem.get as Record<string, unknown>)['x-eda-nokia-com']).toEqual({
			'ui-title': 'List auth'
		});
		expect(
			(
				(result.components as { schemas: { AuthProvider: { properties: { enabled: unknown } } } })
					.schemas.AuthProvider.properties.enabled as Record<string, unknown>
			)['x-eda-nokia-com']
		).toEqual({ 'ui-title': 'Enabled' });
	});
});

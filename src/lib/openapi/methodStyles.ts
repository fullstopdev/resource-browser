import type { HttpMethod } from './pathBrowser';

export type HttpMethodStyle = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'other';

export function httpMethodStyle(method: string): HttpMethodStyle {
	switch (method.toLowerCase()) {
		case 'get':
			return 'get';
		case 'post':
			return 'post';
		case 'put':
			return 'put';
		case 'patch':
			return 'patch';
		case 'delete':
			return 'delete';
		default:
			return 'other';
	}
}

export function httpMethodLabel(method: HttpMethod | string): string {
	return method.toUpperCase();
}

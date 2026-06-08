import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { getRequiredFields, resolveObjectSchema } from '$lib/schema/requiredFields';
import {
	CHUNK_TARGET_CHARS_MAX,
	CHUNK_TARGET_CHARS_MIN,
	estimateTokens
} from '$lib/ai/tokenBudget';
import type { ChunkType, CrdChunk, CrdChunkMetadata } from './chunkTypes';

type CrdYaml = {
	name?: string;
	schema?: {
		openAPIV3Schema?: {
			description?: string;
			properties?: {
				spec?: Record<string, unknown>;
				status?: Record<string, unknown>;
			};
			required?: string[];
		};
	};
};

type FieldNode = {
	path: string;
	description?: string;
	type?: string;
	enum?: string[];
	required?: string[];
	schema: Record<string, unknown>;
};

function chunkId(meta: CrdChunkMetadata, suffix: string): string {
	return `${meta.release}:${meta.group}:${meta.kind}:${meta.version}:${meta.chunkType}:${suffix}`;
}

function collectFieldNodes(
	schema: unknown,
	pathPrefix: string,
	depth = 0,
	maxDepth = 6
): FieldNode[] {
	const nodes: FieldNode[] = [];
	const resolved = resolveObjectSchema(schema);
	if (!resolved || depth > maxDepth) return nodes;

	for (const [key, propSchema] of Object.entries(resolved.properties)) {
		if (!propSchema || typeof propSchema !== 'object') continue;
		const s = propSchema as Record<string, unknown>;
		const path = pathPrefix ? `${pathPrefix}.${key}` : key;
		const node: FieldNode = {
			path,
			description: typeof s.description === 'string' ? s.description : undefined,
			type: typeof s.type === 'string' ? s.type : undefined,
			enum: Array.isArray(s.enum) ? s.enum.filter((v): v is string => typeof v === 'string') : undefined,
			required: getRequiredFields(s),
			schema: s
		};
		nodes.push(node);

		if (s.type === 'object' || s.properties) {
			nodes.push(...collectFieldNodes(s, path, depth + 1, maxDepth));
		}
		if (s.type === 'array' && s.items) {
			nodes.push(...collectFieldNodes(s.items, `${path}[]`, depth + 1, maxDepth));
		}
	}

	return nodes;
}

function formatFieldNode(node: FieldNode): string {
	const lines = [`Field: ${node.path}`];
	if (node.type) lines.push(`Type: ${node.type}`);
	if (node.description) lines.push(`Description: ${node.description}`);
	if (node.required?.length) lines.push(`Required children: ${node.required.join(', ')}`);
	if (node.enum?.length) lines.push(`Enum: ${node.enum.join(', ')}`);
	return lines.join('\n');
}

function packFieldChunks(
	nodes: FieldNode[],
	meta: Omit<CrdChunkMetadata, 'chunkType' | 'fieldPath'>,
	prefix: string
): CrdChunk[] {
	const chunks: CrdChunk[] = [];
	let buffer = `${prefix}\n`;
	let part = 0;

	const flush = (fieldPath?: string) => {
		const text = buffer.trim();
		if (!text) return;
		const chunkMeta: CrdChunkMetadata = {
			...meta,
			chunkType: 'field-level',
			fieldPath
		};
		chunks.push({
			id: chunkId(chunkMeta, String(part++)),
			text,
			metadata: chunkMeta
		});
		buffer = `${prefix}\n`;
	};

	for (const node of nodes) {
		const block = formatFieldNode(node) + '\n\n';
		if (
			buffer.length + block.length > CHUNK_TARGET_CHARS_MAX &&
			buffer.length >= CHUNK_TARGET_CHARS_MIN
		) {
			flush(node.path);
		}
		buffer += block;
	}

	if (buffer.trim().length > prefix.length) {
		flush(nodes[0]?.path);
	}

	return chunks;
}

function buildValidationChunk(
	spec: unknown,
	status: unknown,
	meta: Omit<CrdChunkMetadata, 'chunkType' | 'fieldPath'>
): CrdChunk | null {
	const lines = [
		`Kind: ${meta.kind}`,
		`Group: ${meta.group}`,
		`Version: ${meta.version}`,
		`Release: ${meta.release}`,
		'',
		'Validation rules (from OpenAPI schema):'
	];

	const specRequired = getRequiredFields(spec);
	const statusRequired = getRequiredFields(status);
	if (specRequired.length) lines.push(`spec required: ${specRequired.join(', ')}`);
	if (statusRequired.length) lines.push(`status required: ${statusRequired.join(', ')}`);

	const specNodes = collectFieldNodes(spec, 'spec');
	const enumLines = specNodes
		.filter((n) => n.enum?.length)
		.map((n) => `${n.path}: ${n.enum!.join(' | ')}`);
	if (enumLines.length) {
		lines.push('', 'spec enums:', ...enumLines.slice(0, 40));
	}

	const text = lines.join('\n');
	if (estimateTokens(text) < 20) return null;

	const chunkMeta: CrdChunkMetadata = { ...meta, chunkType: 'validation-rules' };
	return {
		id: chunkId(chunkMeta, '0'),
		text,
		metadata: chunkMeta
	};
}

/** Split a CRD YAML document into embeddable chunks for Vectorize. */
export function chunkCrdYaml(
	yamlText: string,
	meta: Omit<CrdChunkMetadata, 'chunkType' | 'fieldPath'>
): CrdChunk[] {
	const parsed = loadStaticYaml(yamlText) as CrdYaml;
	const top = parsed?.schema?.openAPIV3Schema;
	const spec = top?.properties?.spec;
	const status = top?.properties?.status;
	const chunks: CrdChunk[] = [];

	const overviewLines = [
		`Kind: ${meta.kind}`,
		`Group: ${meta.group}`,
		`API version: ${meta.version}`,
		`Release: ${meta.release}`,
		`CRD path: ${meta.path}`
	];
	if (top?.description) overviewLines.push('', `Description: ${top.description}`);
	if (top?.required?.length) overviewLines.push(`Top-level required: ${top.required.join(', ')}`);

	const overviewMeta: CrdChunkMetadata = { ...meta, chunkType: 'kind-overview' };
	chunks.push({
		id: chunkId(overviewMeta, '0'),
		text: overviewLines.join('\n'),
		metadata: overviewMeta
	});

	if (spec) {
		const prefix = `Kind: ${meta.kind} (${meta.group}/${meta.version}) — spec fields`;
		chunks.push(...packFieldChunks(collectFieldNodes(spec, 'spec'), meta, prefix));
	}

	if (status) {
		const prefix = `Kind: ${meta.kind} (${meta.group}/${meta.version}) — status fields`;
		chunks.push(...packFieldChunks(collectFieldNodes(status, 'status'), meta, prefix));
	}

	const validationChunk = buildValidationChunk(spec, status, meta);
	if (validationChunk) chunks.push(validationChunk);

	return chunks;
}

export function chunkTypeLabel(type: ChunkType): string {
	switch (type) {
		case 'kind-overview':
			return 'overview';
		case 'field-level':
			return 'field';
		case 'validation-rules':
			return 'validation';
	}
}

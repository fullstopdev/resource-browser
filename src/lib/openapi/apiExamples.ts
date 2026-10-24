/**
 * Request and response examples for the API reference, written for someone about to send the
 * request: a minimal, realistic body (the curated docs.eda.dev example when one exists, otherwise
 * only the required fields) instead of a full schema dump of placeholders.
 */
import curated from '$lib/validate-bundle/curatedExamples.json';
import { loadStaticYaml } from '$lib/yaml/safeYaml';
import { exampleName, type ApiAction, type ApiSection } from './apiReference';
import { resolveRepresentationExamples, synthesizeExampleFromSchema } from './openApiExamples';
import { resolveSchemaNode, type JsonSchemaObject } from './schemaBrowser';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function resolve(spec: Json, schema: JsonSchemaObject | undefined): JsonSchemaObject | undefined {
	return schema ? resolveSchemaNode(spec, schema, new Set()) : undefined;
}

/** `node-profile` for a `nodeProfile` string with no default, instead of "string". */
function sampleFor(key: string, value: unknown): unknown {
	if (value !== 'string') return value;
	// Documentation addresses (RFC 5737) and EDA-style names for common network fields.
	if (key === 'namespace') return 'eda';
	if (key === 'name') return 'my-resource';
	if (/prefix$/i.test(key)) return '192.0.2.0/24';
	if (/(address|^ip|Ip)$/i.test(key)) return '192.0.2.1';
	if (/^nodes?$|node$/i.test(key)) return 'leaf1';
	if (/interface$/i.test(key)) return 'ethernet-1-1';
	return key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** Replace "string" placeholders throughout, using each field's name. */
function realistic(value: unknown, key = ''): unknown {
	if (Array.isArray(value)) return value.map((v) => realistic(v, key));
	if (isObject(value))
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, realistic(v, k)]));
	return sampleFor(key, value);
}

/** Keep required properties only (recursively), with realistic values. */
function pruneToRequired(
	spec: Json,
	value: unknown,
	schema: JsonSchemaObject | undefined,
	depth = 0
): unknown {
	const node = resolve(spec, schema);
	if (Array.isArray(value)) {
		const items = node?.items as JsonSchemaObject | undefined;
		return value.slice(0, 1).map((v) => pruneToRequired(spec, v, items, depth + 1));
	}
	if (!isObject(value) || !node || depth > 6) return value;
	const props = (node.properties ?? {}) as Record<string, JsonSchemaObject>;
	const required = new Set((node.required as string[] | undefined) ?? []);
	const out: Json = {};
	for (const key of Object.keys(value)) {
		if (!required.has(key)) continue;
		out[key] = sampleFor(key, pruneToRequired(spec, value[key], props[key], depth + 1));
	}
	return out;
}

/** The curated docs example for a kind, as an object, or null. */
function curatedManifest(kind: string, group: string | undefined): Json | null {
	const hit = curated.examples.find((e) => e.kind === kind && (!group || e.group === group));
	if (!hit) return null;
	const doc = loadStaticYaml(hit.yaml);
	return isObject(doc) ? doc : null;
}

/** Minimal manifest to create or replace a resource, or to run a workflow. */
export function resourceBodyExample(
	section: ApiSection,
	action: ApiAction,
	spec: Json
): Json | null {
	const content = action.operation.requestBody?.content[0];
	const name = exampleName(section.title);
	const metadata: Json = { name, ...(section.scope === 'Namespaced' ? { namespace: 'eda' } : {}) };
	const apiVersion =
		section.group && section.version ? `${section.group}/${section.version}` : undefined;

	const fromDocs = curatedManifest(section.title, section.group);
	if (fromDocs && isObject(fromDocs.spec)) {
		return {
			apiVersion: apiVersion ?? fromDocs.apiVersion,
			kind: section.title,
			metadata,
			spec: fromDocs.spec
		};
	}
	if (!content?.schema) return null;

	const full = synthesizeExampleFromSchema(spec, content.schema);
	if (!isObject(full)) return null;
	const bodySchema = resolve(spec, content.schema);
	const specSchema = (bodySchema?.properties as Record<string, JsonSchemaObject> | undefined)?.spec;
	let specValue = pruneToRequired(spec, full.spec, specSchema);
	// No required fields: show the first few fields that have a real default or enum value.
	if (isObject(specValue) && Object.keys(specValue).length === 0 && isObject(full.spec)) {
		const picked = Object.entries(full.spec)
			.filter(
				([, v]) =>
					v !== 'string' && v !== 0 && v !== false && !(isObject(v) && Object.keys(v).length === 0)
			)
			.slice(0, 3);
		specValue = Object.fromEntries(picked);
	}
	return {
		apiVersion: apiVersion ?? full.apiVersion,
		kind: section.title,
		metadata,
		...(full.spec !== undefined ? { spec: specValue } : {})
	};
}

export interface CodeExample {
	label: string;
	file?: string;
	text: string;
}

/** Body example for any action with a request body: minimal manifest for resources, schema example otherwise. */
export function requestBodyExample(
	section: ApiSection,
	action: ApiAction,
	spec: Json
): CodeExample | null {
	const body = action.operation.requestBody;
	if (!body) return null;
	const isManifest =
		(section.type === 'resource' && (action.key === 'create' || action.key === 'replace')) ||
		(section.type === 'workflow' && action.key === 'run');
	if (isManifest) {
		const manifest = resourceBodyExample(section, action, spec);
		if (manifest) {
			return {
				label: 'Body',
				file: `${exampleName(section.title)}.json`,
				text: JSON.stringify(manifest, null, 2)
			};
		}
	}
	// A transaction applies resources: show one creating a BridgeDomain, as a dry run.
	if (action.operation.operationId === 'transPostTransaction') {
		const value = curatedManifest('BridgeDomain', 'services.eda.nokia.com');
		if (value) {
			const metadata = { name: 'my-bridge-domain', namespace: 'eda' };
			const transaction = {
				crs: [{ type: { create: { value: { ...value, metadata } } } }],
				description: 'Create the my-bridge-domain BridgeDomain',
				dryRun: true
			};
			return {
				label: 'Body',
				file: 'transaction.json',
				text: JSON.stringify(transaction, null, 2)
			};
		}
	}
	const content = body.content[0];
	if (!content) return null;
	if (content.examples.length > 0) {
		return { label: 'Body', file: 'body.json', text: content.examples[0]!.formatted };
	}
	if (!content.schema || content.hasEmptySchema) return null;
	// Required fields only: a full schema dump of optional placeholders is not a usable request.
	const full = synthesizeExampleFromSchema(spec, content.schema);
	const minimal = pruneToRequired(spec, full, content.schema);
	const value = isObject(minimal) && Object.keys(minimal).length > 0 ? minimal : realistic(full);
	return { label: 'Body', file: 'body.json', text: JSON.stringify(value, null, 2) };
}

/** Example of the first successful response with a body. */
export function responseExample(
	action: ApiAction,
	spec: Json
): (CodeExample & { status: string }) | null {
	for (const response of action.operation.responses) {
		if (!/^2/.test(response.status)) continue;
		const content = response.content.find((c) => /json/.test(c.contentType)) ?? response.content[0];
		if (!content)
			return { status: response.status, label: `Response ${response.status}`, text: '' };
		const examples = resolveRepresentationExamples(spec, content.examples, content.schema, {
			hasEmptySchema: content.hasEmptySchema
		});
		const first = examples[0];
		if (!first) return { status: response.status, label: `Response ${response.status}`, text: '' };
		// Synthesized examples: realistic values instead of "string" placeholders.
		const text = first.synthesized
			? JSON.stringify(realistic(first.value), null, 2)
			: first.formatted;
		return { status: response.status, label: `Response ${response.status}`, text };
	}
	return null;
}

/** Capitalised, with "a" before a vowel-initial word fixed: "create a IRBInterface" → "Create an IRBInterface". */
export function sentence(text: string): string {
	const t = text.trim().replace(/\ba ([AEIOU])/g, 'an $1');
	if (!t) return '';
	const s = t.charAt(0).toUpperCase() + t.slice(1);
	return /[.!?]$/.test(s) ? s : `${s}.`;
}

/** What an action does, in a sentence: written for the common EDA actions, else the spec's text. */
export function actionDescription(action: ApiAction, section: ApiSection): string {
	const kind = section.title;
	const generic: Record<string, string> = {
		list: `Returns every ${kind} in a namespace.`,
		listAll:
			section.scope === 'Cluster'
				? `Returns every ${kind}.`
				: `Returns every ${kind} in all namespaces.`,
		get: `Returns one ${kind} by name.`,
		create: `Creates a ${kind}. Send the resource as JSON: apiVersion, kind, metadata and spec.`,
		replace: `Replaces a ${kind} with the resource in the body.`,
		patch: `Changes part of a ${kind}. Send only the fields to change.`,
		delete: `Deletes a ${kind}.`,
		deleteAll:
			section.scope === 'Cluster'
				? `Deletes every ${kind}.`
				: `Deletes every ${kind} in a namespace.`,
		run: `Starts a ${kind} workflow. Send its input as the workflow's spec.`
	};
	if (section.type !== 'platform' && generic[action.key])
		return sentence(generic[action.key]!).replace(/ a ([AEIOU])/g, ' an $1');
	const op = action.operation;
	return sentence(op.description.split(/\n\s*\n/)[0] || op.summary || action.label);
}

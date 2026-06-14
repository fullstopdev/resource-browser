import type { ThemeMode } from '$lib/theme';
import type { LinkRelation, NodeType } from './types';

export {
	directionDisplayLabel,
	getRelationLabel,
	LEGEND_TITLE,
	MAP_DIRECTION,
	MAP_ROLE_LABELS,
	relationDisplayLabel,
	REL_DESCRIPTIONS,
	REL_LABELS
} from './relationLabels';
export type { RelationDisplayContext, TopologyDirection } from './relationLabels';

export type GraphPalette = {
	background: string;
	gridDot: string;
	panel: string;
	panelBorder: string;
	text: string;
	textMuted: string;
	link: string;
	linkHighlight: string;
	linkDim: string;
	/** Outgoing from focus — depends on */
	linkOut: string;
	/** Incoming to focus — required by */
	linkIn: string;
	nodeStroke: string;
	nodeLabel: string;
	nodeLabelBg: string;
	tooltipBg: string;
	tooltipBorder: string;
	chipActive: string;
	chipInactive: string;
	focusRing: string;
	config: string;
	configLight: string;
	state: string;
	stateLight: string;
	other: string;
	rel: Record<LinkRelation, string>;
};

/** Light surfaces — match spec-search-page tokens in app.css */
const light: GraphPalette = {
	background: '#f8fafc',
	gridDot: 'transparent',
	panel: '#ffffff',
	panelBorder: '#e2e8f0',
	text: '#0f172a',
	textMuted: '#64748b',
	link: '#64748b',
	linkHighlight: '#2563eb',
	linkDim: '#cbd5e1',
	linkOut: '#4f46e5',
	linkIn: '#059669',
	nodeStroke: '#334155',
	nodeLabel: '#0f172a',
	nodeLabelBg: 'rgba(255, 255, 255, 0.96)',
	tooltipBg: '#ffffff',
	tooltipBorder: '#e2e8f0',
	chipActive: '#2563eb',
	chipInactive: '#e2e8f0',
	focusRing: '#2563eb',
	config: '#2563eb',
	configLight: '#3b82f6',
	state: '#16a34a',
	stateLight: '#22c55e',
	other: '#64748b',
	rel: {
		orchestrates: '#d97706',
		observes: '#16a34a',
		deploys: '#059669',
		references: '#1d4ed8',
		member: '#0891b2',
		memberOf: '#0e7490',
		bindsTo: '#7c3aed',
		appliesTo: '#dc2626',
		extends: '#db2777'
	}
};

/** Dark surfaces — match .dark .surface-panel / spec-search tokens in app.css */
const dark: GraphPalette = {
	background: 'rgba(7, 20, 40, 0.45)',
	gridDot: 'transparent',
	panel: 'rgba(15, 42, 72, 0.88)',
	panelBorder: 'rgba(56, 100, 150, 0.35)',
	text: '#f1f5f9',
	textMuted: '#94a3b8',
	link: '#64748b',
	linkHighlight: '#60a5fa',
	linkDim: 'rgba(56, 100, 150, 0.35)',
	linkOut: '#818cf8',
	linkIn: '#34d399',
	nodeStroke: '#cbd5e1',
	nodeLabel: '#f1f5f9',
	nodeLabelBg: 'rgba(15, 42, 72, 0.92)',
	tooltipBg: 'rgba(15, 42, 72, 0.95)',
	tooltipBorder: 'rgba(56, 100, 150, 0.35)',
	chipActive: '#3b82f6',
	chipInactive: 'rgba(51, 65, 85, 0.8)',
	focusRing: '#60a5fa',
	config: '#3b82f6',
	configLight: '#60a5fa',
	state: '#22c55e',
	stateLight: '#4ade80',
	other: '#94a3b8',
	rel: {
		orchestrates: '#fbbf24',
		observes: '#4ade80',
		deploys: '#34d399',
		references: '#60a5fa',
		member: '#22d3ee',
		memberOf: '#06b6d4',
		bindsTo: '#a78bfa',
		appliesTo: '#f87171',
		extends: '#f472b6'
	}
};

export function getGraphPalette(mode: ThemeMode): GraphPalette {
	return mode === 'dark' ? dark : light;
}

export function nodeFill(type: NodeType, palette: GraphPalette): string {
	switch (type) {
		case 'config':
			return palette.config;
		case 'state':
			return palette.state;
		default:
			return palette.other;
	}
}

export function nodeFillLight(type: NodeType, palette: GraphPalette): string {
	switch (type) {
		case 'config':
			return palette.configLight;
		case 'state':
			return palette.stateLight;
		default:
			return palette.other;
	}
}

/** Primary schema/intent relations for Map legend (operational types excluded). */
export const MAP_REL_ORDER: LinkRelation[] = [
	'appliesTo',
	'orchestrates',
	'observes',
	'references',
	'bindsTo',
	'extends'
];

/** @deprecated Use MAP_REL_ORDER for Map / intent topology views. */
export const LEGEND_REL_ORDER: LinkRelation[] = MAP_REL_ORDER;

export const REL_ORDER: LinkRelation[] = [
	'orchestrates',
	'observes',
	'deploys',
	'bindsTo',
	'appliesTo',
	'references',
	'member',
	'memberOf',
	'extends'
];

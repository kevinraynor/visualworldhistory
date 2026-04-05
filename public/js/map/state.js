// Shared map state — single source of truth for cross-module access

// Category color palette - muted but distinct
export const CATEGORY_COLORS = {
    empire:       { fill: '#7B8FB2', stroke: '#5A6F8E' },
    war:          { fill: '#C27C7C', stroke: '#A55A5A' },
    civilization: { fill: '#8BAA7C', stroke: '#6B8A5C' },
    discovery:    { fill: '#C9A85C', stroke: '#A8883C' },
    religion:     { fill: '#A88BC2', stroke: '#8A6BA2' },
    cultural:     { fill: '#7BB8C2', stroke: '#5A98A8' },
    trade:        { fill: '#C2A07B', stroke: '#A2805B' },
    general:      { fill: '#999999', stroke: '#777777' },
};

export const ANIM_DURATION = 400;
export const DEFAULT_ZOOM = 4;

import { scaleDotRadius } from '../utils.js';

export function getCategoryColors(category) {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS.general;
}

// Helper that reads shared state — available to all sub-modules without circular deps
export function getEventDisplayRadius(eventId) {
    const entry = mapState.visibleDots.get(eventId);
    if (entry) return scaleDotRadius(entry.event.dot_radius, mapState.map.getZoom());
    const event = mapState.eventsById.get(eventId);
    if (event) return scaleDotRadius(event.dot_radius, mapState.map.getZoom());
    return 6;
}

// Shared mutable state accessed by all map sub-modules
export const mapState = {
    map: null,
    dotsLayer: null,
    baseTileLayer: null,
    bordersLayer: null,
    labelsLayer: null,
    territoryLayer: null,
    territoryCache: new Map(),

    visibleDots: new Map(),    // eventId -> { marker, event, anim, targetScale, targetRadius }
    eventsById: new Map(),     // eventId -> event object
    allEvents: [],
    childrenMap: new Map(),    // parentId -> Set<childId>

    onEventClick: null,
    hoveredEventId: null,
    currentStyleName: 'light',

    activeGranularities: new Set(['major', 'notable', 'detailed']),
    activeCategories: new Set(['empire', 'war', 'civilization', 'discovery', 'religion', 'cultural', 'trade']),
};

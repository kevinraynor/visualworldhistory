// Map hierarchy — tree building, enter/exit hierarchy mode, overlay

import { formatYear, escapeHtml, scaleDotRadius, shortenLineToEdges } from '../utils.js';
import { mapState, getCategoryColors, getEventDisplayRadius } from './state.js';
import { collapseClusterImmediate, restoreAllDots, dimNonHierarchyDots } from './clusters.js';

// Hierarchy mode state
let hierarchyMode = false;
let hierarchyLines = [];
let hierarchyRelatedIds = null;
let hierarchyOverlayEl = null;
let onExitHierarchyCb = null;

// ===== State Accessors =====

export function isHierarchyMode() {
    return hierarchyMode;
}

export function getHierarchyRelatedIds() {
    return hierarchyRelatedIds;
}

export function onExitHierarchy(cb) {
    onExitHierarchyCb = cb;
}

export function updateHierarchyActive(eventId) {
    if (!hierarchyOverlayEl) return;
    hierarchyOverlayEl.querySelectorAll('.hierarchy-active').forEach(el => el.classList.remove('hierarchy-active'));
    const link = hierarchyOverlayEl.querySelector(`a[data-event-id="${eventId}"]`);
    if (link) link.classList.add('hierarchy-active');
}

// ===== Tree Building =====

export function buildHierarchyTree(eventId) {
    // Walk up to root
    let current = mapState.eventsById.get(eventId);
    if (!current) return null;
    while (current.parent_id) {
        const parent = mapState.eventsById.get(current.parent_id);
        if (!parent) break;
        current = parent;
    }
    const rootId = current.id;

    // Walk down collecting all descendants
    const relatedIds = new Set();
    const edges = [];
    function collectDescendants(id) {
        relatedIds.add(id);
        const kids = mapState.childrenMap.get(id);
        if (!kids) return;
        for (const childId of kids) {
            edges.push({ from: id, to: childId });
            collectDescendants(childId);
        }
    }
    collectDescendants(rootId);
    return { rootId, relatedIds, edges };
}

function buildHierarchyTreeHtml(rootId, activeEventId) {
    const event = mapState.eventsById.get(rootId);
    if (!event) return '';
    const name = escapeHtml(event.name);
    const yearStr = formatYear(event.year_start) + (event.year_end !== event.year_start ? ' – ' + formatYear(event.year_end) : '');
    const isActive = rootId === activeEventId ? ' class="hierarchy-active"' : '';
    const kids = mapState.childrenMap.get(rootId);
    let childrenHtml = '';
    if (kids && kids.size > 0) {
        const sorted = [...kids].map(id => mapState.eventsById.get(id)).filter(Boolean).sort((a, b) => a.year_start - b.year_start);
        childrenHtml = '<ul>' + sorted.map(child => '<li>' + buildHierarchyTreeHtml(child.id, activeEventId) + '</li>').join('') + '</ul>';
    }
    return `<a href="#" data-event-id="${rootId}"${isActive}><span class="hier-name">${name}</span> <span class="hier-year">${yearStr}</span></a>${childrenHtml}`;
}

// ===== Enter/Exit =====

export function enterHierarchyMode(eventId) {
    if (hierarchyMode) exitHierarchyMode();
    collapseClusterImmediate();

    const tree = buildHierarchyTree(eventId);
    if (!tree || tree.relatedIds.size <= 1) return;

    hierarchyMode = true;
    hierarchyRelatedIds = tree.relatedIds;

    const map = mapState.map;
    const zoom = map.getZoom();

    // Force related events to be visible (they may be outside current year range)
    for (const id of tree.relatedIds) {
        if (mapState.visibleDots.has(id)) continue;
        const event = mapState.eventsById.get(id);
        if (!event) continue;
        const radius = scaleDotRadius(event.dot_radius, zoom);
        const colors = getCategoryColors(event.category);
        const marker = L.circleMarker([event.lat, event.lng], {
            fillColor: colors.fill,
            fillOpacity: 0.35,
            color: colors.stroke,
            weight: 2,
            opacity: 0.7,
            radius: radius,
            bubblingMouseEvents: false,
        });
        const yearStr = formatYear(event.year_start) + ' \u2013 ' + formatYear(event.year_end);
        marker.bindTooltip(
            `<div class="event-tooltip"><strong>${escapeHtml(event.name)}</strong><br><span class="tooltip-dates">${yearStr}</span><span class="tooltip-category" style="color:${colors.fill}">${event.category || 'general'}</span></div>`,
            { direction: 'top', offset: [0, -10], className: '' }
        );
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (mapState.onEventClick) mapState.onEventClick(event.id);
        });
        mapState.dotsLayer.addLayer(marker);
        mapState.visibleDots.set(event.id, { marker, event, anim: null, targetScale: 1, targetRadius: radius });
    }

    // Dim non-related dots
    dimNonHierarchyDots(tree.relatedIds);

    // Draw polylines from child to parent (lines stop at circle edges)
    for (const edge of tree.edges) {
        const parent = mapState.eventsById.get(edge.from);
        const child = mapState.eventsById.get(edge.to);
        if (!parent || !child) continue;
        const colors = getCategoryColors(parent.category || 'general');
        const childR = getEventDisplayRadius(child.id);
        const parentR = getEventDisplayRadius(parent.id);
        const [adjFrom, adjTo] = shortenLineToEdges(map,
            [child.lat, child.lng], [parent.lat, parent.lng], childR, parentR
        );
        const line = L.polyline(
            [adjFrom, adjTo],
            { color: colors.fill, weight: 2, opacity: 0.5, dashArray: '6 4', interactive: false }
        ).addTo(map);
        hierarchyLines.push(line);
    }

    // Fit bounds — account for side panel (right) and hierarchy overlay (top-left)
    const latLngs = [];
    for (const id of tree.relatedIds) {
        const e = mapState.eventsById.get(id);
        if (e) latLngs.push([e.lat, e.lng]);
    }
    if (latLngs.length > 1) {
        const bounds = L.latLngBounds(latLngs);
        map.flyToBounds(bounds, {
            paddingTopLeft: [200, 80],
            paddingBottomRight: [640, 60],
            maxZoom: 8,
            duration: 1,
        });
        // After zoom completes, recalculate line endpoints at final zoom level
        map.once('zoomend', () => {
            for (let i = 0; i < hierarchyLines.length; i++) {
                const edge = tree.edges[i];
                if (!edge) continue;
                const parent = mapState.eventsById.get(edge.from);
                const child = mapState.eventsById.get(edge.to);
                if (!parent || !child) continue;
                const childR = getEventDisplayRadius(child.id);
                const parentR = getEventDisplayRadius(parent.id);
                const [adjFrom, adjTo] = shortenLineToEdges(map,
                    [child.lat, child.lng], [parent.lat, parent.lng], childR, parentR
                );
                hierarchyLines[i].setLatLngs([adjFrom, adjTo]);
            }
        });
    }

    // Render hierarchy tree overlay
    hierarchyOverlayEl = document.createElement('div');
    hierarchyOverlayEl.id = 'hierarchy-overlay';
    hierarchyOverlayEl.innerHTML =
        '<div class="hierarchy-header"><span>Event Hierarchy</span><button id="hierarchy-close">&times;</button></div>' +
        '<div class="hierarchy-tree">' + buildHierarchyTreeHtml(tree.rootId, eventId) + '</div>';
    document.getElementById('map').appendChild(hierarchyOverlayEl);

    L.DomEvent.disableScrollPropagation(hierarchyOverlayEl);
    L.DomEvent.disableClickPropagation(hierarchyOverlayEl);

    // Wire up tree clicks and hover highlighting
    // Import highlight functions lazily to avoid circular deps
    hierarchyOverlayEl.querySelectorAll('a[data-event-id]').forEach(link => {
        const targetId = parseInt(link.dataset.eventId, 10);

        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = mapState.eventsById.get(targetId);
            if (target) {
                if (mapState.onEventClick) mapState.onEventClick(targetId);
                hierarchyOverlayEl.querySelectorAll('.hierarchy-active').forEach(el => el.classList.remove('hierarchy-active'));
                link.classList.add('hierarchy-active');
            }
        });

        link.addEventListener('mouseenter', () => {
            const entry = mapState.visibleDots.get(targetId);
            if (!entry) return;
            entry._savedHighlight = {
                radius: entry.marker.getRadius(),
                fillOpacity: entry.marker.options.fillOpacity,
                weight: entry.marker.options.weight,
            };
            entry.marker.setStyle({ fillOpacity: 0.8, weight: 3 });
            entry.marker.setRadius(entry._savedHighlight.radius * 1.4);
        });
        link.addEventListener('mouseleave', () => {
            const entry = mapState.visibleDots.get(targetId);
            if (!entry || !entry._savedHighlight) return;
            entry.marker.setStyle({
                fillOpacity: entry._savedHighlight.fillOpacity,
                weight: entry._savedHighlight.weight,
            });
            entry.marker.setRadius(entry._savedHighlight.radius);
            delete entry._savedHighlight;
        });
    });

    // Close button
    document.getElementById('hierarchy-close').addEventListener('click', () => exitHierarchyMode());
}

export function exitHierarchyMode(source = 'external') {
    if (!hierarchyMode) return;
    hierarchyMode = false;
    hierarchyRelatedIds = null;
    if (onExitHierarchyCb) onExitHierarchyCb(source);

    const map = mapState.map;

    // Remove polylines
    for (const line of hierarchyLines) {
        map.removeLayer(line);
    }
    hierarchyLines = [];

    // Restore dot colors
    restoreAllDots();

    // Remove overlay
    if (hierarchyOverlayEl) {
        hierarchyOverlayEl.remove();
        hierarchyOverlayEl = null;
    }
}

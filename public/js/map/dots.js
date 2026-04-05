// Map dots — dot rendering, animation, visibility, highlighting

import { formatYear, escapeHtml, elasticOut, easeOutQuart, scaleDotRadius, shortenLineToEdges } from '../utils.js';
import { mapState, getCategoryColors, ANIM_DURATION, getEventDisplayRadius } from './state.js';
import { collapseClusterImmediate, collapseCluster, rebuildClusters, expandCluster,
         isInExpandedCluster, getExpandedCenter, eventToClusterGet } from './clusters.js';
import { isHierarchyMode, getHierarchyRelatedIds, exitHierarchyMode } from './hierarchy.js';
import { showTerritoryForEvent, clearTerritory } from './core.js';

// Cross-link hover line state
let linkLine = null;

// Dot highlight state
let highlightedDotId = null;
let highlightedDotOriginal = null;

// Temp dot for cross-link hover (events not currently visible)
let tempDot = null;
let tempDotAnim = null;

// ===== Data Management =====

export function setAllEvents(events) {
    mapState.allEvents = events;
    mapState.eventsById.clear();
    mapState.childrenMap.clear();
    for (const e of events) {
        mapState.eventsById.set(e.id, e);
        if (e.parent_id) {
            if (!mapState.childrenMap.has(e.parent_id)) mapState.childrenMap.set(e.parent_id, new Set());
            mapState.childrenMap.get(e.parent_id).add(e.id);
        }
    }
}

export function getEventById(id) {
    return mapState.eventsById.get(id) || null;
}

// ===== Filters =====

export function setActiveGranularities(granularities) {
    mapState.activeGranularities = new Set(granularities);
}

export function getActiveGranularities() {
    return mapState.activeGranularities;
}

export function setActiveCategories(categories) {
    mapState.activeCategories = new Set(categories);
}

export function getActiveCategories() {
    return mapState.activeCategories;
}

// ===== Visibility =====

export function updateVisibleEvents(currentYear) {
    collapseClusterImmediate();
    const shouldBeVisible = new Set();
    const hierarchyRelatedIds = getHierarchyRelatedIds();
    const inHierarchy = isHierarchyMode();

    for (const event of mapState.allEvents) {
        const isRelated = inHierarchy && hierarchyRelatedIds && hierarchyRelatedIds.has(event.id);
        if (isRelated || (event.year_start <= currentYear && event.year_end >= currentYear)) {
            const gran = event.granularity || 'notable';
            const cat = (event.category || 'general').toLowerCase();
            if (isRelated || (mapState.activeGranularities.has(gran) && mapState.activeCategories.has(cat))) {
                shouldBeVisible.add(event.id);
            }
        }
    }

    // Animate out dots that should no longer be visible
    for (const [id, entry] of mapState.visibleDots) {
        if (!shouldBeVisible.has(id) && entry.targetScale !== 0) {
            animateOut(id, entry);
        }
    }

    // Add dots that should now be visible with animate-in
    const zoom = mapState.map.getZoom();
    for (const event of mapState.allEvents) {
        if (shouldBeVisible.has(event.id) && !mapState.visibleDots.has(event.id)) {
            addDot(event, zoom);
        }
    }

    rebuildClusters();
}

function addDot(event, zoom) {
    const map = mapState.map;
    const radius = scaleDotRadius(event.dot_radius, zoom);
    const colors = getCategoryColors(event.category);

    const marker = L.circleMarker([event.lat, event.lng], {
        fillColor: colors.fill,
        fillOpacity: 0,
        color: colors.stroke,
        weight: 2,
        opacity: 0,
        radius: 0,
        bubblingMouseEvents: false,
    });

    const yearStr = formatYear(event.year_start) + ' \u2013 ' + formatYear(event.year_end);
    marker.bindTooltip(
        `<div class="event-tooltip"><strong>${escapeHtml(event.name)}</strong><br><span class="tooltip-dates">${yearStr}</span><span class="tooltip-category" style="color:${colors.fill}">${event.category || 'general'}</span></div>`,
        { direction: 'top', offset: [0, -10], className: '' }
    );

    // Hover effects + territory + cluster expansion
    marker.on('mouseover', () => {
        handleDotMouseover(event, marker, yearStr, colors);
    });
    marker.on('mouseout', () => {
        handleDotMouseout(event, marker);
    });

    // Click — open panel and collapse any expanded cluster
    marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        const hierarchyRelatedIds = getHierarchyRelatedIds();
        if (isHierarchyMode() && hierarchyRelatedIds && !hierarchyRelatedIds.has(event.id)) {
            exitHierarchyMode();
        }
        collapseCluster();
        if (mapState.onEventClick) mapState.onEventClick(event.id);
    });

    mapState.dotsLayer.addLayer(marker);
    const entry = { marker, event, anim: null, targetScale: 1, targetRadius: radius };
    mapState.visibleDots.set(event.id, entry);
    animateIn(entry);
}

function handleDotMouseover(event, marker, yearStr, colors) {
    const map = mapState.map;

    // If a cluster is expanded and this event is NOT in it, collapse immediately
    if (!isInExpandedCluster(event.id)) {
        collapseClusterImmediate();
    }

    const cid = eventToClusterGet(event.id);
    const inCluster = cid !== undefined;
    const clusterExpanded = inCluster && isInExpandedCluster(event.id);

    // Only show tooltip if not in a cluster, or cluster is already expanded
    if (!inCluster || clusterExpanded) {
        const pt = map.latLngToContainerPoint(marker.getLatLng());
        const center = getExpandedCenter();
        let isAboveCenter = false;
        if (clusterExpanded && center) {
            isAboveCenter = pt.y <= center.y;
        }
        const dir = isAboveCenter ? 'top' : 'bottom';
        const off = isAboveCenter ? [0, -10] : [0, 10];
        marker.unbindTooltip();
        marker.bindTooltip(
            `<div class="event-tooltip"><strong>${escapeHtml(event.name)}</strong><br><span class="tooltip-dates">${yearStr}</span><span class="tooltip-category" style="color:${colors.fill}">${event.category || 'general'}</span></div>`,
            { direction: dir, offset: off, className: '' }
        );
        marker.openTooltip();
    } else {
        marker.unbindTooltip();
    }

    marker.setStyle({ fillOpacity: 0.55, weight: 3 });
    if (mapState.hoveredEventId !== event.id) {
        mapState.hoveredEventId = event.id;
        showTerritoryForEvent(event.id, event.category);
    }

    // Trigger cluster expansion if this dot is part of a cluster (disabled in hierarchy mode)
    if (!isHierarchyMode() && cid !== undefined && !isInExpandedCluster(event.id)) {
        expandCluster(cid);
    }
}

function handleDotMouseout(event, marker) {
    const e = mapState.visibleDots.get(event.id);
    if (e && e.targetScale === 1) {
        marker.setStyle({ fillOpacity: 0.35, weight: 2 });
    }
    if (mapState.hoveredEventId === event.id) {
        mapState.hoveredEventId = null;
        clearTerritory();
    }
}

// ===== Dot Animation =====

function animateIn(entry) {
    if (entry.anim) cancelAnimationFrame(entry.anim);
    entry.targetScale = 1;
    const startTime = performance.now();
    const targetRadius = entry.targetRadius;
    const targetFillOpacity = 0.35;
    const targetStrokeOpacity = 0.7;

    const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / ANIM_DURATION, 1);
        const eased = elasticOut(progress);

        entry.marker.setRadius(targetRadius * eased);
        entry.marker.setStyle({
            fillOpacity: targetFillOpacity * Math.min(eased, 1),
            opacity: targetStrokeOpacity * Math.min(eased, 1),
        });

        if (progress < 1) {
            entry.anim = requestAnimationFrame(animate);
        } else {
            entry.anim = null;
        }
    };
    entry.anim = requestAnimationFrame(animate);
}

function animateOut(id, entry) {
    if (entry.anim) cancelAnimationFrame(entry.anim);
    entry.targetScale = 0;
    const startTime = performance.now();
    const startRadius = entry.marker.getRadius();
    const startFill = 0.35;
    const startStroke = 0.7;
    const duration = ANIM_DURATION * 0.6;

    const animate = (now) => {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutQuart(progress);
        const inv = 1 - eased;

        entry.marker.setRadius(startRadius * inv);
        entry.marker.setStyle({
            fillOpacity: startFill * inv,
            opacity: startStroke * inv,
        });

        if (progress < 1) {
            entry.anim = requestAnimationFrame(animate);
        } else {
            mapState.dotsLayer.removeLayer(entry.marker);
            mapState.visibleDots.delete(id);
        }
    };
    entry.anim = requestAnimationFrame(animate);
}

// ===== Highlight =====

export function highlightDot(eventId) {
    const entry = mapState.visibleDots.get(eventId);
    if (!entry) return;
    highlightedDotId = eventId;
    highlightedDotOriginal = {
        radius: entry.marker.getRadius(),
        fillOpacity: entry.marker.options.fillOpacity,
        weight: entry.marker.options.weight,
    };
    entry.marker.setStyle({ fillOpacity: 0.8, weight: 3 });
    entry.marker.setRadius(highlightedDotOriginal.radius * 1.4);
}

export function unhighlightDot(eventId) {
    if (highlightedDotId !== eventId) return;
    const entry = mapState.visibleDots.get(eventId);
    if (entry && highlightedDotOriginal) {
        entry.marker.setStyle({
            fillOpacity: highlightedDotOriginal.fillOpacity,
            weight: highlightedDotOriginal.weight,
        });
        entry.marker.setRadius(highlightedDotOriginal.radius);
    }
    highlightedDotId = null;
    highlightedDotOriginal = null;
}

// ===== Temp Dot (cross-link hover for off-screen events) =====

export function showTempDot(eventId) {
    hideTempDot();
    const event = mapState.eventsById.get(eventId);
    if (!event) return;
    if (mapState.visibleDots.has(eventId)) return;
    const colors = getCategoryColors(event.category || 'general');
    const targetRadius = scaleDotRadius(event.dot_radius, mapState.map.getZoom());
    tempDot = L.circleMarker([event.lat, event.lng], {
        radius: 0,
        fillColor: colors.fill,
        color: colors.stroke,
        fillOpacity: 0.55,
        opacity: 0.8,
        weight: 2,
        interactive: false,
    }).addTo(mapState.map);
    const startTime = performance.now();
    const duration = 400;
    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = elasticOut(t);
        if (tempDot) tempDot.setRadius(targetRadius * ease);
        if (t < 1) {
            tempDotAnim = requestAnimationFrame(step);
        } else {
            tempDotAnim = null;
        }
    }
    tempDotAnim = requestAnimationFrame(step);
}

export function hideTempDot() {
    if (tempDotAnim) { cancelAnimationFrame(tempDotAnim); tempDotAnim = null; }
    if (tempDot) { mapState.map.removeLayer(tempDot); tempDot = null; }
}

// ===== Cross-Link Hover Line =====

export function drawLinkLine(fromLatLng, toLatLng, category, fromEventId, toEventId) {
    clearLinkLine();
    const map = mapState.map;
    const colors = getCategoryColors(category || 'general');
    const fromR = fromEventId ? getEventDisplayRadius(fromEventId) : 6;
    const toR = toEventId ? getEventDisplayRadius(toEventId) : 6;
    const [adjFrom, adjTo] = shortenLineToEdges(map, fromLatLng, toLatLng, fromR, toR);
    linkLine = L.polyline([adjFrom, adjTo], {
        color: colors.fill,
        weight: 2.5,
        opacity: 0.7,
        dashArray: '8 5',
        interactive: false,
    }).addTo(map);
}

export function clearLinkLine() {
    if (linkLine) {
        mapState.map.removeLayer(linkLine);
        linkLine = null;
    }
}

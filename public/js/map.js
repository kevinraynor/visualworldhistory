// Map module - Leaflet setup, event dots, territory overlays

let map;
let onExitHierarchyCb = null;
let dotsLayer;
let bordersLayer = null;
let territoryLayer = null;
let labelsLayer = null;
let baseTileLayer = null;
let visibleDots = new Map(); // eventId -> { marker, event, anim }
let eventsById = new Map();
let allEvents = [];
let onEventClick = null;
let activeGranularities = new Set(['major', 'notable', 'detailed']);
let activeCategories = new Set(['empire', 'war', 'civilization', 'discovery', 'religion', 'cultural', 'trade']);
let territoryCache = new Map(); // eventId -> geojson or null
let hoveredEventId = null;
let currentStyleName = 'light';
let linkLine = null;
let highlightedDotId = null;
let highlightedDotOriginal = null;

// Hierarchy mode state
let hierarchyMode = false;
let hierarchyLines = [];
let hierarchyRelatedIds = null;
let hierarchyOverlayEl = null;
let childrenMap = new Map(); // parentId -> Set<childId>

// Cluster state
let clusterMap = new Map();       // clusterId -> { centerLatLng, members: Set<eventId> }
let eventToCluster = new Map();   // eventId -> clusterId
let expandedCluster = null;       // clusterId currently expanded (only one at a time)
let expandedCenter = null;        // { lat, lng } pixel center of expanded cluster
let expandedRadius = 0;           // pixel radius of the hover zone
let collapseTimer = null;         // debounce timer for collapse
let clusterAnimFrame = null;      // animation frame for cluster expand/collapse
let clusterLines = new Set();     // all active L.polyline connector lines (expanding + collapsing)
const OVERLAP_THRESHOLD = 0.5;    // fraction of radii sum for overlap detection (lower = stricter)
const MAX_RADIAL_MEMBERS = 12;    // cap for radial display
const CLUSTER_LINES_TO_ACTUAL = true; // true: lines go to each event's actual location, false: all lines go to cluster center

// Minimal union-find for cluster grouping
class UnionFind {
    constructor() { this.parent = new Map(); this.rank = new Map(); }
    make(x) { if (!this.parent.has(x)) { this.parent.set(x, x); this.rank.set(x, 0); } }
    find(x) {
        let r = x;
        while (this.parent.get(r) !== r) r = this.parent.get(r);
        let c = x;
        while (c !== r) { const p = this.parent.get(c); this.parent.set(c, r); c = p; }
        return r;
    }
    union(a, b) {
        a = this.find(a); b = this.find(b);
        if (a === b) return;
        const ra = this.rank.get(a), rb = this.rank.get(b);
        if (ra < rb) { this.parent.set(a, b); }
        else if (ra > rb) { this.parent.set(b, a); }
        else { this.parent.set(b, a); this.rank.set(a, ra + 1); }
    }
    groups() {
        const g = new Map();
        for (const x of this.parent.keys()) {
            const r = this.find(x);
            if (!g.has(r)) g.set(r, new Set());
            g.get(r).add(x);
        }
        return g;
    }
}

// Category color palette - muted but distinct
const CATEGORY_COLORS = {
    empire:       { fill: '#7B8FB2', stroke: '#5A6F8E' },
    war:          { fill: '#C27C7C', stroke: '#A55A5A' },
    civilization: { fill: '#8BAA7C', stroke: '#6B8A5C' },
    discovery:    { fill: '#C9A85C', stroke: '#A8883C' },
    religion:     { fill: '#A88BC2', stroke: '#8A6BA2' },
    cultural:     { fill: '#7BB8C2', stroke: '#5A98A8' },
    trade:        { fill: '#C2A07B', stroke: '#A2805B' },
    general:      { fill: '#999999', stroke: '#777777' },
};

const DEFAULT_ZOOM = 4;
const ANIM_DURATION = 400; // ms

export function initMap(eventClickHandler) {
    onEventClick = eventClickHandler;

    map = L.map('map', {
        preferCanvas: true,
        center: [45, 25],
        zoom: DEFAULT_ZOOM,
        minZoom: 2,
        maxZoom: 10,
        zoomSnap: 0.5,
        wheelPxPerZoomLevel: 120,
        worldCopyJump: true,
        attributionControl: true,
    });

    // Initial tile layers (light style — no labels, controlled by Show Countries toggle)
    baseTileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    labelsLayer = null;

    // Layer for event dots
    dotsLayer = L.layerGroup().addTo(map);

    // Re-scale dots and rebuild clusters on zoom
    map.on('zoomend', () => {
        const zoom = map.getZoom();
        visibleDots.forEach((entry) => {
            if (entry.targetScale === 1) {
                entry.marker.setRadius(scaleDotRadius(entry.event.dot_radius, zoom));
            }
        });
        // Skip cluster logic during hierarchy mode (no clustering needed)
        if (!hierarchyMode) {
            collapseClusterImmediate();
            rebuildClusters();
        }
    });

    // Hover zone detection for expanded clusters
    map.on('mousemove', (e) => {
        if (expandedCluster === null || !expandedCenter) return;
        const pt = e.containerPoint;
        const dist = Math.hypot(pt.x - expandedCenter.x, pt.y - expandedCenter.y);
        if (dist > expandedRadius) {
            // Mouse left the radial zone — start collapse with debounce
            if (!collapseTimer) {
                collapseTimer = setTimeout(() => {
                    collapseTimer = null;
                    collapseCluster();
                }, 150);
            }
        } else {
            // Mouse is back inside — cancel pending collapse
            if (collapseTimer) {
                clearTimeout(collapseTimer);
                collapseTimer = null;
            }
        }
    });

    // Click on empty map space — exit hierarchy mode
    map.on('click', () => {
        if (hierarchyMode) exitHierarchyMode();
    });

    return map;
}

function scaleDotRadius(baseRadius, zoom) {
    const normalized = baseRadius / 200; // 0 to 1
    const displayBase = 5 + Math.pow(normalized, 0.7) * 20;
    // 1x at zoom 2-5, linearly up to ~1.43x at zoom 10 (so max zoom is 2x of original base)
    const scale = zoom <= 5 ? 1 : 1 + (zoom - 5) / 5;
    return Math.max(4, Math.min(displayBase * scale, 50));
}

function getCategoryColors(category) {
    return CATEGORY_COLORS[category] || CATEGORY_COLORS.general;
}

export function setAllEvents(events) {
    allEvents = events;
    eventsById.clear();
    childrenMap.clear();
    for (const e of events) {
        eventsById.set(e.id, e);
        if (e.parent_id) {
            if (!childrenMap.has(e.parent_id)) childrenMap.set(e.parent_id, new Set());
            childrenMap.get(e.parent_id).add(e.id);
        }
    }
}

export function setActiveGranularities(granularities) {
    activeGranularities = new Set(granularities);
}

export function getActiveGranularities() {
    return activeGranularities;
}

export function setActiveCategories(categories) {
    activeCategories = new Set(categories);
}

export function getActiveCategories() {
    return activeCategories;
}

export function updateVisibleEvents(currentYear) {
    collapseClusterImmediate();
    const shouldBeVisible = new Set();

    for (const event of allEvents) {
        // In hierarchy mode, always show related events regardless of year
        const inHierarchy = hierarchyMode && hierarchyRelatedIds && hierarchyRelatedIds.has(event.id);
        if (inHierarchy || (event.year_start <= currentYear && event.year_end >= currentYear)) {
            // Check granularity and category filters (skip for hierarchy-forced events)
            const gran = event.granularity || 'notable';
            const cat = (event.category || 'general').toLowerCase();
            if (inHierarchy || (activeGranularities.has(gran) && activeCategories.has(cat))) {
                shouldBeVisible.add(event.id);
            }
        }
    }

    // Animate out dots that should no longer be visible
    // Skip dots already animating out (targetScale === 0) to prevent restart
    for (const [id, entry] of visibleDots) {
        if (!shouldBeVisible.has(id) && entry.targetScale !== 0) {
            animateOut(id, entry);
        }
    }

    // Add dots that should now be visible with animate-in
    const zoom = map.getZoom();
    for (const event of allEvents) {
        if (shouldBeVisible.has(event.id) && !visibleDots.has(event.id)) {
            const radius = scaleDotRadius(event.dot_radius, zoom);
            const colors = getCategoryColors(event.category);

            const marker = L.circleMarker([event.lat, event.lng], {
                fillColor: colors.fill,
                fillOpacity: 0,
                color: colors.stroke,
                weight: 2,
                opacity: 0,
                radius: 0, // start at 0 for scale animation
            });

            // Tooltip
            const yearStr = formatYear(event.year_start) + ' \u2013 ' + formatYear(event.year_end);
            marker.bindTooltip(
                `<div class="event-tooltip"><strong>${escapeHtml(event.name)}</strong><br><span class="tooltip-dates">${yearStr}</span><span class="tooltip-category" style="color:${colors.fill}">${event.category || 'general'}</span></div>`,
                { direction: 'top', offset: [0, -10], className: '' }
            );

            // Hover effects + territory + cluster expansion
            marker.on('mouseover', () => {
                // If a cluster is expanded and this event is NOT in it, collapse immediately
                if (expandedCluster !== null) {
                    const thisCid = eventToCluster.get(event.id);
                    if (thisCid === undefined || thisCid !== expandedCluster) {
                        collapseClusterImmediate();
                    }
                }

                const cid = eventToCluster.get(event.id);
                const inCluster = cid !== undefined;
                const clusterExpanded = inCluster && expandedCluster === cid;

                // Only show tooltip if not in a cluster, or cluster is already expanded
                if (!inCluster || clusterExpanded) {
                    const pt = map.latLngToContainerPoint(marker.getLatLng());
                    let isAboveCenter = false;
                    if (clusterExpanded && expandedCenter) {
                        isAboveCenter = pt.y <= expandedCenter.y;
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

                marker.setStyle({
                    fillOpacity: 0.55,
                    weight: 3,
                });
                if (hoveredEventId !== event.id) {
                    hoveredEventId = event.id;
                    showTerritoryForEvent(event.id, event.category);
                }
                // Trigger cluster expansion if this dot is part of a cluster (disabled in hierarchy mode)
                if (!hierarchyMode && cid !== undefined && expandedCluster !== cid) {
                    expandCluster(cid);
                }
            });
            marker.on('mouseout', () => {
                const e = visibleDots.get(event.id);
                if (e && e.targetScale === 1) {
                    marker.setStyle({
                        fillOpacity: 0.35,
                        weight: 2,
                    });
                }
                if (hoveredEventId === event.id) {
                    hoveredEventId = null;
                    clearTerritory();
                }
            });

            // Click — open panel and collapse any expanded cluster
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
                if (hierarchyMode && hierarchyRelatedIds && !hierarchyRelatedIds.has(event.id)) {
                    exitHierarchyMode();
                }
                collapseCluster();
                if (onEventClick) onEventClick(event.id);
            });

            dotsLayer.addLayer(marker);
            const entry = { marker, event, anim: null, targetScale: 1, targetRadius: radius };
            visibleDots.set(event.id, entry);
            animateIn(entry);
        }
    }

    // Rebuild cluster detection after dots are updated
    rebuildClusters();
}

// Elastic ease-out for bouncy scale-in
function elasticOut(t) {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
}

// Smooth ease-out for scale-out
function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
}

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
    const duration = ANIM_DURATION * 0.6; // out is faster

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
            dotsLayer.removeLayer(entry.marker);
            visibleDots.delete(id);
        }
    };
    entry.anim = requestAnimationFrame(animate);
}

// --- Cluster detection and radial expansion ---

function rebuildClusters() {
    // Collapse any expanded cluster instantly before rebuilding
    collapseClusterImmediate();

    clusterMap.clear();
    eventToCluster.clear();

    if (visibleDots.size < 2) return;

    const zoom = map.getZoom();
    const entries = [];

    // Convert all visible dots to pixel positions
    for (const [id, entry] of visibleDots) {
        if (entry.targetScale !== 1) continue;
        const pt = map.latLngToContainerPoint([entry.event.lat, entry.event.lng]);
        const r = scaleDotRadius(entry.event.dot_radius, zoom);
        entries.push({ id, x: pt.x, y: pt.y, r });
    }

    if (entries.length < 2) return;

    // Spatial grid for efficient overlap detection
    const maxR = entries.reduce((m, e) => Math.max(m, e.r), 0);
    const cellSize = Math.max(maxR * 2, 20);
    const grid = new Map();

    for (const e of entries) {
        const cx = Math.floor(e.x / cellSize);
        const cy = Math.floor(e.y / cellSize);
        const key = cx + ',' + cy;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(e);
    }

    // Find overlapping pairs
    const uf = new UnionFind();
    for (const e of entries) uf.make(e.id);

    for (const e of entries) {
        const cx = Math.floor(e.x / cellSize);
        const cy = Math.floor(e.y / cellSize);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const neighbors = grid.get((cx + dx) + ',' + (cy + dy));
                if (!neighbors) continue;
                for (const n of neighbors) {
                    if (n.id <= e.id) continue; // avoid duplicate pairs
                    const dist = Math.hypot(e.x - n.x, e.y - n.y);
                    if (dist < (e.r + n.r) * OVERLAP_THRESHOLD) {
                        uf.union(e.id, n.id);
                    }
                }
            }
        }
    }

    // Extract clusters (groups with 2+ members)
    const groups = uf.groups();
    for (const [root, members] of groups) {
        if (members.size < 2) continue;
        const clusterId = Math.min(...members);

        // Compute centroid in lat/lng
        let latSum = 0, lngSum = 0;
        for (const mid of members) {
            const entry = visibleDots.get(mid);
            latSum += entry.event.lat;
            lngSum += entry.event.lng;
        }
        const centerLatLng = L.latLng(latSum / members.size, lngSum / members.size);

        clusterMap.set(clusterId, { centerLatLng, members });
        for (const mid of members) {
            eventToCluster.set(mid, clusterId);
        }
    }
}

let dimAnimFrame = null;
let dimmedDots = new Set(); // track which dots are currently dimmed

function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
}

function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

function lerpColor(hex1, hex2, t) {
    const [r1, g1, b1] = hexToRgb(hex1);
    const [r2, g2, b2] = hexToRgb(hex2);
    return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

function toGreyscaleHex(hex) {
    const [r, g, b] = hexToRgb(hex);
    const grey = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    return rgbToHex(grey, grey, grey);
}

function dimNonClusterDots(clusterMembers) {
    if (dimAnimFrame) cancelAnimationFrame(dimAnimFrame);
    const targets = [];
    for (const [id, entry] of visibleDots) {
        if (!clusterMembers.has(id) && entry.targetScale === 1) {
            const colors = getCategoryColors(entry.event.category);
            targets.push({
                entry,
                fromFill: colors.fill,
                toFill: toGreyscaleHex(colors.fill),
                fromStroke: colors.stroke,
                toStroke: toGreyscaleHex(colors.stroke),
            });
            dimmedDots.add(id);
        }
    }
    const startTime = performance.now();
    const duration = 300;
    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = easeOutCubic(t);
        for (const d of targets) {
            d.entry.marker.setStyle({
                fillColor: lerpColor(d.fromFill, d.toFill, ease),
                color: lerpColor(d.fromStroke, d.toStroke, ease),
                fillOpacity: 0.35 + (0.2 - 0.35) * ease,
                opacity: 0.7 + (0.3 - 0.7) * ease,
            });
        }
        if (t < 1) {
            dimAnimFrame = requestAnimationFrame(step);
        } else {
            dimAnimFrame = null;
        }
    }
    dimAnimFrame = requestAnimationFrame(step);
}

function restoreAllDots(instant) {
    if (dimAnimFrame) cancelAnimationFrame(dimAnimFrame);
    dimAnimFrame = null;
    const targets = [];
    for (const id of dimmedDots) {
        const entry = visibleDots.get(id);
        if (!entry || entry.targetScale !== 1) continue;
        const colors = getCategoryColors(entry.event.category);
        targets.push({
            entry,
            toFill: colors.fill,
            toStroke: colors.stroke,
            fromFill: toGreyscaleHex(colors.fill),
            fromStroke: toGreyscaleHex(colors.stroke),
        });
    }
    dimmedDots.clear();
    if (targets.length === 0) return;
    if (instant) {
        for (const d of targets) {
            d.entry.marker.setStyle({
                fillColor: d.toFill,
                color: d.toStroke,
                fillOpacity: 0.35,
                opacity: 0.7,
            });
        }
        return;
    }
    const startTime = performance.now();
    const duration = 300;
    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = easeOutCubic(t);
        for (const d of targets) {
            d.entry.marker.setStyle({
                fillColor: lerpColor(d.fromFill, d.toFill, ease),
                color: lerpColor(d.fromStroke, d.toStroke, ease),
                fillOpacity: 0.2 + (0.35 - 0.2) * ease,
                opacity: 0.3 + (0.7 - 0.3) * ease,
            });
        }
        if (t < 1) {
            dimAnimFrame = requestAnimationFrame(step);
        } else {
            dimAnimFrame = null;
        }
    }
    dimAnimFrame = requestAnimationFrame(step);
}

function expandCluster(clusterId) {
    if (expandedCluster === clusterId) return;
    if (expandedCluster !== null) collapseClusterImmediate();

    const cluster = clusterMap.get(clusterId);
    if (!cluster) return;

    expandedCluster = clusterId;
    dimNonClusterDots(cluster.members);
    const zoom = map.getZoom();
    const centerPt = map.latLngToContainerPoint(cluster.centerLatLng);
    expandedCenter = { x: centerPt.x, y: centerPt.y };

    // Sort members by dot_radius desc (most important first), cap at MAX_RADIAL_MEMBERS
    let memberIds = [...cluster.members];
    memberIds.sort((a, b) => {
        const ea = visibleDots.get(a), eb = visibleDots.get(b);
        return (eb ? eb.event.dot_radius : 0) - (ea ? ea.event.dot_radius : 0);
    });
    if (memberIds.length > MAX_RADIAL_MEMBERS) {
        memberIds = memberIds.slice(0, MAX_RADIAL_MEMBERS);
    }

    const n = memberIds.length;
    const maxMemberR = memberIds.reduce((m, id) => {
        const e = visibleDots.get(id);
        return e ? Math.max(m, scaleDotRadius(e.event.dot_radius, zoom)) : m;
    }, 0);

    // Expansion radius — fixed pixel spacing, consistent at all zoom levels
    const dotDiam = maxMemberR * 2;
    const minCircumference = n * (dotDiam + 6); // diameter + 6px gap per dot
    const radiusFromSpacing = minCircumference / (2 * Math.PI);
    const expRadius = Math.max(radiusFromSpacing, dotDiam + 8);
    expandedRadius = expRadius + maxMemberR + 10;

    // Compute target positions
    const targets = new Map(); // eventId -> { lat, lng }
    for (let i = 0; i < n; i++) {
        const angle = (-Math.PI / 2) + (2 * Math.PI * i) / n;
        const tx = centerPt.x + expRadius * Math.cos(angle);
        const ty = centerPt.y + expRadius * Math.sin(angle);
        const targetLatLng = map.containerPointToLatLng(L.point(tx, ty));
        targets.set(memberIds[i], { lat: targetLatLng.lat, lng: targetLatLng.lng });
    }

    // Animate expansion
    if (clusterAnimFrame) cancelAnimationFrame(clusterAnimFrame);
    removeClusterLines();
    const startTime = performance.now();
    const duration = ANIM_DURATION;

    // Store original positions
    for (const mid of memberIds) {
        const entry = visibleDots.get(mid);
        if (entry && !entry.originalLatLng) {
            entry.originalLatLng = { lat: entry.event.lat, lng: entry.event.lng };
        }
    }

    // Create connector lines (one per member)
    // Line anchor: each event's actual location (accurate) or cluster center
    const linesByMember = new Map();
    for (const mid of memberIds) {
        const entry = visibleDots.get(mid);
        if (!entry) continue;
        const colors = getCategoryColors(entry.event.category);
        const anchorLat = CLUSTER_LINES_TO_ACTUAL ? entry.event.lat : cluster.centerLatLng.lat;
        const anchorLng = CLUSTER_LINES_TO_ACTUAL ? entry.event.lng : cluster.centerLatLng.lng;
        const line = L.polyline(
            [[anchorLat, anchorLng], [anchorLat, anchorLng]],
            { color: colors.stroke, weight: 1, opacity: 0, dashArray: '4 4', interactive: false }
        ).addTo(map);
        clusterLines.add(line);
        linesByMember.set(mid, { line, anchorLat, anchorLng });
    }

    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = easeOutCubic(t);

        for (const mid of memberIds) {
            const entry = visibleDots.get(mid);
            if (!entry) continue;
            const target = targets.get(mid);
            if (!target) continue;
            const orig = entry.originalLatLng;
            const lat = orig.lat + (target.lat - orig.lat) * ease;
            const lng = orig.lng + (target.lng - orig.lng) * ease;
            entry.marker.setLatLng([lat, lng]);

            // Update connector line (shorten to circle edges)
            const lineData = linesByMember.get(mid);
            if (lineData) {
                const memberR = scaleDotRadius(entry.event.dot_radius, zoom);
                const [adjFrom, adjTo] = shortenLineToEdges(
                    [lineData.anchorLat, lineData.anchorLng], [lat, lng], memberR, memberR
                );
                lineData.line.setLatLngs([adjFrom, adjTo]);
                lineData.line.setStyle({ opacity: 0.4 * ease });
            }
        }

        if (t < 1) {
            clusterAnimFrame = requestAnimationFrame(step);
        } else {
            clusterAnimFrame = null;
            // Bring expanded dots to front (above lines)
            for (const mid of memberIds) {
                const entry = visibleDots.get(mid);
                if (entry) entry.marker.bringToFront();
            }
        }
    }
    clusterAnimFrame = requestAnimationFrame(step);
}

function collapseCluster() {
    if (expandedCluster === null) return;

    restoreAllDots();
    const cluster = clusterMap.get(expandedCluster);
    if (!cluster) { expandedCluster = null; removeClusterLines(); return; }

    const memberIds = [...cluster.members];
    expandedCluster = null;
    expandedCenter = null;
    expandedRadius = 0;
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }

    if (clusterAnimFrame) cancelAnimationFrame(clusterAnimFrame);
    const startTime = performance.now();
    const duration = ANIM_DURATION * 0.6;

    // Capture current positions as start
    const starts = new Map();
    for (const mid of memberIds) {
        const entry = visibleDots.get(mid);
        if (entry) {
            const ll = entry.marker.getLatLng();
            starts.set(mid, { lat: ll.lat, lng: ll.lng });
        }
    }

    // Capture current lines for fade-out (they stay in clusterLines set for cleanup safety)
    const linesToFade = [...clusterLines];

    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = easeOutQuart(t);

        for (const mid of memberIds) {
            const entry = visibleDots.get(mid);
            if (!entry || !entry.originalLatLng) continue;
            const start = starts.get(mid);
            if (!start) continue;
            const orig = entry.originalLatLng;
            const lat = start.lat + (orig.lat - start.lat) * ease;
            const lng = start.lng + (orig.lng - start.lng) * ease;
            entry.marker.setLatLng([lat, lng]);
        }

        // Fade out lines
        for (const line of linesToFade) {
            line.setStyle({ opacity: 0.4 * (1 - ease) });
        }

        if (t < 1) {
            clusterAnimFrame = requestAnimationFrame(step);
        } else {
            clusterAnimFrame = null;
            for (const mid of memberIds) {
                const entry = visibleDots.get(mid);
                if (entry) delete entry.originalLatLng;
            }
            for (const line of linesToFade) {
                map.removeLayer(line);
                clusterLines.delete(line);
            }
        }
    }
    clusterAnimFrame = requestAnimationFrame(step);
}

function collapseClusterImmediate() {
    if (expandedCluster === null) return;

    restoreAllDots(true);
    const cluster = clusterMap.get(expandedCluster);
    if (cluster) {
        for (const mid of cluster.members) {
            const entry = visibleDots.get(mid);
            if (entry && entry.originalLatLng) {
                entry.marker.setLatLng([entry.originalLatLng.lat, entry.originalLatLng.lng]);
                delete entry.originalLatLng;
            }
        }
    }

    removeClusterLines();
    if (clusterAnimFrame) { cancelAnimationFrame(clusterAnimFrame); clusterAnimFrame = null; }
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
    expandedCluster = null;
    expandedCenter = null;
    expandedRadius = 0;
}

function removeClusterLines() {
    for (const line of clusterLines) {
        map.removeLayer(line);
    }
    clusterLines.clear();
}

// Smooth ease-out cubic for cluster expansion
function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

export function toggleBorders(show) {
    if (!map) return; // not initialized yet
    if (show) {
        if (bordersLayer) { map.removeLayer(bordersLayer); bordersLayer = null; }
        const style = TILE_STYLES[currentStyleName] || TILE_STYLES.light;
        bordersLayer = L.tileLayer(style.labels, {
            subdomains: 'abcd',
            maxZoom: 19,
            pane: 'overlayPane',
            opacity: 0.9,
        }).addTo(map);
        // Bring dots above labels
        if (dotsLayer) dotsLayer.eachLayer(l => l.bringToFront());
    } else if (bordersLayer) {
        map.removeLayer(bordersLayer);
        bordersLayer = null;
    }
}

async function showTerritoryForEvent(eventId, category) {
    // Check cache first
    if (territoryCache.has(eventId)) {
        const cached = territoryCache.get(eventId);
        if (cached && hoveredEventId === eventId) {
            showTerritory(cached, category);
        }
        return;
    }

    // Fetch from API
    try {
        const resp = await fetch(`/api/events/${eventId}`);
        const data = await resp.json();
        const geojson = data.territory_geojson || null;
        territoryCache.set(eventId, geojson);
        if (geojson && hoveredEventId === eventId) {
            showTerritory(geojson, category);
        }
    } catch (e) {
        territoryCache.set(eventId, null);
    }
}

export function showTerritory(geojsonStr, category) {
    clearTerritory();
    if (!geojsonStr) return;

    const colors = getCategoryColors(category || 'general');
    try {
        const geojson = typeof geojsonStr === 'string' ? JSON.parse(geojsonStr) : geojsonStr;
        territoryLayer = L.geoJSON(geojson, {
            interactive: false,  // don't intercept mouse events
            style: {
                fillColor: colors.fill,
                fillOpacity: 0.18,
                color: colors.stroke,
                weight: 1.5,
                dashArray: '4 3',
            },
        }).addTo(map);
    } catch (e) {
        console.warn('Invalid territory GeoJSON');
    }
}

export function clearTerritory() {
    if (territoryLayer) {
        map.removeLayer(territoryLayer);
        territoryLayer = null;
    }
}

export function flyToEvent(eventId) {
    const event = eventsById.get(eventId);
    if (event) {
        const targetLatLng = L.latLng(event.lat, event.lng);

        // Manually animate pan (no zoom change) so canvas-rendered dots reposition continuously.
        const startLatLng = map.getCenter();
        const duration = 1000;
        const startTime = performance.now();

        function step(now) {
            const t = Math.min((now - startTime) / duration, 1);
            const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; // easeInOutCubic
            const lat = startLatLng.lat + (targetLatLng.lat - startLatLng.lat) * ease;
            const lng = startLatLng.lng + (targetLatLng.lng - startLatLng.lng) * ease;
            map.setView([lat, lng], map.getZoom(), { animate: false });
            if (t < 1) {
                requestAnimationFrame(step);
            }
        }
        requestAnimationFrame(step);
    }
}

export function getEventById(id) {
    return eventsById.get(id) || null;
}

export { CATEGORY_COLORS };

// ===== Hierarchy Mode =====
export function buildHierarchyTree(eventId) {
    // Walk up to root
    let current = eventsById.get(eventId);
    if (!current) return null;
    while (current.parent_id) {
        const parent = eventsById.get(current.parent_id);
        if (!parent) break;
        current = parent;
    }
    const rootId = current.id;

    // Walk down collecting all descendants
    const relatedIds = new Set();
    const edges = [];
    function collectDescendants(id) {
        relatedIds.add(id);
        const kids = childrenMap.get(id);
        if (!kids) return;
        for (const childId of kids) {
            edges.push({ from: id, to: childId });
            collectDescendants(childId);
        }
    }
    collectDescendants(rootId);
    return { rootId, relatedIds, edges };
}

function dimNonHierarchyDots(relatedIds) {
    for (const [id, entry] of visibleDots) {
        if (relatedIds.has(id)) continue;
        const greyFill = toGreyscaleHex(entry.marker.options.fillColor);
        const greyStroke = toGreyscaleHex(entry.marker.options.color);
        entry.marker.setStyle({
            fillColor: greyFill,
            color: greyStroke,
            fillOpacity: 0.12,
            opacity: 0.2,
        });
        dimmedDots.add(id);
    }
}

function buildHierarchyTreeHtml(rootId, activeEventId) {
    const event = eventsById.get(rootId);
    if (!event) return '';
    const name = escapeHtml(event.name);
    const yearStr = formatYear(event.year_start) + (event.year_end !== event.year_start ? ' – ' + formatYear(event.year_end) : '');
    const isActive = rootId === activeEventId ? ' class="hierarchy-active"' : '';
    const kids = childrenMap.get(rootId);
    let childrenHtml = '';
    if (kids && kids.size > 0) {
        const sorted = [...kids].map(id => eventsById.get(id)).filter(Boolean).sort((a, b) => a.year_start - b.year_start);
        childrenHtml = '<ul>' + sorted.map(child => '<li>' + buildHierarchyTreeHtml(child.id, activeEventId) + '</li>').join('') + '</ul>';
    }
    return `<a href="#" data-event-id="${rootId}"${isActive}><span class="hier-name">${name}</span> <span class="hier-year">${yearStr}</span></a>${childrenHtml}`;
}

export function enterHierarchyMode(eventId) {
    if (hierarchyMode) exitHierarchyMode();
    collapseClusterImmediate();

    const tree = buildHierarchyTree(eventId);
    if (!tree || tree.relatedIds.size <= 1) return; // no hierarchy

    hierarchyMode = true;
    hierarchyRelatedIds = tree.relatedIds;

    // Force related events to be visible (they may be outside current year range)
    // We need a reference to currentYear — read it from the timeline label or recalculate
    // Trigger a re-render so hierarchy-related events appear
    const zoom = map.getZoom();
    for (const id of tree.relatedIds) {
        if (visibleDots.has(id)) continue;
        const event = eventsById.get(id);
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
        });
        const yearStr = formatYear(event.year_start) + ' \u2013 ' + formatYear(event.year_end);
        marker.bindTooltip(
            `<div class="event-tooltip"><strong>${escapeHtml(event.name)}</strong><br><span class="tooltip-dates">${yearStr}</span><span class="tooltip-category" style="color:${colors.fill}">${event.category || 'general'}</span></div>`,
            { direction: 'top', offset: [0, -10], className: '' }
        );
        marker.on('click', () => { if (onEventClick) onEventClick(event.id); });
        dotsLayer.addLayer(marker);
        visibleDots.set(event.id, { marker, event, anim: null, targetScale: 1, targetRadius: radius });
    }

    // Dim non-related dots
    dimNonHierarchyDots(tree.relatedIds);

    // Draw polylines from child to parent (lines stop at circle edges)
    for (const edge of tree.edges) {
        const parent = eventsById.get(edge.from);
        const child = eventsById.get(edge.to);
        if (!parent || !child) continue;
        const colors = getCategoryColors(parent.category || 'general');
        const childR = getEventDisplayRadius(child.id);
        const parentR = getEventDisplayRadius(parent.id);
        const [adjFrom, adjTo] = shortenLineToEdges(
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
        const e = eventsById.get(id);
        if (e) latLngs.push([e.lat, e.lng]);
    }
    if (latLngs.length > 1) {
        const bounds = L.latLngBounds(latLngs);
        // Padding: [top, right, bottom, left] — account for hierarchy overlay (left), side panel (right ~600px)
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
                const parent = eventsById.get(edge.from);
                const child = eventsById.get(edge.to);
                if (!parent || !child) continue;
                const childR = getEventDisplayRadius(child.id);
                const parentR = getEventDisplayRadius(parent.id);
                const [adjFrom, adjTo] = shortenLineToEdges(
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

    // Prevent map scroll when cursor is over hierarchy overlay
    L.DomEvent.disableScrollPropagation(hierarchyOverlayEl);
    L.DomEvent.disableClickPropagation(hierarchyOverlayEl);

    // Wire up tree clicks and hover highlighting
    hierarchyOverlayEl.querySelectorAll('a[data-event-id]').forEach(link => {
        const targetId = parseInt(link.dataset.eventId, 10);

        link.addEventListener('click', (e) => {
            e.preventDefault();
            const target = eventsById.get(targetId);
            if (target) {
                // Stay on current camera — don't flyTo in hierarchy mode
                if (onEventClick) onEventClick(targetId);
                // Update active highlight
                hierarchyOverlayEl.querySelectorAll('.hierarchy-active').forEach(el => el.classList.remove('hierarchy-active'));
                link.classList.add('hierarchy-active');
            }
        });

        link.addEventListener('mouseenter', () => {
            highlightDot(targetId);
        });
        link.addEventListener('mouseleave', () => {
            unhighlightDot(targetId);
        });
    });

    // Close button
    document.getElementById('hierarchy-close').addEventListener('click', () => exitHierarchyMode());
}

export function onExitHierarchy(cb) { onExitHierarchyCb = cb; }

export function exitHierarchyMode() {
    if (!hierarchyMode) return;
    hierarchyMode = false;
    hierarchyRelatedIds = null;
    if (onExitHierarchyCb) onExitHierarchyCb();

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

export function isHierarchyMode() {
    return hierarchyMode;
}

export function getHierarchyRelatedIds() {
    return hierarchyRelatedIds;
}

// ===== Line Edge Helpers =====
function shortenLineToEdges(fromLatLng, toLatLng, fromRadiusPx, toRadiusPx) {
    const fromPt = map.latLngToContainerPoint(L.latLng(fromLatLng[0], fromLatLng[1]));
    const toPt = map.latLngToContainerPoint(L.latLng(toLatLng[0], toLatLng[1]));
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.hypot(dx, dy);
    if (dist < (fromRadiusPx + toRadiusPx)) return [fromLatLng, toLatLng]; // too close, don't shorten
    const ux = dx / dist;
    const uy = dy / dist;
    const newFrom = map.containerPointToLatLng(L.point(fromPt.x + ux * fromRadiusPx, fromPt.y + uy * fromRadiusPx));
    const newTo = map.containerPointToLatLng(L.point(toPt.x - ux * toRadiusPx, toPt.y - uy * toRadiusPx));
    return [[newFrom.lat, newFrom.lng], [newTo.lat, newTo.lng]];
}

function getEventDisplayRadius(eventId) {
    const entry = visibleDots.get(eventId);
    if (entry) return scaleDotRadius(entry.event.dot_radius, map.getZoom());
    const event = eventsById.get(eventId);
    if (event) return scaleDotRadius(event.dot_radius, map.getZoom());
    return 6;
}

// ===== Cross-Link Hover Line =====
export function drawLinkLine(fromLatLng, toLatLng, category, fromEventId, toEventId) {
    clearLinkLine();
    const colors = getCategoryColors(category || 'general');
    const fromR = fromEventId ? getEventDisplayRadius(fromEventId) : 6;
    const toR = toEventId ? getEventDisplayRadius(toEventId) : 6;
    const [adjFrom, adjTo] = shortenLineToEdges(fromLatLng, toLatLng, fromR, toR);
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
        map.removeLayer(linkLine);
        linkLine = null;
    }
}

// ===== Temporary Dot for Cross-Link Hover =====
let tempDot = null;
let tempDotAnim = null;

export function showTempDot(eventId) {
    hideTempDot();
    const event = eventsById.get(eventId);
    if (!event) return;
    // If the dot is already visible, skip (highlightDot handles it)
    if (visibleDots.has(eventId)) return;
    const colors = getCategoryColors(event.category || 'general');
    const targetRadius = scaleDotRadius(event.dot_radius, map.getZoom());
    tempDot = L.circleMarker([event.lat, event.lng], {
        radius: 0,
        fillColor: colors.fill,
        color: colors.stroke,
        fillOpacity: 0.55,
        opacity: 0.8,
        weight: 2,
        interactive: false,
    }).addTo(map);
    // Animate in with elastic bounce
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
    if (tempDot) { map.removeLayer(tempDot); tempDot = null; }
}

export function highlightDot(eventId) {
    const entry = visibleDots.get(eventId);
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
    const entry = visibleDots.get(eventId);
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

function formatYear(year) {
    if (year < 0) return Math.abs(year) + ' BC';
    if (year === 0) return '1 BC';
    return year + ' AD';
}

// ===== Map Style Switcher =====
const TILE_STYLES = {
    light: {
        base: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
    terrain: {
        base: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
};

export function setMapStyle(styleName) {
    const style = TILE_STYLES[styleName];
    if (!style) return;
    currentStyleName = styleName;

    if (baseTileLayer) map.removeLayer(baseTileLayer);

    baseTileLayer = L.tileLayer(style.base, {
        attribution: style.attribution,
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    // Re-apply country labels if toggle is on
    const countriesOn = document.getElementById('borders-toggle')?.checked;
    if (bordersLayer) { map.removeLayer(bordersLayer); bordersLayer = null; }
    if (countriesOn) toggleBorders(true);

    // Re-add dots layer on top
    if (dotsLayer) dotsLayer.eachLayer(l => l.bringToFront());

}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

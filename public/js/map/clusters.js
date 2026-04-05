// Map clusters — detection, radial expansion, collapse, dimming

import { lerpColor, toGreyscaleHex, easeOutCubic, easeOutQuart, scaleDotRadius, shortenLineToEdges } from '../utils.js';
import { mapState, getCategoryColors, ANIM_DURATION } from './state.js';

// Cluster state
let clusterMap = new Map();
let eventToCluster = new Map();
let _expandedCluster = null;
let _expandedCenter = null;
let _expandedRadius = 0;
let collapseTimer = null;
let clusterAnimFrame = null;
let clusterLines = new Set();

const OVERLAP_THRESHOLD = 0.5;
const MAX_RADIAL_MEMBERS = 12;
const CLUSTER_LINES_TO_ACTUAL = true;

// Dim animation state
let dimAnimFrame = null;
let dimmedDots = new Set();

// ===== State Accessors (for other modules) =====

export function expandedCluster() { return _expandedCluster; }
export function expandedCenter() { return _expandedCenter; }
export function expandedRadius() { return _expandedRadius; }

export function isInExpandedCluster(eventId) {
    if (_expandedCluster === null) return false;
    const cid = eventToCluster.get(eventId);
    return cid !== undefined && cid === _expandedCluster;
}

export function getExpandedCenter() { return _expandedCenter; }
export function eventToClusterGet(eventId) { return eventToCluster.get(eventId); }

export function startCollapseTimer() {
    if (!collapseTimer) {
        collapseTimer = setTimeout(() => {
            collapseTimer = null;
            collapseCluster();
        }, 150);
    }
}

export function cancelCollapseTimer() {
    if (collapseTimer) {
        clearTimeout(collapseTimer);
        collapseTimer = null;
    }
}

// ===== Union-Find =====

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

// ===== Cluster Detection =====

export function rebuildClusters() {
    collapseClusterImmediate();

    clusterMap.clear();
    eventToCluster.clear();

    if (mapState.visibleDots.size < 2) return;

    const map = mapState.map;
    const zoom = map.getZoom();
    const entries = [];

    for (const [id, entry] of mapState.visibleDots) {
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
                    if (n.id <= e.id) continue;
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

        let latSum = 0, lngSum = 0;
        for (const mid of members) {
            const entry = mapState.visibleDots.get(mid);
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

// ===== Cluster Expansion =====

export function expandCluster(clusterId) {
    if (_expandedCluster === clusterId) return;
    if (_expandedCluster !== null) collapseClusterImmediate();

    const cluster = clusterMap.get(clusterId);
    if (!cluster) return;

    _expandedCluster = clusterId;
    dimNonClusterDots(cluster.members);
    const map = mapState.map;
    const zoom = map.getZoom();
    const centerPt = map.latLngToContainerPoint(cluster.centerLatLng);
    _expandedCenter = { x: centerPt.x, y: centerPt.y };

    // Sort members by dot_radius desc, cap at MAX_RADIAL_MEMBERS
    let memberIds = [...cluster.members];
    memberIds.sort((a, b) => {
        const ea = mapState.visibleDots.get(a), eb = mapState.visibleDots.get(b);
        return (eb ? eb.event.dot_radius : 0) - (ea ? ea.event.dot_radius : 0);
    });
    if (memberIds.length > MAX_RADIAL_MEMBERS) {
        memberIds = memberIds.slice(0, MAX_RADIAL_MEMBERS);
    }

    const n = memberIds.length;
    const maxMemberR = memberIds.reduce((m, id) => {
        const e = mapState.visibleDots.get(id);
        return e ? Math.max(m, scaleDotRadius(e.event.dot_radius, zoom)) : m;
    }, 0);

    const dotDiam = maxMemberR * 2;
    const minCircumference = n * (dotDiam + 6);
    const radiusFromSpacing = minCircumference / (2 * Math.PI);
    const expRadius = Math.max(radiusFromSpacing, dotDiam + 8);
    _expandedRadius = expRadius + maxMemberR + 10;

    // Compute target positions
    const targets = new Map();
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
        const entry = mapState.visibleDots.get(mid);
        if (entry && !entry.originalLatLng) {
            entry.originalLatLng = { lat: entry.event.lat, lng: entry.event.lng };
        }
    }

    // Create connector lines
    const linesByMember = new Map();
    for (const mid of memberIds) {
        const entry = mapState.visibleDots.get(mid);
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
            const entry = mapState.visibleDots.get(mid);
            if (!entry) continue;
            const target = targets.get(mid);
            if (!target) continue;
            const orig = entry.originalLatLng;
            const lat = orig.lat + (target.lat - orig.lat) * ease;
            const lng = orig.lng + (target.lng - orig.lng) * ease;
            entry.marker.setLatLng([lat, lng]);

            const lineData = linesByMember.get(mid);
            if (lineData) {
                const memberR = scaleDotRadius(entry.event.dot_radius, zoom);
                const [adjFrom, adjTo] = shortenLineToEdges(map,
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
            for (const mid of memberIds) {
                const entry = mapState.visibleDots.get(mid);
                if (entry) entry.marker.bringToFront();
            }
        }
    }
    clusterAnimFrame = requestAnimationFrame(step);
}

// ===== Cluster Collapse =====

export function collapseCluster() {
    if (_expandedCluster === null) return;

    restoreAllDots();
    const cluster = clusterMap.get(_expandedCluster);
    if (!cluster) { _expandedCluster = null; removeClusterLines(); return; }

    const memberIds = [...cluster.members];
    _expandedCluster = null;
    _expandedCenter = null;
    _expandedRadius = 0;
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }

    if (clusterAnimFrame) cancelAnimationFrame(clusterAnimFrame);
    const startTime = performance.now();
    const duration = ANIM_DURATION * 0.6;
    const map = mapState.map;

    const starts = new Map();
    for (const mid of memberIds) {
        const entry = mapState.visibleDots.get(mid);
        if (entry) {
            const ll = entry.marker.getLatLng();
            starts.set(mid, { lat: ll.lat, lng: ll.lng });
        }
    }

    const linesToFade = [...clusterLines];

    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = easeOutQuart(t);

        for (const mid of memberIds) {
            const entry = mapState.visibleDots.get(mid);
            if (!entry || !entry.originalLatLng) continue;
            const start = starts.get(mid);
            if (!start) continue;
            const orig = entry.originalLatLng;
            const lat = start.lat + (orig.lat - start.lat) * ease;
            const lng = start.lng + (orig.lng - start.lng) * ease;
            entry.marker.setLatLng([lat, lng]);
        }

        for (const line of linesToFade) {
            line.setStyle({ opacity: 0.4 * (1 - ease) });
        }

        if (t < 1) {
            clusterAnimFrame = requestAnimationFrame(step);
        } else {
            clusterAnimFrame = null;
            for (const mid of memberIds) {
                const entry = mapState.visibleDots.get(mid);
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

export function collapseClusterImmediate() {
    if (_expandedCluster === null) return;

    restoreAllDots(true);
    const cluster = clusterMap.get(_expandedCluster);
    if (cluster) {
        for (const mid of cluster.members) {
            const entry = mapState.visibleDots.get(mid);
            if (entry && entry.originalLatLng) {
                entry.marker.setLatLng([entry.originalLatLng.lat, entry.originalLatLng.lng]);
                delete entry.originalLatLng;
            }
        }
    }

    removeClusterLines();
    if (clusterAnimFrame) { cancelAnimationFrame(clusterAnimFrame); clusterAnimFrame = null; }
    if (collapseTimer) { clearTimeout(collapseTimer); collapseTimer = null; }
    _expandedCluster = null;
    _expandedCenter = null;
    _expandedRadius = 0;
}

function removeClusterLines() {
    const map = mapState.map;
    for (const line of clusterLines) {
        map.removeLayer(line);
    }
    clusterLines.clear();
}

// ===== Dot Dimming/Restoring =====

function dimNonClusterDots(clusterMembers) {
    if (dimAnimFrame) cancelAnimationFrame(dimAnimFrame);
    const targets = [];
    for (const [id, entry] of mapState.visibleDots) {
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

export function restoreAllDots(instant) {
    if (dimAnimFrame) cancelAnimationFrame(dimAnimFrame);
    dimAnimFrame = null;
    const targets = [];
    for (const id of dimmedDots) {
        const entry = mapState.visibleDots.get(id);
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

// Dim for hierarchy mode (instant, no animation)
export function dimNonHierarchyDots(relatedIds) {
    for (const [id, entry] of mapState.visibleDots) {
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

// Map core — initialization, tiles, styles, borders, territory, navigation

import { easeInOutCubic } from '../utils.js';
import { mapState, getCategoryColors, DEFAULT_ZOOM } from './state.js';
import { collapseClusterImmediate, rebuildClusters, expandedCluster, expandedCenter, expandedRadius, cancelCollapseTimer, startCollapseTimer } from './clusters.js';
import { exitHierarchyMode, isHierarchyMode } from './hierarchy.js';
import { scaleDotRadius } from '../utils.js';

const TILE_STYLES = {
    default: {
        base: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
    light: {
        base: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png',
        labels: 'https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
};

export function initMap(eventClickHandler) {
    mapState.onEventClick = eventClickHandler;

    const map = L.map('map', {
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
    mapState.map = map;

    // Initial tile layers (default/voyager style — no labels, controlled by Show Countries toggle)
    mapState.baseTileLayer = L.tileLayer(TILE_STYLES.default.base, {
        attribution: TILE_STYLES.default.attribution,
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    mapState.labelsLayer = null;
    mapState.dotsLayer = L.layerGroup().addTo(map);

    // Re-scale dots and rebuild clusters on zoom
    map.on('zoomend', () => {
        const zoom = map.getZoom();
        mapState.visibleDots.forEach((entry) => {
            if (entry.targetScale === 1) {
                entry.marker.setRadius(scaleDotRadius(entry.event.dot_radius, zoom));
            }
        });
        if (!isHierarchyMode()) {
            collapseClusterImmediate();
            rebuildClusters();
        }
    });

    // Hover zone detection for expanded clusters
    map.on('mousemove', (e) => {
        const ec = expandedCluster();
        if (ec === null || !expandedCenter()) return;
        const pt = e.containerPoint;
        const center = expandedCenter();
        const dist = Math.hypot(pt.x - center.x, pt.y - center.y);
        if (dist > expandedRadius()) {
            startCollapseTimer();
        } else {
            cancelCollapseTimer();
        }
    });

    // Click on empty map space — exit hierarchy mode
    map.on('click', () => {
        if (isHierarchyMode()) exitHierarchyMode();
    });

    return map;
}

export function toggleBorders(show) {
    const map = mapState.map;
    if (!map) return;
    if (show) {
        if (mapState.bordersLayer) { map.removeLayer(mapState.bordersLayer); mapState.bordersLayer = null; }
        const style = TILE_STYLES[mapState.currentStyleName] || TILE_STYLES.light;
        mapState.bordersLayer = L.tileLayer(style.labels, {
            subdomains: 'abcd',
            maxZoom: 19,
            pane: 'overlayPane',
            opacity: 0.9,
        }).addTo(map);
        if (mapState.dotsLayer) mapState.dotsLayer.eachLayer(l => l.bringToFront());
    } else if (mapState.bordersLayer) {
        map.removeLayer(mapState.bordersLayer);
        mapState.bordersLayer = null;
    }
}

export function setMapStyle(styleName) {
    const style = TILE_STYLES[styleName];
    if (!style) return;
    const map = mapState.map;
    mapState.currentStyleName = styleName;

    if (mapState.baseTileLayer) map.removeLayer(mapState.baseTileLayer);

    mapState.baseTileLayer = L.tileLayer(style.base, {
        attribution: style.attribution,
        subdomains: 'abcd',
        maxZoom: 19,
    }).addTo(map);

    // Re-apply country labels if toggle is on
    const countriesOn = document.getElementById('borders-toggle')?.checked;
    if (mapState.bordersLayer) { map.removeLayer(mapState.bordersLayer); mapState.bordersLayer = null; }
    if (countriesOn) toggleBorders(true);

    if (mapState.dotsLayer) mapState.dotsLayer.eachLayer(l => l.bringToFront());
}

// ===== Territory =====

async function showTerritoryForEvent(eventId, category) {
    if (mapState.territoryCache.has(eventId)) {
        const cached = mapState.territoryCache.get(eventId);
        if (cached && mapState.hoveredEventId === eventId) {
            showTerritory(cached, category);
        }
        return;
    }

    try {
        const resp = await fetch(`/api/events/${eventId}`);
        const data = await resp.json();
        const geojson = data.territory_geojson || null;
        mapState.territoryCache.set(eventId, geojson);
        if (geojson && mapState.hoveredEventId === eventId) {
            showTerritory(geojson, category);
        }
    } catch (e) {
        mapState.territoryCache.set(eventId, null);
    }
}

export function showTerritory(geojsonStr, category) {
    clearTerritory();
    if (!geojsonStr) return;
    const map = mapState.map;
    const colors = getCategoryColors(category || 'general');
    try {
        const geojson = typeof geojsonStr === 'string' ? JSON.parse(geojsonStr) : geojsonStr;
        mapState.territoryLayer = L.geoJSON(geojson, {
            interactive: false,
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
    if (mapState.territoryLayer) {
        mapState.map.removeLayer(mapState.territoryLayer);
        mapState.territoryLayer = null;
    }
}

// Expose for dots.js (hover handler)
export { showTerritoryForEvent };

// ===== Navigation =====

export function flyToEvent(eventId) {
    const event = mapState.eventsById.get(eventId);
    if (!event) return;
    const map = mapState.map;
    const targetLatLng = L.latLng(event.lat, event.lng);
    const startLatLng = map.getCenter();
    const duration = 1000;
    const startTime = performance.now();

    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = easeInOutCubic(t);
        const lat = startLatLng.lat + (targetLatLng.lat - startLatLng.lat) * ease;
        const lng = startLatLng.lng + (targetLatLng.lng - startLatLng.lng) * ease;
        map.setView([lat, lng], map.getZoom(), { animate: false });
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// Shared utilities — formatting, color, easing, geometry

// ===== Formatting =====

export function formatYear(year) {
    if (year < 0) return Math.abs(year) + ' BC';
    if (year === 0) return '1 BC';
    return year + ' AD';
}

export function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== Color Utilities =====

export function hexToRgb(hex) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return [r, g, b];
}

export function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
}

export function lerpColor(hex1, hex2, t) {
    const [r1, g1, b1] = hexToRgb(hex1);
    const [r2, g2, b2] = hexToRgb(hex2);
    return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

export function toGreyscaleHex(hex) {
    const [r, g, b] = hexToRgb(hex);
    const grey = Math.round(r * 0.299 + g * 0.587 + b * 0.114);
    return rgbToHex(grey, grey, grey);
}

// ===== Easing Functions =====

export function elasticOut(t) {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.075) * (2 * Math.PI) / 0.3) + 1;
}

export function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
}

export function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
}

export function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ===== Geometry =====

export function scaleDotRadius(baseRadius, zoom) {
    const normalized = baseRadius / 200; // 0 to 1
    const displayBase = 5 + Math.pow(normalized, 0.7) * 20;
    const scale = zoom <= 5 ? 1 : 1 + (zoom - 5) / 5;
    return Math.max(4, Math.min(displayBase * scale, 50));
}

export function shortenLineToEdges(map, fromLatLng, toLatLng, fromRadiusPx, toRadiusPx) {
    const fromPt = map.latLngToContainerPoint(L.latLng(fromLatLng[0], fromLatLng[1]));
    const toPt = map.latLngToContainerPoint(L.latLng(toLatLng[0], toLatLng[1]));
    const dx = toPt.x - fromPt.x;
    const dy = toPt.y - fromPt.y;
    const dist = Math.hypot(dx, dy);
    if (dist < (fromRadiusPx + toRadiusPx)) return [fromLatLng, toLatLng];
    const ux = dx / dist;
    const uy = dy / dist;
    const newFrom = map.containerPointToLatLng(L.point(fromPt.x + ux * fromRadiusPx, fromPt.y + uy * fromRadiusPx));
    const newTo = map.containerPointToLatLng(L.point(toPt.x - ux * toRadiusPx, toPt.y - uy * toRadiusPx));
    return [[newFrom.lat, newFrom.lng], [newTo.lat, newTo.lng]];
}

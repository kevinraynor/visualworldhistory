// Timeline module - Custom Canvas timeline widget with piecewise linear scale

let canvas, ctx;
let currentYear = 1;
let isDragging = false;
let onYearChange = null;
let animFrameId = null;
let allEvents = [];

// Piecewise linear segments (more space for event-dense periods)
const SEGMENTS = [
    { yearStart: -10000, yearEnd: -3000, widthFrac: 0.15 },
    { yearStart: -3000,  yearEnd: -500,  widthFrac: 0.20 },
    { yearStart: -500,   yearEnd: 500,   widthFrac: 0.25 },
    { yearStart: 500,    yearEnd: 1500,  widthFrac: 0.20 },
    { yearStart: 1500,   yearEnd: 2000,  widthFrac: 0.20 },
];

const PADDING_LEFT = 20;
const PADDING_RIGHT = 20;

const COLORS = {
    trackBg: '#e4e4e4',
    trackFill: '#c8c8c8',
    handle: '#4a6fa5',
    handleGlow: 'rgba(74, 111, 165, 0.25)',
    handleBorder: '#3a5f95',
    text: '#888',
    textBold: '#555',
    tick: '#ddd',
    tickMajor: '#bbb',
    segmentDivider: '#d4d4d4',
    eventDensity: 'rgba(74, 111, 165, 0.25)',
};

export function initTimeline(yearChangeHandler) {
    onYearChange = yearChangeHandler;
    canvas = document.getElementById('timeline-canvas');
    ctx = canvas.getContext('2d');

    resizeCanvas();
    window.addEventListener('resize', () => {
        resizeCanvas();
        draw();
    });

    // Mouse events
    canvas.addEventListener('mousedown', onPointerDown);
    canvas.addEventListener('mousemove', onPointerMove);
    window.addEventListener('mouseup', onPointerUp);

    // Touch events
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onPointerUp);

    draw();
}

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
}

export function setCurrentYear(year) {
    currentYear = Math.max(-10000, Math.min(2000, Math.round(year)));
    draw();
    updateYearLabel();
}

export function getCurrentYear() {
    return currentYear;
}

export function setEvents(events) {
    allEvents = events;
    draw();
}

function getTrackWidth() {
    return (canvas.width / window.devicePixelRatio) - PADDING_LEFT - PADDING_RIGHT;
}

function yearToX(year) {
    const trackWidth = getTrackWidth();
    let x = PADDING_LEFT;
    for (const seg of SEGMENTS) {
        const segWidth = trackWidth * seg.widthFrac;
        if (year <= seg.yearEnd) {
            const frac = (year - seg.yearStart) / (seg.yearEnd - seg.yearStart);
            return x + segWidth * Math.max(0, Math.min(1, frac));
        }
        x += segWidth;
    }
    return x;
}

function xToYear(x) {
    const trackWidth = getTrackWidth();
    let cumX = PADDING_LEFT;
    for (const seg of SEGMENTS) {
        const segWidth = trackWidth * seg.widthFrac;
        if (x <= cumX + segWidth) {
            const frac = (x - cumX) / segWidth;
            return Math.round(seg.yearStart + frac * (seg.yearEnd - seg.yearStart));
        }
        cumX += segWidth;
    }
    return 2000;
}

function draw() {
    const w = canvas.width / window.devicePixelRatio;
    const h = canvas.height / window.devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    const trackY = h * 0.4;
    const trackHeight = 6;
    const trackWidth = getTrackWidth();

    // Background track
    ctx.fillStyle = COLORS.trackBg;
    ctx.beginPath();
    ctx.roundRect(PADDING_LEFT, trackY, trackWidth, trackHeight, 3);
    ctx.fill();

    // Filled portion (up to current year)
    const fillX = yearToX(currentYear);
    ctx.fillStyle = COLORS.trackFill;
    ctx.beginPath();
    ctx.roundRect(PADDING_LEFT, trackY, fillX - PADDING_LEFT, trackHeight, 3);
    ctx.fill();

    // Event density dots along the track
    drawEventDensity(trackY + trackHeight + 8, h - trackY - trackHeight - 12);

    // Era labels and ticks
    drawTicks(trackY, trackHeight);

    // Segment dividers
    let segX = PADDING_LEFT;
    for (let i = 0; i < SEGMENTS.length - 1; i++) {
        segX += trackWidth * SEGMENTS[i].widthFrac;
        ctx.strokeStyle = COLORS.segmentDivider;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(segX, trackY - 2);
        ctx.lineTo(segX, trackY + trackHeight + 2);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Handle glow
    const handleX = fillX;
    const handleCenterY = trackY + trackHeight / 2;
    const handleRadius = 9;

    ctx.fillStyle = COLORS.handleGlow;
    ctx.beginPath();
    ctx.arc(handleX, handleCenterY, handleRadius + 5, 0, Math.PI * 2);
    ctx.fill();

    // Handle
    ctx.fillStyle = COLORS.handle;
    ctx.strokeStyle = COLORS.handleBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(handleX, handleCenterY, handleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Handle inner dot
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(handleX, handleCenterY, 3, 0, Math.PI * 2);
    ctx.fill();

    // Cross-link highlight marker
    if (highlightYear !== null) {
        const hx = yearToX(highlightYear);
        const hy = trackY + trackHeight / 2;
        const size = 6;
        ctx.fillStyle = '#e06040';
        ctx.strokeStyle = '#c04020';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(hx, hy - size);
        ctx.lineTo(hx + size, hy);
        ctx.lineTo(hx, hy + size);
        ctx.lineTo(hx - size, hy);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
    }
}

function drawTicks(trackY, trackHeight) {
    const majorTicks = [-10000, -5000, -3000, -2000, -1000, -500, 0, 500, 1000, 1500, 1800, 2000];
    const labels = {
        '-10000': '10000 BC',
        '-5000': '5000 BC',
        '-3000': '3000 BC',
        '-2000': '2000 BC',
        '-1000': '1000 BC',
        '-500': '500 BC',
        '0': '1 AD',
        '500': '500',
        '1000': '1000',
        '1500': '1500',
        '1800': '1800',
        '2000': '2000',
    };

    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    for (const year of majorTicks) {
        const x = yearToX(year);

        // Tick mark
        ctx.strokeStyle = COLORS.tickMajor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, trackY - 4);
        ctx.lineTo(x, trackY + trackHeight + 4);
        ctx.stroke();

        // Label
        ctx.fillStyle = COLORS.text;
        ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.fillText(labels[year.toString()] || year.toString(), x, trackY - 16);
    }
}

function drawEventDensity(startY, height) {
    if (!allEvents.length) return;

    // Count events per time bucket
    const bucketCount = 200;
    const buckets = new Array(bucketCount).fill(0);
    const yearRange = 12000; // -10000 to 2000

    for (const event of allEvents) {
        const startBucket = Math.floor(((event.year_start + 10000) / yearRange) * bucketCount);
        const endBucket = Math.floor(((event.year_end + 10000) / yearRange) * bucketCount);
        for (let b = Math.max(0, startBucket); b <= Math.min(bucketCount - 1, endBucket); b++) {
            buckets[b]++;
        }
    }

    const maxCount = Math.max(...buckets, 1);

    // Draw density bars
    for (let i = 0; i < bucketCount; i++) {
        if (buckets[i] === 0) continue;

        const year = -10000 + (i / bucketCount) * yearRange;
        const x = yearToX(year);
        const nextYear = -10000 + ((i + 1) / bucketCount) * yearRange;
        const nextX = yearToX(nextYear);
        const barHeight = (buckets[i] / maxCount) * height * 0.7;

        ctx.fillStyle = COLORS.eventDensity;
        ctx.fillRect(x, startY + height - barHeight, Math.max(1, nextX - x - 1), barHeight);
    }
}

function onPointerDown(e) {
    isDragging = true;
    updateFromPointer(e.clientX);
}

function onPointerMove(e) {
    if (!isDragging) return;
    updateFromPointer(e.clientX);
}

function onPointerUp() {
    isDragging = false;
}

function onTouchStart(e) {
    e.preventDefault();
    isDragging = true;
    updateFromPointer(e.touches[0].clientX);
}

function onTouchMove(e) {
    e.preventDefault();
    if (!isDragging) return;
    updateFromPointer(e.touches[0].clientX);
}

function updateFromPointer(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const year = xToYear(x);
    setCurrentYear(year);
    if (onYearChange) {
        if (animFrameId) cancelAnimationFrame(animFrameId);
        animFrameId = requestAnimationFrame(() => {
            onYearChange(currentYear);
            animFrameId = null;
        });
    }
}

function updateYearLabel() {
    const label = document.getElementById('current-year-label');
    if (label && !label.dataset.editing) {
        if (currentYear <= 0) {
            label.textContent = Math.abs(currentYear) + ' BC';
        } else {
            label.textContent = currentYear + ' AD';
        }
    }
}

// Animate smoothly to a target year
export function animateToYear(targetYear, onFrame) {
    targetYear = Math.max(-10000, Math.min(2000, Math.round(targetYear)));
    const startYear = currentYear;
    const startTime = performance.now();
    const duration = 800;
    function step(now) {
        const t = Math.min((now - startTime) / duration, 1);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const year = Math.round(startYear + (targetYear - startYear) * ease);
        setCurrentYear(year);
        if (onFrame) onFrame(year);
        if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

// Timeline highlight for cross-link hover
let highlightYear = null;

export function highlightYearOnTimeline(year) {
    highlightYear = year;
    draw();
}

export function clearTimelineHighlight() {
    highlightYear = null;
    draw();
}

// WorldHistory - Main Application Entry Point

import { apiGet } from './api.js?v=3';
import { initMap, setAllEvents, updateVisibleEvents, toggleBorders, setActiveGranularities, getActiveGranularities, setActiveCategories, getActiveCategories, setMapStyle, flyToEvent, isHierarchyMode } from './map.js?v=3';
import { initTimeline, setCurrentYear, setEvents, getCurrentYear, animateToYear } from './timeline.js?v=3';
import { initPanel, openPanel, closePanel } from './panel.js?v=3';
import { initAuth } from './auth.js?v=3';

let currentYear = 1569;

async function init() {
    // Initialize map
    initMap(handleEventClick);

    // Initialize timeline
    initTimeline(handleYearChange);

    // Initialize side panel
    initPanel();

    // Initialize auth (await to ensure CSRF token is set before user can interact)
    await initAuth();

    // Show Countries toggle
    const bordersToggle = document.getElementById('borders-toggle');
    bordersToggle.addEventListener('change', (e) => {
        toggleBorders(e.target.checked);
    });

    // Granularity toggles
    document.querySelectorAll('.granularity-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            const active = [];
            document.querySelectorAll('.granularity-btn.active').forEach(b => {
                active.push(b.dataset.level);
            });
            setActiveGranularities(active);
            updateVisibleEvents(currentYear);
        });
    });

    // Category toggles
    document.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            const dot = btn.querySelector('.legend-dot');
            const color = dot.dataset.color;
            if (btn.classList.contains('active')) {
                dot.style.background = color;
                dot.style.border = 'none';
            } else {
                dot.style.background = 'transparent';
                dot.style.border = '2px solid ' + color;
            }
            const active = [];
            document.querySelectorAll('.category-btn.active').forEach(b => {
                active.push(b.dataset.category);
            });
            setActiveCategories(active);
            updateVisibleEvents(currentYear);
        });
    });

    // Donate button
    document.getElementById('donate-btn').addEventListener('click', () => {
        window.open('https://ko-fi.com/kevinraynor', '_blank');
    });

    // Year input — click year label to enter edit mode
    const yearLabel = document.getElementById('current-year-label');
    const yearInputContainer = document.getElementById('year-input-container');
    const yearInput = document.getElementById('year-input');
    const eraBtns = document.querySelectorAll('.era-btn');

    function openYearInput() {
        const yr = getCurrentYear();
        yearInput.value = Math.abs(yr);
        eraBtns.forEach(b => b.classList.toggle('active', b.dataset.era === (yr <= 0 ? 'BC' : 'AD')));
        yearInput.max = yr <= 0 ? 10000 : 2000;
        yearLabel.style.display = 'none';
        yearLabel.dataset.editing = '1';
        yearInputContainer.style.display = 'flex';
        yearInput.focus();
        yearInput.select();
    }

    function closeYearInput() {
        yearInputContainer.style.display = 'none';
        yearLabel.style.display = '';
        delete yearLabel.dataset.editing;
    }

    function commitYearInput() {
        const isBC = document.querySelector('.era-btn.active').dataset.era === 'BC';
        let val = Math.abs(Math.round(Number(yearInput.value) || 0));
        val = Math.max(0, Math.min(val, isBC ? 10000 : 2000));
        const targetYear = isBC ? -val : val;
        closeYearInput();
        animateToYear(targetYear, handleYearChange);
    }

    yearLabel.addEventListener('click', openYearInput);

    yearInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitYearInput(); }
        if (e.key === 'Escape') { e.preventDefault(); closeYearInput(); }
    });

    eraBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            eraBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            yearInput.max = btn.dataset.era === 'BC' ? 10000 : 2000;
            yearInput.focus();
        });
    });

    // Close year input when clicking outside
    document.addEventListener('mousedown', (e) => {
        if (yearInputContainer.style.display !== 'none' &&
            !yearInputContainer.contains(e.target) && e.target !== yearLabel) {
            commitYearInput();
        }
    });

    // Year step buttons (±1 year)
    document.getElementById('year-prev').addEventListener('click', (e) => {
        e.stopPropagation();
        const yr = getCurrentYear();
        const target = Math.max(-10000, yr - 1);
        setCurrentYear(target);
        handleYearChange(target);
    });
    document.getElementById('year-next').addEventListener('click', (e) => {
        e.stopPropagation();
        const yr = getCurrentYear();
        const target = Math.min(2000, yr + 1);
        setCurrentYear(target);
        handleYearChange(target);
    });

    // Map style switcher
    document.querySelectorAll('.style-option').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.style-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setMapStyle(btn.dataset.style);
        });
    });

    // Load user preferences (if logged in) and apply them
    try {
        const settings = await apiGet('/api/settings');
        if (settings.show_borders !== undefined) {
            bordersToggle.checked = !!settings.show_borders;
        }
        if (settings.map_style) {
            setMapStyle(settings.map_style);
            document.querySelectorAll('.style-option').forEach(b => {
                b.classList.toggle('active', b.dataset.style === settings.map_style);
            });
        }
    } catch (e) {
        // Not logged in or no settings — use defaults
    }

    // Load events
    try {
        const events = await apiGet('/api/events');
        setAllEvents(events);
        setEvents(events);

        // Start at year 1569 AD
        currentYear = 1569;
        setCurrentYear(1569);
        updateVisibleEvents(1569);

        // Apply initial Show Countries state (after dots exist)
        if (bordersToggle.checked) toggleBorders(true);
    } catch (err) {
        console.error('Failed to load events:', err);
    }
}

function handleYearChange(year) {
    currentYear = year;
    updateVisibleEvents(year);
}

function handleEventClick(eventId) {
    // flyToEvent first — it will always assume panel is open since openPanel follows
    if (!isHierarchyMode()) flyToEvent(eventId);
    openPanel(eventId);
}

// Start the app
document.addEventListener('DOMContentLoaded', init);

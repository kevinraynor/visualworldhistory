// WorldHistory - Main Application Entry Point

import { apiGet } from './api.js?v=3';
import { initMap, setAllEvents, updateVisibleEvents, toggleBorders, setActiveGranularities, getActiveGranularities, setActiveCategories, getActiveCategories } from './map.js?v=3';
import { initTimeline, setCurrentYear, setEvents, getCurrentYear } from './timeline.js?v=3';
import { initPanel, openPanel, closePanel } from './panel.js?v=3';
import { initAuth } from './auth.js?v=3';

let currentYear = 1;

async function init() {
    // Initialize map
    initMap(handleEventClick);

    // Initialize timeline
    initTimeline(handleYearChange);

    // Initialize side panel
    initPanel();

    // Initialize auth (await to ensure CSRF token is set before user can interact)
    await initAuth();

    // Borders toggle
    document.getElementById('borders-toggle').addEventListener('change', (e) => {
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

    // Load events
    try {
        const events = await apiGet('/api/events');
        setAllEvents(events);
        setEvents(events);

        // Start at year 1 AD
        currentYear = 1;
        setCurrentYear(1);
        updateVisibleEvents(1);
    } catch (err) {
        console.error('Failed to load events:', err);
    }
}

function handleYearChange(year) {
    currentYear = year;
    updateVisibleEvents(year);
}

function handleEventClick(eventId) {
    openPanel(eventId);
}

// Start the app
document.addEventListener('DOMContentLoaded', init);

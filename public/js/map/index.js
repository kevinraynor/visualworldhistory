// Map module facade — re-exports the public API from sub-modules

export { initMap, setMapStyle, toggleBorders, showTerritory, clearTerritory, flyToEvent } from './core.js';

export { setAllEvents, updateVisibleEvents, getEventById,
         setActiveGranularities, getActiveGranularities,
         setActiveCategories, getActiveCategories,
         highlightDot, unhighlightDot,
         showTempDot, hideTempDot,
         drawLinkLine, clearLinkLine } from './dots.js';

export { buildHierarchyTree, enterHierarchyMode, exitHierarchyMode,
         isHierarchyMode, getHierarchyRelatedIds, onExitHierarchy,
         updateHierarchyActive } from './hierarchy.js';

export { CATEGORY_COLORS } from './state.js';

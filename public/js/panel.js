// Side Panel module - open/close, content display

import { apiGet, apiPost, apiDelete } from './api.js?v=3';
import { showTerritory, clearTerritory, flyToEvent, getEventById, updateVisibleEvents, drawLinkLine, clearLinkLine, highlightDot, unhighlightDot, showTempDot, hideTempDot, enterHierarchyMode, exitHierarchyMode, isHierarchyMode, onExitHierarchy, buildHierarchyTree } from './map.js?v=3';
import { setCurrentYear, highlightYearOnTimeline, clearTimelineHighlight } from './timeline.js?v=3';

let panelEl, panelBody, panelLoading;
let currentEventId = null;
let currentEventData = null;
let isOpen = false;

// Lightbox state
let lightboxImages = [];
let lightboxIndex = 0;

// Use image proxy on localhost to bypass ORB/CORS
const useImageProxy = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

function proxyUrl(url) {
    if (!useImageProxy || !url) return url;
    if (url.includes('upload.wikimedia.org')) {
        return `/api/image-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
}

// Build an 800px thumbnail URL for lightbox (instead of full resolution)
function lightboxUrl(imageData) {
    if (imageData.thumb_url && imageData.thumb_url.includes('/thumb/')) {
        // Replace /300px- with /800px- in the existing thumbnail URL
        return imageData.thumb_url.replace(/\/\d+px-/, '/800px-');
    }
    return imageData.full_url;
}

export function initPanel() {
    panelEl = document.getElementById('side-panel');
    panelBody = document.getElementById('panel-body');
    panelLoading = document.getElementById('panel-loading');

    // Close button
    document.getElementById('panel-close').addEventListener('click', closePanel);

    // When hierarchy mode exits (via its own close button or map click), also close panel
    onExitHierarchy(() => {
        if (isOpen) {
            isOpen = false;
            panelEl.classList.remove('panel-open');
            panelEl.classList.add('panel-closed');
            clearTerritory();
            clearLinkLine();
            clearTimelineHighlight();
            currentEventId = null;
            currentEventData = null;
        }
    });

    // Click outside to close (on map) — but not on hierarchy overlay
    document.getElementById('map').addEventListener('click', (e) => {
        if (e.target.closest('#hierarchy-overlay')) return;
        if (isOpen && e.target.closest('.leaflet-interactive') === null) {
            closePanel();
        }
        // Also exit hierarchy mode on map click
        if (isHierarchyMode()) exitHierarchyMode();
    });

    // Cross-event link delegation on summary
    document.getElementById('panel-summary').addEventListener('click', (e) => {
        const link = e.target.closest('.event-crosslink');
        if (link) {
            e.preventDefault();
            const targetId = parseInt(link.dataset.eventId, 10);
            const targetEvent = getEventById(targetId);
            if (targetEvent) {
                const midYear = Math.round((targetEvent.year_start + targetEvent.year_end) / 2);
                setCurrentYear(midYear);
                updateVisibleEvents(midYear);
            }
            flyToEvent(targetId);
            openPanel(targetId);
        }
    });

    // Lightbox controls
    const overlay = document.getElementById('lightbox-overlay');
    document.querySelector('.lightbox-close').addEventListener('click', closeLightbox);
    document.getElementById('lightbox-prev').addEventListener('click', () => lightboxNav(-1));
    document.getElementById('lightbox-next').addEventListener('click', () => lightboxNav(1));
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeLightbox();
    });
    document.addEventListener('keydown', (e) => {
        if (overlay.style.display === 'none') return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') lightboxNav(-1);
        if (e.key === 'ArrowRight') lightboxNav(1);
    });
}

export async function openPanel(eventId, forceRefresh = false) {
    if (currentEventId === eventId && isOpen && !forceRefresh) return;

    currentEventId = eventId;
    isOpen = true;
    panelEl.classList.add('panel-open');
    panelEl.classList.remove('panel-closed');

    // Only show loading spinner on first open, not on refresh
    if (!forceRefresh) {
        panelBody.style.display = 'none';
        panelLoading.style.display = 'flex';
    }

    try {
        const data = await apiGet(`/api/events/${eventId}`);
        currentEventData = data;
        renderPanel(data);
    } catch (err) {
        panelLoading.textContent = 'Failed to load event details.';
        console.error('Panel load error:', err);
    }
}

// Refresh the panel content without showing loading spinner
async function refreshPanel() {
    if (currentEventId && isOpen) {
        await openPanel(currentEventId, true);
    }
}

let closingPanel = false;
export function closePanel() {
    if (closingPanel) return;
    closingPanel = true;
    isOpen = false;
    panelEl.classList.remove('panel-open');
    panelEl.classList.add('panel-closed');
    clearTerritory();
    clearLinkLine();
    clearTimelineHighlight();
    currentEventId = null;
    currentEventData = null;
    if (isHierarchyMode()) exitHierarchyMode();
    closingPanel = false;
}

function renderPanel(data) {
    panelLoading.style.display = 'none';
    panelBody.style.display = 'block';

    // Title
    document.getElementById('panel-title').textContent = data.name;

    // Dates
    const startStr = formatYear(data.year_start);
    const endStr = formatYear(data.year_end);
    document.getElementById('panel-dates').textContent = `${startStr} \u2013 ${endStr}`;

    // Category badge
    const badge = document.getElementById('panel-category');
    const cat = data.category || 'general';
    badge.textContent = cat;
    badge.setAttribute('data-cat', cat);

    // Hierarchy button — show only if event has parent or children
    const existingHierBtn = document.getElementById('panel-hierarchy-btn');
    if (existingHierBtn) existingHierBtn.remove();
    const tree = buildHierarchyTree(data.id);
    if (tree && tree.relatedIds.size > 1) {
        const hierBtn = document.createElement('button');
        hierBtn.id = 'panel-hierarchy-btn';
        hierBtn.className = 'btn-hierarchy';
        hierBtn.textContent = 'Show Related Events';
        hierBtn.title = `View ${tree.relatedIds.size} related events`;
        hierBtn.addEventListener('click', () => enterHierarchyMode(data.id));
        badge.parentElement.appendChild(hierBtn);
    }

    // Favorite button
    const favBtn = document.getElementById('panel-favorite');
    favBtn.innerHTML = data.is_favorited ? '&#9733;' : '&#9734;';
    favBtn.classList.toggle('favorited', data.is_favorited);
    favBtn.onclick = () => toggleFavorite(data.id, favBtn);

    // Summary with cross-event links
    const summaryEl = document.getElementById('panel-summary');
    if (data.summary) {
        summaryEl.innerHTML = data.summary
            .split('\n\n')
            .map(p => `<p>${parseCrossLinks(escapeHtml(p))}</p>`)
            .join('');
    } else {
        summaryEl.innerHTML = '<p><em>No detailed summary available yet.</em></p>';
    }

    // Cross-link hover: draw line from current event to target
    summaryEl.querySelectorAll('.event-crosslink').forEach(link => {
        const targetId = parseInt(link.dataset.eventId, 10);
        link.addEventListener('mouseenter', () => {
            const targetEvent = getEventById(targetId);
            if (!targetEvent) return;
            drawLinkLine(
                [data.lat, data.lng],
                [targetEvent.lat, targetEvent.lng],
                targetEvent.category,
                data.id,
                targetId
            );
            highlightDot(targetId);
            showTempDot(targetId);
            const midYear = Math.round((targetEvent.year_start + targetEvent.year_end) / 2);
            highlightYearOnTimeline(midYear);
        });
        link.addEventListener('mouseleave', () => {
            clearLinkLine();
            unhighlightDot(targetId);
            hideTempDot();
            clearTimelineHighlight();
        });
    });

    // Territory shown on click too
    if (data.territory_geojson) {
        showTerritory(data.territory_geojson, data.category);
    }

    // Image gallery
    renderImageGallery(data.images);

    // Key figures
    renderFigures(data.figures);

    // Links
    const linkList = document.getElementById('panel-link-list');
    linkList.innerHTML = '';

    if (data.wikipedia_url) {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.href = data.wikipedia_url;
        a.textContent = 'Wikipedia';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        li.appendChild(a);
        linkList.appendChild(li);
    }

    if (data.read_more_links && Array.isArray(data.read_more_links)) {
        for (const link of data.read_more_links) {
            const li = document.createElement('li');
            const a = document.createElement('a');
            a.href = link.url;
            a.textContent = link.title;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            li.appendChild(a);
            linkList.appendChild(li);
        }
    }

    // Comments
    renderComments(data.comments || [], data.id);
}

// ===== Cross-event link parsing =====

function parseCrossLinks(escapedHtml) {
    return escapedHtml.replace(
        /\[\[event:(\d+)\|([^\]]+)\]\]/g,
        '<a href="#" class="event-crosslink" data-event-id="$1">$2</a>'
    );
}

// ===== Image Gallery =====

function renderImageGallery(images) {
    const section = document.getElementById('panel-images');
    const gallery = document.getElementById('panel-image-gallery');
    gallery.innerHTML = '';

    if (!images || !Array.isArray(images) || images.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';

    images.forEach((img, index) => {
        const item = document.createElement('div');
        item.className = 'gallery-item';

        const imgEl = document.createElement('img');
        imgEl.src = proxyUrl(img.thumb_url);
        imgEl.alt = img.caption || '';
        imgEl.loading = 'lazy';
        imgEl.onerror = () => { item.style.display = 'none'; };

        item.appendChild(imgEl);
        item.addEventListener('click', () => openLightbox(images, index));
        gallery.appendChild(item);
    });

    // Set up gallery arrow navigation
    initGalleryArrows(section, gallery);
}

// ===== Gallery Arrow Navigation =====

function initGalleryArrows(section, gallery) {
    // Remove existing arrows if any
    section.querySelectorAll('.gallery-arrow').forEach(el => el.remove());

    const leftArrow = document.createElement('button');
    leftArrow.className = 'gallery-arrow gallery-arrow-left';
    leftArrow.innerHTML = '&#8249;';
    leftArrow.addEventListener('click', () => scrollGallery(gallery, -1, leftArrow, rightArrow));

    const rightArrow = document.createElement('button');
    rightArrow.className = 'gallery-arrow gallery-arrow-right';
    rightArrow.innerHTML = '&#8250;';
    rightArrow.addEventListener('click', () => scrollGallery(gallery, 1, leftArrow, rightArrow));

    section.style.position = 'relative';
    section.appendChild(leftArrow);
    section.appendChild(rightArrow);

    // Update arrow visibility on scroll
    gallery.addEventListener('scroll', () => updateGalleryArrows(gallery, leftArrow, rightArrow));
    // Initial state
    requestAnimationFrame(() => updateGalleryArrows(gallery, leftArrow, rightArrow));
}

function scrollGallery(gallery, direction, leftArrow, rightArrow) {
    const scrollAmount = 196; // item width (180) + gap (8) + padding
    gallery.scrollBy({ left: direction * scrollAmount, behavior: 'smooth' });
    // Update arrows after animation
    setTimeout(() => updateGalleryArrows(gallery, leftArrow, rightArrow), 350);
}

function updateGalleryArrows(gallery, leftArrow, rightArrow) {
    const atStart = gallery.scrollLeft <= 4;
    const atEnd = gallery.scrollLeft + gallery.clientWidth >= gallery.scrollWidth - 4;
    leftArrow.style.display = atStart ? 'none' : '';
    rightArrow.style.display = atEnd ? 'none' : '';
}

// ===== Lightbox =====

function openLightbox(images, index) {
    lightboxImages = images;
    lightboxIndex = index;
    const overlay = document.getElementById('lightbox-overlay');
    overlay.style.display = 'flex';
    updateLightbox();
}

function closeLightbox() {
    document.getElementById('lightbox-overlay').style.display = 'none';
    lightboxImages = [];
    lightboxIndex = 0;
}

function lightboxNav(direction) {
    if (lightboxImages.length === 0) return;
    lightboxIndex = (lightboxIndex + direction + lightboxImages.length) % lightboxImages.length;
    updateLightbox();
}

function updateLightbox() {
    const img = document.getElementById('lightbox-img');
    const caption = document.getElementById('lightbox-caption');
    const current = lightboxImages[lightboxIndex];

    // Use 800px thumbnail for lightbox instead of full resolution for faster loading
    img.src = proxyUrl(lightboxUrl(current));
    img.alt = current.caption || '';
    caption.textContent = current.caption || '';

    if (current.attribution) {
        caption.textContent += ` (${current.attribution})`;
    }

    // Hide nav buttons if single image
    document.getElementById('lightbox-prev').style.display = lightboxImages.length > 1 ? '' : 'none';
    document.getElementById('lightbox-next').style.display = lightboxImages.length > 1 ? '' : 'none';
}

// ===== Figures Grid =====

function renderFigures(figures) {
    const section = document.getElementById('panel-figures');
    const grid = document.getElementById('panel-figures-grid');
    grid.innerHTML = '';

    if (!figures || !Array.isArray(figures) || figures.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = '';

    for (const figure of figures) {
        const card = document.createElement('a');
        card.className = 'figure-card';
        card.href = figure.wikipedia_url || '#';
        card.target = '_blank';
        card.rel = 'noopener noreferrer';

        const imgEl = document.createElement('img');
        imgEl.src = proxyUrl(figure.photo_url);
        imgEl.alt = figure.name;
        imgEl.loading = 'lazy';
        imgEl.onerror = () => { imgEl.style.display = 'none'; };

        const name = document.createElement('strong');
        name.textContent = figure.name;

        const summary = document.createElement('p');
        summary.textContent = figure.summary;

        card.appendChild(imgEl);
        card.appendChild(name);
        card.appendChild(summary);

        grid.appendChild(card);
    }
}

// ===== Comments =====

function renderComments(comments, eventId) {
    const container = document.getElementById('comments-list');
    const formContainer = document.getElementById('comment-form-container');

    const currentUserId = document.body.dataset.userId;
    const isLoggedIn = !!currentUserId;

    // Comment form
    if (isLoggedIn) {
        formContainer.innerHTML = `
            <div class="comment-form">
                <textarea id="new-comment-text" placeholder="Share your thoughts..." rows="2"></textarea>
                <button id="post-comment-btn">Post</button>
            </div>
        `;
        document.getElementById('post-comment-btn').addEventListener('click', () => {
            submitComment(eventId);
        });
    } else {
        formContainer.innerHTML = '<p style="font-size:12px;color:#999;margin-bottom:12px;">Sign in to leave a comment.</p>';
    }

    // Comment list
    container.innerHTML = '';

    // Build threaded structure
    const topLevel = comments.filter(c => !c.parent_comment_id);
    const replies = comments.filter(c => c.parent_comment_id);

    for (const comment of topLevel) {
        container.appendChild(renderComment(comment, eventId, isLoggedIn, currentUserId));

        const commentReplies = replies.filter(r => r.parent_comment_id == comment.id);
        if (commentReplies.length > 0) {
            const repliesDiv = document.createElement('div');
            repliesDiv.className = 'comment-replies';
            for (const reply of commentReplies) {
                repliesDiv.appendChild(renderComment(reply, eventId, isLoggedIn, currentUserId));
            }
            container.appendChild(repliesDiv);
        }
    }
}

function renderComment(comment, eventId, isLoggedIn, currentUserId) {
    const isOwn = currentUserId && String(comment.user_id) === String(currentUserId);

    const div = document.createElement('div');
    div.className = 'comment';
    div.dataset.commentId = comment.id;

    div.innerHTML = `
        <div class="comment-header">
            <span class="comment-username">${escapeHtml(comment.username)}</span>
            <span class="comment-date">${formatDate(comment.created_at)}</span>
            ${isOwn ? `<button class="comment-delete-btn" title="Delete comment">&times;</button>` : ''}
        </div>
        <div class="comment-body">${escapeHtml(comment.body)}</div>
        <div class="comment-actions">
            <button class="comment-vote-btn" data-comment-id="${comment.id}">
                &#9650; <span class="vote-count">${comment.upvotes || 0}</span>
            </button>
            ${isLoggedIn ? `<button class="comment-reply-btn" data-comment-id="${comment.id}" data-event-id="${eventId}">Reply</button>` : ''}
        </div>
    `;

    // Wire up event handlers
    const voteBtn = div.querySelector('.comment-vote-btn');
    voteBtn.addEventListener('click', () => voteComment(comment.id));

    const replyBtn = div.querySelector('.comment-reply-btn');
    if (replyBtn) {
        replyBtn.addEventListener('click', () => showReplyForm(comment.id, eventId, div));
    }

    const deleteBtn = div.querySelector('.comment-delete-btn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', () => deleteComment(comment.id));
    }

    return div;
}

async function submitComment(eventId, parentId = null) {
    const textarea = parentId
        ? document.querySelector(`#reply-form-${parentId} textarea`)
        : document.getElementById('new-comment-text');

    if (!textarea) return;
    const body = textarea.value.trim();

    if (body.length < 10) {
        alert('Comment must be at least 10 characters.');
        return;
    }

    try {
        const payload = { event_id: eventId, body };
        if (parentId) payload.parent_comment_id = parentId;
        await apiPost('/api/comments', payload);
        // Clear textarea and refresh
        textarea.value = '';
        await refreshPanel();
    } catch (err) {
        alert(err.message);
    }
}

async function voteComment(commentId) {
    try {
        const result = await apiPost(`/api/comments/${commentId}/vote`);
        // Update vote count inline without full refresh
        const btn = document.querySelector(`.comment-vote-btn[data-comment-id="${commentId}"]`);
        if (btn) {
            const countSpan = btn.querySelector('.vote-count');
            if (countSpan) countSpan.textContent = result.upvotes;
            btn.classList.toggle('voted', result.action === 'added');
        }
    } catch (err) {
        console.error('Vote failed:', err);
    }
}

async function deleteComment(commentId) {
    if (!confirm('Delete this comment?')) return;
    try {
        await apiDelete(`/api/comments/${commentId}`);
        await refreshPanel();
    } catch (err) {
        alert(err.message);
    }
}

function showReplyForm(parentId, eventId, commentDiv) {
    const existingForm = document.getElementById('reply-form-' + parentId);
    if (existingForm) { existingForm.remove(); return; }

    const form = document.createElement('div');
    form.id = 'reply-form-' + parentId;
    form.className = 'comment-form';
    form.style.marginTop = '8px';
    form.innerHTML = `
        <textarea placeholder="Write a reply..." rows="2"></textarea>
        <button>Reply</button>
    `;
    form.querySelector('button').addEventListener('click', () => {
        submitComment(eventId, parentId);
    });
    commentDiv.after(form);
}

async function toggleFavorite(eventId, btn) {
    try {
        const result = await apiPost('/api/favorites', { event_id: eventId });
        btn.innerHTML = result.is_favorited ? '&#9733;' : '&#9734;';
        btn.classList.toggle('favorited', result.is_favorited);
    } catch (err) {
        console.error('Favorite toggle failed:', err);
    }
}

function formatYear(year) {
    if (year < 0) return Math.abs(year) + ' BC';
    if (year === 0) return '1 BC';
    return year + ' AD';
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

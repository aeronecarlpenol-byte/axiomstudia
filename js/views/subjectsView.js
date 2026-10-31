/**
 * Axiom Studia — Subject Workspace
 * Compact, unified single-page command center for studying a specific subject.
 *
 * Structure:
 * 1. Subject Header: Name, code, instructor, short description
 * 2. Tasks to Study: Topics as study tasks with name, due date, priority, task type, and completion status
 * 3. Focus: Compact timer with Start/Pause/Reset, session tracking, today's time & total time
 * 4. Resources: Compact shelf supporting modules, notes, PDFs, drive links, videos, reviewers, etc.
 * 5. PDF Viewer: Embedded PDF.js viewer with file upload, page navigation, and zoom controls
 *
 * Note: Grades are maintained in their own dedicated #grades section.
 */

import { db } from '../db.js';
import { getQuoteForDate } from '../dailyQuotes.js';
import { timer } from '../timer.js';
import { JustStartEngine } from '../just-start.js';
import { showCreateTaskModal, showEditTaskModal } from './tasksView.js';
import { savePdfToStorage, getPdfFromStorage, deletePdfFromStorage } from '../pdfStorage.js';
import { parseYouTubeUrl, parseYouTubeResource, mountYouTubeViewer } from '../youtube.js';

// ── PDF Viewer Module-Level State ──────────────────────────────────────────
let pdfViewerState = {
  pdfDoc: null,
  currentPage: 1,
  scale: 1.0,
  filename: '',
  subjectId: null,
  rendering: false,
  fitMode: 'width',
  spaceDown: false,
  thumbsOpen: false,
  searchQuery: '',
  searchResults: [],
  searchIndex: 0,
  // Concurrency & large file handling
  renderSequence: 0,
  activeRenderTask: null,
  activeRenderPromise: null,
  activeBlobUrl: null,
  searchSequence: 0
};
let pdfKeyHandler = null;
let pdfKeyUpHandler = null;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const formatVideoTime = seconds => {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
const resourceVideoId = resource => parseYouTubeUrl(resource?.url || resource?.youtubeUrl || '') ||
  (/^[A-Za-z0-9_-]{11}$/.test(resource?.videoId || '') ? resource.videoId : null);

export function renderSubjects(container) {
  let selectedSubjectId = null;
  let viewGeneration = 0;
  let activeResourceId = null;
  let restoredResourceId = null;
  let disposeVideo = null;
  let timerUnsubscribe = null;
  let hideSubjectCompleted = false;

  // Per-render Focus cockpit state (reset when switching subjects)
  let isFullscreen = false;
  let showMotivation = true;
  let currentQuote = getQuoteForDate().quote;

  let mouseMoveHandler = null;
  let mouseUpHandler = null;
  let thumbObserver = null;
  let sidebarKeyHandler = null;
  let dividerMouseMoveHandler = null;
  let dividerMouseUpHandler = null;

  function cleanup() {
    viewGeneration++;
    disposeVideo?.();
    disposeVideo = null;
    if (timerUnsubscribe) {
      timerUnsubscribe();
      timerUnsubscribe = null;
    }
    if (dividerMouseMoveHandler) {
      window.removeEventListener('mousemove', dividerMouseMoveHandler);
      dividerMouseMoveHandler = null;
    }
    if (dividerMouseUpHandler) {
      window.removeEventListener('mouseup', dividerMouseUpHandler);
      dividerMouseUpHandler = null;
    }
    if (sidebarKeyHandler) {
      document.removeEventListener('keydown', sidebarKeyHandler);
      sidebarKeyHandler = null;
    }
    document.body.classList.remove('ws-reader-active');
    if (mouseMoveHandler) {
      window.removeEventListener('mousemove', mouseMoveHandler);
      mouseMoveHandler = null;
    }
    if (mouseUpHandler) {
      window.removeEventListener('mouseup', mouseUpHandler);
      mouseUpHandler = null;
    }
    if (pdfKeyHandler) {
      document.removeEventListener('keydown', pdfKeyHandler);
      pdfKeyHandler = null;
    }
    if (pdfKeyUpHandler) {
      document.removeEventListener('keyup', pdfKeyUpHandler);
      pdfKeyUpHandler = null;
    }
    if (pdfViewerState.activeRenderTask) {
      try { pdfViewerState.activeRenderTask.cancel(); } catch (_) {}
      pdfViewerState.activeRenderTask = null;
    }
    if (thumbObserver) {
      thumbObserver.disconnect();
      thumbObserver = null;
    }
  }

  function render() {
    cleanup();
    document.body.classList.add('ws-reader-active');

    // Reset focus cockpit state on subject switch
    isFullscreen = false;
    showMotivation = true;
    currentQuote = getQuoteForDate().quote;

    const subjects = db.getSubjects();
    const targetSub = sessionStorage.getItem('axiom_target_subject_id');
    if (targetSub && subjects.some(s => s.id === targetSub)) {
      selectedSubjectId = targetSub;
      sessionStorage.removeItem('axiom_target_subject_id');
    } else if (!selectedSubjectId && subjects.length > 0) {
      const previousSubject = db.getStudyActivity()?.subjectId;
      selectedSubjectId = subjects.some(s => s.id === previousSubject) ? previousSubject : subjects[0].id;
    }

    const currentSubject = db.getSubjectById(selectedSubjectId);

    if (currentSubject) {
      db.recordStudyActivity({
        type: 'subject_visit',
        subjectId: currentSubject.id,
        subjectCode: currentSubject.code
      });
    }

    // Empty state
    if (!currentSubject) {
      container.innerHTML = `
        <div class="ws-container">
          <div class="tasks-toolbar">
            <div>
              <h2>Workspace</h2>
              <p style="font-size: 0.85rem; color: var(--text-secondary);">Dedicated academic command center per course</p>
            </div>
            <div>
              <button class="btn btn-primary" id="btn-new-subject">+ New Subject</button>
            </div>
          </div>
          <div class="ws-no-subject">
            <div class="ws-no-subject-icon">📚</div>
            <h3>No subjects found</h3>
            <p>Create your first subject to activate the dedicated study workspace.</p>
            <button class="btn btn-primary" id="btn-create-first-subject">+ Create Subject</button>
          </div>
        </div>
      `;
      const createFirst = () => showNewSubjectModal(render);
      container.querySelector('#btn-new-subject')?.addEventListener('click', createFirst);
      container.querySelector('#btn-create-first-subject')?.addEventListener('click', createFirst);
      return;
    }

    // Per-subject data
    const subjectTasks = db.getTasks().filter(t => t.subjectId === currentSubject.id);
    const pendingTasks = subjectTasks.filter(t => t.status !== 'completed');
    const completedTasks = subjectTasks.filter(t => t.status === 'completed');

    const allResources = db.getResources() || [];
    const subjectResources = allResources.filter(r => r.subjectId === currentSubject.id);
    if (!activeResourceId) activeResourceId = db.getStudyActivity()?.resourceId || null;
    const activeResource = subjectResources.find(r => r.id === activeResourceId) || null;
    const activeVideo = activeResource && (activeResource.type === 'youtube' || resourceVideoId(activeResource) || parseYouTubeResource(activeResource.url || '')?.playlistId) ? activeResource : null;
    const activeVideoId = activeVideo ? resourceVideoId(activeVideo) : null;
    const activePlaylistId = activeVideo ? (activeVideo.playlistId || parseYouTubeResource(activeVideo.url || '')?.playlistId) : null;
    const activeYouTubeUrl = activePlaylistId ? `https://www.youtube.com/playlist?list=${activePlaylistId}` : `https://www.youtube.com/watch?v=${activeVideoId}`;

    const focusSessions = db.getFocusSessions() || [];
    const subjectSessions = focusSessions.filter(s => s.subjectId === currentSubject.id);

    const todayStr = db.getTodayDate();
    const todaySessions = subjectSessions.filter(s => s.startTime && db.isSameLocalDate(s.startTime, todayStr));
    const todayMins = todaySessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
    const totalSubjectMins = subjectSessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

    function formatMins(m) {
      if (m < 60) return `${m}m`;
      const hrs = Math.floor(m / 60);
      const rem = m % 60;
      return rem > 0 ? `${hrs}h ${rem}m` : `${hrs}h`;
    }

    // Sort tasks: overdue first, then priority, then deadline
    const priorityWeights = { urgent: 0, high: 1, medium: 2, low: 3 };
    const sortedTasks = [...subjectTasks].sort((a, b) => {
      const aDone = a.status === 'completed';
      const bDone = b.status === 'completed';
      if (aDone !== bDone) return aDone ? 1 : -1;
      const sa = db.getTaskDeadlineStatus(a);
      const sb = db.getTaskDeadlineStatus(b);
      if (sa === 'overdue' && sb !== 'overdue') return -1;
      if (sb === 'overdue' && sa !== 'overdue') return 1;
      const pa = priorityWeights[a.priority] ?? 2;
      const pb = priorityWeights[b.priority] ?? 2;
      if (pa !== pb) return pa - pb;
      if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });

    // Automatically attach task inside the subject
    let activeTaskId = timer.selectedTaskId;
    const existingTask = activeTaskId ? db.getTaskById(activeTaskId) : null;
    if (!existingTask || existingTask.subjectId !== currentSubject.id) {
      const topPending = pendingTasks.length > 0 ? pendingTasks[0] : (subjectTasks.length > 0 ? subjectTasks[0] : null);
      if (topPending) {
        timer.setContext(currentSubject.id, null, topPending.id);
        activeTaskId = topPending.id;
      } else {
        timer.setContext(currentSubject.id, null, null);
        activeTaskId = null;
      }
    }
    const currentFocusTask = activeTaskId ? db.getTaskById(activeTaskId) : null;
    const focusSubjectTasks = subjectTasks.filter(t => t.status !== 'completed');

    // ── PDF Viewer: determine if we should show viewer or empty state
    const pdfIsOpen = !activeVideo && !!(pdfViewerState.pdfDoc && pdfViewerState.subjectId === currentSubject.id);

    container.innerHTML = `
      <div class="ws-container" style="--ws-accent: ${currentSubject.color || '#38bdf8'};">
        <!-- ── Top Subject Strip (Compact Command Header) ───────────────────── -->
        <h2 class="ws-page-title">Workspace</h2>
        <header class="ws-top-strip">
          <div class="ws-top-strip-left">
            <select class="ws-subject-select" id="ws-subject-dropdown" aria-label="Select Subject">
              ${subjects.map(s => `
                <option value="${s.id}" ${s.id === currentSubject.id ? 'selected' : ''}>
                  ${s.code} · ${s.name}
                </option>
              `).join('')}
            </select>
            <div class="ws-subject-inline-meta">
              <span class="ws-subject-icon">${currentSubject.icon || '📚'}</span>
              <span class="ws-subject-name-inline">${currentSubject.name}</span>
              ${currentSubject.instructor ? `<span class="ws-meta-sep">•</span><span class="ws-meta-inst">${currentSubject.instructor}</span>` : ''}
              ${currentSubject.units ? `<span class="ws-meta-sep">•</span><span>${currentSubject.units}U</span>` : ''}
              ${currentSubject.schedule ? `<span class="ws-meta-sep">•</span><span>${currentSubject.schedule}</span>` : ''}
            </div>
          </div>

          <div class="ws-top-strip-right">
            <div class="ws-header-stats-compact">
              <span class="ws-stat-pill" title="Pending study tasks">TASKS: <b style="color:${pendingTasks.length > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)'};">${pendingTasks.length}</b></span>
              <span class="ws-stat-pill" title="Today's study time">TODAY: <b>${formatMins(todayMins)}</b></span>
              <span class="ws-stat-pill" title="Total subject study time">TOTAL: <b>${formatMins(totalSubjectMins)}</b></span>
            </div>
            <button class="btn btn-secondary btn-sm ws-btn-sub-action" id="btn-edit-subject" title="Edit Subject Information">Edit Info</button>
            <button class="btn btn-primary btn-sm ws-btn-sub-action" id="btn-new-subject" title="Create New Subject">+ New Subject</button>
            <button class="btn btn-ghost btn-sm ws-sidebar-toggle-btn" id="ws-btn-toggle-sidebar" title="Toggle Sidebar (Shortcut: \)">
              <span class="ws-sidebar-toggle-icon">◨</span>
              <span class="ws-sidebar-toggle-text">Sidebar</span>
            </button>
          </div>
        </header>

        <!-- ── READER-FIRST TWO-COLUMN WORKSPACE LAYOUT ────────────────────── -->
        <div class="ws-reader-layout" id="ws-reader-layout">

          <!-- ── Left Column (~68% width, full height): PDF Reader ─────────── -->
          <section class="ws-reader-pane" aria-label="Study Viewer">
            <div class="ws-panel ws-pdf-viewer-panel" aria-label="Study Viewer" id="ws-pdf-viewer-section">
              <div class="ws-resource-header">
                <span>Study Viewer</span>
                <button type="button" class="btn btn-secondary btn-sm" id="ws-change-resource" aria-controls="ws-resource-picker" aria-expanded="${!activeVideo && !pdfIsOpen}">Change Resource</button>
              </div>
              <section class="ws-resource-picker" id="ws-resource-picker" aria-label="Choose a study resource" ${activeVideo || pdfIsOpen ? 'hidden' : ''}>
                <div class="ws-resource-picker-inner">
                  <h3>Choose your study resource</h3>
                  <p>Read or watch, with your study tools beside you.</p>
                  <div class="ws-resource-options">
                    <button type="button" class="ws-resource-option" id="ws-choose-pdf">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>
                      <strong>Upload PDF</strong><span>Read a PDF from your device.</span>
                    </button>
                    <button type="button" class="ws-resource-option" id="ws-choose-youtube" aria-controls="ws-youtube-form" aria-expanded="false">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="4"/><path d="m10 8 6 4-6 4z"/></svg>
                      <strong>YouTube Video</strong><span>Watch a lecture or video here.</span>
                    </button>
                    <button type="button" class="ws-resource-option" id="ws-choose-playlist" aria-controls="ws-youtube-form" aria-expanded="false"><strong>YouTube Playlist</strong><span>Watch a series in this viewer.</span></button>
                  </div>
                  <input type="file" id="ws-resource-pdf-input" accept=".pdf,application/pdf" hidden aria-label="Upload PDF" />
                  <form id="ws-youtube-form" class="ws-youtube-form" hidden novalidate>
                    <label for="ws-youtube-url">YouTube URL</label>
                    <div class="ws-youtube-input-row"><input type="url" id="ws-youtube-url" placeholder="https://www.youtube.com/watch?v=…" aria-describedby="ws-youtube-hint ws-youtube-url-error" autocomplete="off" required /><button class="btn btn-primary" type="submit">Open Resource</button></div>
                    <p id="ws-youtube-hint">Supports videos, playlists, watch links with a playlist, Shorts, Live, and embeds.</p>
                    <p id="ws-youtube-url-error" class="ws-resource-error" role="alert" hidden></p>
                  </form>
                  <button type="button" class="btn btn-ghost btn-sm" id="ws-resource-cancel" ${activeVideo || pdfIsOpen ? '' : 'hidden'}>Return to current resource</button>
                </div>
              </section>
              <div class="ws-resource-content" id="ws-resource-content" ${activeVideo || pdfIsOpen ? '' : 'hidden'}>

              ${activeVideo ? `
                <div class="ws-pdf-topbar"><div class="ws-pdf-filename">▶ ${escapeHtml(activeVideo.title)}</div><span class="ws-video-position">${formatVideoTime(activeVideo.lastPlaybackPosition || 0)}</span>${activeVideoId || activePlaylistId ? `<a class="ws-video-external" href="${activeYouTubeUrl}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>` : ''}</div>
                <div class="ws-playlist-controls"><span id="ws-current-video-title">${escapeHtml(activeVideo.currentVideoTitle || (activePlaylistId ? activeVideo.title : ""))}</span>${activePlaylistId ? `<button id="ws-playlist-prev" class="btn btn-secondary btn-sm" disabled>Previous</button><button id="ws-playlist-next" class="btn btn-secondary btn-sm" disabled>Next</button><small>Use the player’s playlist menu to choose a video.</small>` : ""}</div><div class="ws-video-body"><div class="ws-video-frame" id="ws-video-frame"><div id="ws-youtube-player" class="ws-video-player"><span>Loading video…</span></div></div><div class="ws-video-error" id="ws-video-error" role="alert" hidden><strong>Video unavailable</strong><p></p><div class="ws-video-error-actions"><button type="button" class="btn btn-secondary btn-sm" id="ws-video-retry">Try Again</button>${activeVideoId || activePlaylistId ? `<a class="btn btn-secondary btn-sm" href="${activeYouTubeUrl}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>` : ''}</div></div></div>
              ` : `

              <!-- Top Toolbar: single distraction-free compact bar -->
              <div class="ws-pdf-topbar" id="ws-pdf-topbar">
                <button class="ws-pdf-tb-btn ${pdfViewerState.thumbsOpen ? 'active' : ''}" id="ws-pdf-thumbs-btn" title="Toggle page thumbnails (T)" ${!pdfIsOpen ? 'disabled' : ''}>
                  📑
                </button>
                <div class="ws-pdf-topbar-sep"></div>

                <div class="ws-pdf-filename" title="${pdfIsOpen ? escapeHtml(pdfViewerState.filename) : ''}">
                  ${pdfIsOpen ? `📄 ${escapeHtml(pdfViewerState.filename)}` : 'No PDF Loaded'}
                </div>

                ${pdfIsOpen ? `
                  <div class="ws-pdf-topbar-sep"></div>

                  <!-- Page navigation -->
                  <div class="ws-pdf-nav-group">
                    <button class="ws-pdf-tb-btn" id="ws-pdf-prev-btn" ${pdfViewerState.currentPage <= 1 ? 'disabled' : ''} title="Previous page (Left Arrow / Page Up)">◀</button>
                    <div class="ws-pdf-page-indicator">
                      <input type="number" class="ws-pdf-page-input" id="ws-pdf-page-num"
                        value="${pdfViewerState.currentPage}"
                        min="1" max="${pdfViewerState.pdfDoc.numPages}"
                        aria-label="Current page" />
                      <span class="ws-pdf-page-total">/ ${pdfViewerState.pdfDoc.numPages}</span>
                    </div>
                    <button class="ws-pdf-tb-btn" id="ws-pdf-next-btn" ${pdfViewerState.currentPage >= pdfViewerState.pdfDoc.numPages ? 'disabled' : ''} title="Next page (Right Arrow / Page Down)">▶</button>
                  </div>

                  <div class="ws-pdf-topbar-sep"></div>

                  <!-- Zoom controls -->
                  <div class="ws-pdf-zoom-group">
                    <button class="ws-pdf-tb-btn" id="ws-pdf-zoom-out-btn" title="Zoom out (- / Ctrl+Wheel)">−</button>
                    <span class="ws-pdf-zoom-label" id="ws-pdf-zoom-label">${Math.round(pdfViewerState.scale * 100)}%</span>
                    <button class="ws-pdf-tb-btn" id="ws-pdf-zoom-in-btn" title="Zoom in (+ / Ctrl+Wheel)">+</button>
                    <button class="ws-pdf-tb-btn ${pdfViewerState.fitMode === 'width' ? 'active' : ''}" id="ws-pdf-fit-width-btn" title="Fit to width (W)">Fit W</button>
                    <button class="ws-pdf-tb-btn ${pdfViewerState.fitMode === 'page' ? 'active' : ''}" id="ws-pdf-fit-page-btn" title="Fit full page (P)">Fit P</button>
                    <button class="ws-pdf-tb-btn" id="ws-pdf-reset-zoom-btn" title="Reset zoom to 100% (0)">1:1</button>
                  </div>

                  <div class="ws-pdf-topbar-sep"></div>

                  <!-- Reading tools -->
                  <button class="ws-pdf-tb-btn" id="ws-pdf-search-toggle-btn" title="Search text in document (Ctrl+F)">🔍</button>
                  <button class="ws-pdf-tb-btn" id="ws-pdf-bookmark-btn" title="Bookmark current page">🔖</button>
                  <button class="ws-pdf-tb-btn" id="ws-pdf-fullscreen-btn" title="Toggle Fullscreen (Esc to exit)">⛶</button>
                  <button class="ws-pdf-tb-btn danger" id="ws-pdf-close-btn" title="Close document">✕</button>
                ` : ''}

                <label class="btn btn-secondary btn-sm ws-pdf-upload-btn" title="Load PDF from your device" style="margin-left:auto; position:relative; overflow:hidden; cursor:pointer; flex-shrink:0;">
                  📂 Load PDF
                  <input type="file" id="ws-pdf-file-input" accept=".pdf" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;" />
                </label>
              </div>

              ${pdfIsOpen ? `
                <!-- Document Search Bar (Collapsible) -->
                <div class="ws-pdf-search-bar" id="ws-pdf-search-bar" style="display:none;">
                  <span style="font-size:0.8rem; color:var(--text-muted);">🔍</span>
                  <input type="text" id="ws-pdf-search-input" class="ws-pdf-search-input" placeholder="Search text in PDF..." aria-label="Search in PDF" />
                  <button class="ws-pdf-tb-btn" id="ws-pdf-search-prev-btn" title="Previous occurrence">◀ Prev</button>
                  <span class="ws-pdf-search-count" id="ws-pdf-search-count"></span>
                  <button class="ws-pdf-tb-btn" id="ws-pdf-search-next-btn" title="Next occurrence">Next ▶</button>
                  <button class="ws-pdf-tb-btn danger" id="ws-pdf-search-close-btn" title="Close search">✕</button>
                </div>

                <!-- Document Body: Collapsible Left Thumbnails + Main Viewport -->
                <div class="ws-pdf-body">
                  <!-- Collapsible Left Thumbnail Sidebar -->
                  <div class="ws-pdf-thumbs-sidebar" id="ws-pdf-thumbs-sidebar" style="display:${pdfViewerState.thumbsOpen ? 'flex' : 'none'};">
                    <div class="ws-pdf-thumbs-header">
                      <span>PAGES (${pdfViewerState.pdfDoc.numPages})</span>
                    </div>
                    <div class="ws-pdf-thumbs-list" id="ws-pdf-thumbs-list">
                      <!-- Rendered dynamically -->
                    </div>
                  </div>

                  <!-- Canvas Viewport -->
                  <div class="ws-pdf-viewport" id="ws-pdf-viewport" tabindex="0" title="Space + Drag to Pan · Ctrl + Wheel to Zoom · Double-click to Toggle Zoom">
                    <div class="ws-pdf-loading" id="ws-pdf-loading" style="display:none;">
                      <div class="ws-pdf-spinner"></div>
                      <span class="ws-pdf-loading-text">Rendering document...</span>
                    </div>
                    <div class="ws-pdf-error-overlay" id="ws-pdf-error-overlay" style="display:none;">
                      <span class="ws-pdf-error-icon">⚠️</span>
                      <div class="ws-pdf-error-msg" id="ws-pdf-error-text"></div>
                      <button class="btn btn-secondary btn-sm" id="ws-pdf-error-retry-btn" style="margin-top:var(--space-2);">Retry Page</button>
                    </div>
                    <div class="ws-pdf-canvas-wrap" id="ws-pdf-canvas-wrap">
                      <canvas id="ws-pdf-canvas"></canvas>
                    </div>
                  </div>
                </div>

                <!-- Viewer Status Bar (Bottom Helper) -->
                <div class="ws-pdf-statusbar">
                  <div class="ws-pdf-status-hints">
                    <span>💡 <b>Space + Drag</b>: Pan</span>
                    <span>•</span>
                    <span><b>Ctrl + Scroll</b>: Zoom</span>
                    <span>•</span>
                    <span><b>Double-Click</b>: Zoom toggle</span>
                  </div>
                  <div id="ws-pdf-bookmark-indicator" style="font-family:var(--font-mono); font-size:0.65rem; color:var(--accent-amber);"></div>
                </div>
              ` : `
                <!-- Empty State -->
                <div class="ws-pdf-empty">
                  <span class="ws-pdf-empty-icon">📄</span>
                  <div class="ws-pdf-empty-title">Document Reader</div>
                  <div class="ws-pdf-empty-sub">
                    Open textbook chapters, lecture slides, or exam reviewers. All documents stay within your workspace with bookmarks and zoom memory.
                  </div>
                  <label class="btn btn-primary ws-pdf-upload-btn" style="margin-top:var(--space-3); position:relative; overflow:hidden; cursor:pointer;">
                    📂 Select PDF from Device
                    <input type="file" id="ws-pdf-file-input-empty" accept=".pdf" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;" />
                  </label>
                </div>
              `}
              `}
              </div>
            </div>
          </section>

          <!-- ── Draggable Divider ─────────────────────────────────────────── -->
          <div class="ws-divider" id="ws-divider" role="separator" aria-label="Resize sidebar" title="Drag to resize sidebar · Double-click to reset"></div>

          <!-- ── Right Column (~32% width, min 300px, max 380px): Sidebar ──── -->
          <aside class="ws-sidebar" id="ws-sidebar" data-active-tab="timer">

            <!-- Mobile Tabs (visible under 900px only) -->
            <div class="ws-mobile-tabs" id="ws-mobile-tabs">
              <button class="ws-mobile-tab active" data-tab="timer">⏱ Timer</button>
              <button class="ws-mobile-tab" data-tab="tasks">📋 Tasks (${pendingTasks.length})</button>
              <button class="ws-mobile-tab" data-tab="resources">📁 Resources (${subjectResources.length})</button>
            </div>

            <!-- ── 1. Compact Timer Panel ───────────────────────────────────── -->
            <section class="ws-panel ws-timer-panel ws-tab-panel" id="ws-panel-timer" aria-label="Focus Timer">
              <div class="ws-timer-compact-header">
                <div class="ws-timer-title-line" id="ws-focus-task-title" title="${currentFocusTask ? currentFocusTask.title : currentSubject.code}">
                  ${currentFocusTask ? currentFocusTask.title : currentSubject.code}
                </div>
                ${activeResource ? `<div class="ws-studying-resource">Studying: ${activeVideo ? '▶' : activeResource.type === 'pdf' ? '📄' : '●'} ${escapeHtml(activeResource.title)}</div>` : ''}
                <button class="btn btn-ghost btn-sm" id="ws-btn-toggle-fullscreen" style="font-size:0.75rem; padding:2px 8px;" title="Focus Fullscreen Mode">⛶ Fullscreen</button>
              </div>

              <div class="focus-container ws-compact-focus" id="ws-focus-cockpit">
                <!-- Duration Presets (single horizontally scrollable row, small size) -->
                <div class="presets-bar ws-presets-scroll">
                  ${[15, 25, 30, 45, 50, 60, 90].map(mins => `
                    <button class="preset-chip ${timer.durationMinutes === mins ? 'active' : ''}" data-mins="${mins}">
                      ${mins}m
                    </button>
                  `).join('')}
                </div>

                <!-- Timer Digits (~36px) -->
                <div class="timer-display ws-compact-timer-display" id="ws-focus-timer-text">${timer.formatTime()}</div>

                <!-- Progress Bar -->
                <div class="progress-bar ws-compact-progress" style="width:100%; height:4px; margin:0 auto var(--space-2);">
                  <div class="progress-fill" id="ws-focus-progress-fill" style="width:${timer.getProgress()}%;"></div>
                </div>

                <!-- Focus & Finish Session buttons side-by-side -->
                <div class="ws-timer-btn-row">
                  <button class="btn btn-primary btn-timer-primary ws-timer-main-btn" id="ws-btn-start-pause">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    START
                  </button>
                  <button class="btn btn-secondary ws-timer-finish-btn" id="ws-btn-finish-session">
                    FINISH SESSION
                  </button>
                </div>

                <!-- Ambience options in small dropdown & Mini task picker -->
                <div class="ws-compact-controls-row">
                  <div class="ws-ambience-picker">
                    <label for="ws-sound-select" class="ws-mini-label">AMBIENCE</label>
                    <select id="ws-sound-select" class="ws-mini-select" aria-label="Ambience Sound">
                      <option value="none" ${timer.ambientSound === 'none' ? 'selected' : ''}>Silence</option>
                      <option value="brown" ${timer.ambientSound === 'brown' ? 'selected' : ''}>Brown Noise</option>
                      <option value="rain" ${timer.ambientSound === 'rain' ? 'selected' : ''}>Rain</option>
                      <option value="library" ${timer.ambientSound === 'library' ? 'selected' : ''}>Library</option>
                    </select>
                  </div>

                  ${subjectTasks.length > 0 ? `
                    <div class="ws-task-picker-wrap">
                      <label for="ws-focus-task-picker" class="ws-mini-label">ACTIVE TASK</label>
                      <select id="ws-focus-task-picker" class="ws-mini-select" aria-label="Select study task">
                        ${subjectTasks.map(t => `<option value="${t.id}" ${currentFocusTask?.id === t.id ? 'selected' : ''}>${t.status === 'completed' ? '✓ ' : '▶ '}${t.title}</option>`).join('')}
                        <option value="" ${!currentFocusTask ? 'selected' : ''}>General ${currentSubject.code} Study</option>
                      </select>
                    </div>
                  ` : ''}
                </div>

                <!-- Subtask Checklist (if active task has subtasks) -->
                ${currentFocusTask && currentFocusTask.subjectId === currentSubject.id && currentFocusTask.subtasks && currentFocusTask.subtasks.length > 0 ? `
                  <div class="ws-subtask-box">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                      <span style="font-size:0.72rem; font-family:var(--font-mono); color:var(--accent-primary); text-transform:uppercase;">
                        Subtasks (${currentFocusTask.subtasks.filter(s => s.completed).length}/${currentFocusTask.subtasks.length})
                      </span>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:4px; max-height:100px; overflow-y:auto;">
                      ${currentFocusTask.subtasks.map(st => `
                        <label style="display:flex; align-items:center; gap:6px; font-size:0.78rem; cursor:pointer;">
                          <input type="checkbox" ${st.completed ? 'checked' : ''} data-action="ws-toggle-subtask" data-st-id="${st.id}">
                          <span style="${st.completed ? 'text-decoration:line-through; opacity:0.6;' : ''}">${st.text}</span>
                        </label>
                      `).join('')}
                    </div>
                  </div>
                ` : ''}

                <!-- Motivational quote as a single small line -->
                ${showMotivation && currentQuote ? `
                  <div class="ws-mini-quote" id="ws-motivation-banner">
                    <span class="ws-mini-quote-text" title="${currentQuote}">"${currentQuote}"</span>
                    <button class="btn btn-ghost btn-sm ws-quote-close-btn" id="ws-btn-hide-motivation" title="Dismiss quote">✕</button>
                  </div>
                ` : ''}

                <!-- Hidden audio button placeholders for backward compatibility -->
                <div style="display:none;" aria-hidden="true">
                  <button class="sound-btn ${timer.ambientSound === 'none' ? 'active' : ''}" data-sound="none"></button>
                  <button class="sound-btn ${timer.ambientSound === 'brown' ? 'active' : ''}" data-sound="brown"></button>
                  <button class="sound-btn ${timer.ambientSound === 'rain' ? 'active' : ''}" data-sound="rain"></button>
                  <button class="sound-btn ${timer.ambientSound === 'library' ? 'active' : ''}" data-sound="library"></button>
                </div>
              </div>
            </section>

            <!-- ── 2. Tasks Panel (always visible, flexible height) ──────────── -->
            <section class="ws-panel ws-tasks-panel ws-tab-panel" id="ws-panel-tasks" aria-label="Tasks to Study">
              <div class="ws-panel-header ws-tasks-compact-header">
                <div class="ws-tasks-header-left">
                  <div class="ws-panel-label" style="margin:0;">
                    TASKS TO STUDY <span class="ws-tasks-count">${pendingTasks.length}/${subjectTasks.length}</span>
                  </div>
                </div>
                <div class="ws-tasks-header-right">
                  <label class="ws-hide-done-label">
                    <input type="checkbox" id="ws-toggle-hide-done" ${hideSubjectCompleted ? 'checked' : ''} />
                    <span>Hide done</span>
                  </label>
                  <button class="btn btn-primary btn-sm" id="btn-add-subject-task" style="padding:2px 8px; font-size:0.75rem;">+ Add Task</button>
                </div>
              </div>

              ${subjectTasks.length === 0 ? `
                <div class="ws-empty-inline">
                  <span>No tasks yet · </span>
                  <button class="btn-link" id="btn-add-subject-task-empty">+ Add Task</button>
                </div>
              ` : (hideSubjectCompleted ? sortedTasks.filter(t => t.status !== 'completed') : sortedTasks).length === 0 ? `
                <div class="ws-empty-inline">
                  <span>All study tasks completed! · </span>
                  <button class="btn-link" id="btn-add-subject-task-empty">+ Add Task</button>
                </div>
              ` : `
                <div class="ws-task-list ws-scroll-task-list">
                  ${(hideSubjectCompleted ? sortedTasks.filter(t => t.status !== 'completed') : sortedTasks).map(t => {
                    const isDone = t.status === 'completed';
                    const dlStatus = db.getTaskDeadlineStatus(t);
                    const isOverdue = dlStatus === 'overdue' && !isDone;
                    return `
                      <div class="ws-task-item ${isOverdue ? 'ws-task-overdue' : ''} ${isDone ? 'ws-task-completed' : ''}" data-task-id="${t.id}">
                        <div class="ws-task-checkbox ${isDone ? 'checked' : ''}" data-action="toggle-task" data-task-id="${t.id}" title="${isDone ? 'Mark uncompleted' : 'Mark completed'}">
                          ✓
                        </div>
                        <div class="ws-task-body">
                          <div class="ws-task-title ${isDone ? 'done' : ''}">${t.title}</div>
                          <div class="ws-task-meta-row">
                            ${isOverdue ? `<span class="badge badge-rose" style="font-size:0.6rem; padding:1px 4px;">OVERDUE</span>` : ''}
                            <span class="badge ${t.priority === 'urgent' ? 'badge-rose' : t.priority === 'high' ? 'badge-amber' : 'badge-cyan'}" style="font-size:0.6rem; padding:1px 4px;">
                              ${(t.priority || 'medium').toUpperCase()}
                            </span>
                            ${t.deadline ? `
                              <span class="ws-task-due">
                                Due: ${new Date(t.deadline).toLocaleDateString([], {month:'short', day:'numeric'})}
                              </span>
                            ` : ''}
                          </div>
                        </div>
                        <div class="ws-task-actions">
                          <button class="btn btn-secondary btn-sm" style="padding:2px 6px; font-size:0.68rem;" data-action="focus-task" data-task-id="${t.id}" title="Study">
                            ▶
                          </button>
                          <button class="btn btn-ghost btn-sm" style="padding:2px 5px; font-size:0.68rem;" data-action="edit-task" data-task-id="${t.id}" title="Edit">
                            ✏
                          </button>
                          <button class="btn btn-ghost btn-sm" style="padding:2px 5px; font-size:0.68rem; color:var(--text-muted);" data-action="delete-task" data-task-id="${t.id}" title="Delete">
                            ✕
                          </button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            </section>

            <!-- ── 3. Resources Panel (collapsed by default) ────────────────── -->
            <section class="ws-panel ws-resources-panel ws-tab-panel" id="ws-panel-resources" aria-label="Subject Resources" data-collapsed="false">
              <div class="ws-resources-panel-header" id="ws-resources-header" title="Click to expand or collapse resources">
                <div class="ws-panel-label ws-resources-title" style="margin:0;">
                  RESOURCES (${subjectResources.length}) <span class="ws-collapse-arrow" id="ws-resources-arrow">▸</span>
                </div>
                <button class="btn btn-primary btn-sm" id="btn-add-resource" style="padding:2px 8px; font-size:0.75rem;">+ Add Resource</button>
              </div>

              <div class="ws-resources-body" id="ws-resources-body">
                ${subjectResources.length === 0 ? `
                  <div class="ws-empty-inline" style="margin-top:var(--space-2);">
                    <span>No resources stored yet · </span>
                    <button class="btn-link" id="btn-add-resource-empty">+ Add Resource</button>
                  </div>
                ` : `
                  <div class="ws-resource-grid ws-resource-compact-grid">
                    ${subjectResources.map(r => {
                      const typeKey = (r.type || 'other').toLowerCase();
                      const typeLabels = {
                        module: 'Module', notes: 'Notes', reviewer: 'Reviewer',
                        pdf: 'PDF', drive: 'Drive', video: 'Video', youtube: 'YouTube',
                        website: 'Web', reference: 'Ref', other: 'Other'
                      };
                      const displayType = typeLabels[typeKey] || r.type || 'Resource';
                      const hasPdfData = typeKey === 'pdf' && (r.pdfDataUrl || r.hasPdfFile || (r.url && (r.url.toLowerCase().endsWith('.pdf') || r.url.includes('pdf'))));
                      return `
                        <div class="ws-resource-card ${activeResourceId === r.id ? 'is-active' : ''}" data-resource-id="${r.id}" role="button" tabindex="0" aria-label="Study ${escapeHtml(r.title)}">
                          <div style="display:flex; justify-content:space-between; align-items:center;">
                            <span class="ws-resource-type ws-type-${typeKey}">${typeKey === 'youtube' || typeKey === 'video' ? '▶' : typeKey === 'pdf' ? '📄' : '●'} ${displayType}</span>
                            <button class="btn btn-ghost btn-sm" style="padding:0 4px; font-size:0.7rem; color:var(--accent-rose);" data-delete-resource="${r.id}" title="Delete">✕</button>
                          </div>
                          <div class="ws-resource-title">${r.title}</div>
                          ${r.description ? `<div class="ws-resource-desc">${r.description}</div>` : ''}
                          <div class="ws-resource-footer">
                            <div style="display:flex; gap:4px; flex-wrap:wrap; align-items:center;">
                              ${hasPdfData ? `
                                <button class="ws-resource-open-pdf-btn" data-open-pdf="${r.id}" title="Open in viewer">📄 Open</button>
                              ` : ''}
                              ${r.url ? `
                                <a href="${r.url}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="padding:2px 8px; font-size:0.72rem; text-decoration:none;">
                                  Open ↗
                                </a>
                              ` : (!hasPdfData ? `<span style="font-size:0.7rem; color:var(--text-muted);">No Link</span>` : '')}
                            </div>
                            ${r.domain ? `<span style="font-size:0.68rem; color:var(--text-muted); font-family:var(--font-mono);">${r.domain}</span>` : ''}
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                `}
              </div>
            </section>

          </aside>

        </div>
      </div>
    `;

    if (activeVideo) {
      const videoId = activeVideoId;
      const error = container.querySelector('#ws-video-error');
      const showError = message => {
        if (!error) return;
        error.hidden = false;
        error.querySelector('p').textContent = message;
        container.querySelector('#ws-video-frame')?.setAttribute('hidden', '');
      };
      if (videoId || activePlaylistId) disposeVideo = mountYouTubeViewer(container.querySelector('#ws-youtube-player'), { ...activeVideo, videoId, playlistId: activePlaylistId }, showError, { previous: container.querySelector('#ws-playlist-prev'), next: container.querySelector('#ws-playlist-next'), title: container.querySelector('#ws-current-video-title') });
      else showError('This resource has an invalid YouTube URL.');
      container.querySelector('#ws-video-retry')?.addEventListener('click', render);
    }

    // ── EVENT LISTENERS ───────────────────────────────────────────────────────

    const picker = container.querySelector('#ws-resource-picker');
    const resourceContent = container.querySelector('#ws-resource-content');
    const changeResource = container.querySelector('#ws-change-resource');
    function showResourcePicker(show) {
      picker.hidden = !show;
      resourceContent.hidden = show;
      changeResource.setAttribute('aria-expanded', String(show));
      if (show) container.querySelector('#ws-choose-pdf').focus();
      else changeResource.focus();
    }
    changeResource.addEventListener('click', () => showResourcePicker(true));
    container.querySelector('#ws-resource-cancel').addEventListener('click', () => showResourcePicker(false));
    container.querySelector('#ws-choose-pdf').addEventListener('click', () => container.querySelector('#ws-resource-pdf-input').click());
    container.querySelector('#ws-resource-pdf-input').addEventListener('change', event => {
      const file = event.target.files[0];
      if (file) handlePdfFileUpload(file, currentSubject.id);
      event.target.value = '';
    });
    for (const button of container.querySelectorAll('#ws-choose-youtube, #ws-choose-playlist')) button.addEventListener('click', event => {
      container.querySelector('#ws-youtube-form').hidden = false;
      event.currentTarget.setAttribute('aria-expanded', 'true');
      container.querySelector('#ws-youtube-url').focus();
    });
    container.querySelector('#ws-youtube-form').addEventListener('submit', event => {
      event.preventDefault();
      const input = container.querySelector('#ws-youtube-url');
      const parsed = parseYouTubeResource(input.value);
      const videoId = parsed?.videoId;
      const error = container.querySelector('#ws-youtube-url-error');
      input.setAttribute('aria-invalid', String(!parsed));
      if (!parsed) {
        error.textContent = 'Enter a valid YouTube video or playlist URL.';
        error.hidden = false;
        input.focus();
        return;
      }
      const resource = db.addResource({
        title: `YouTube ${parsed.playlistId ? 'Playlist' : 'Video'} · ${parsed.playlistId || videoId}`, subjectId: currentSubject.id,
        ...parsed, category: 'Lecture', lastPlaybackPosition: 0
      });
      openResource(resource);
    });

    // Subject Dropdown
    container.querySelector('#ws-subject-dropdown')?.addEventListener('change', (e) => {
      selectedSubjectId = e.target.value;
      activeResourceId = null;
      restoredResourceId = null;
      // Reset PDF viewer when switching subjects
      if (pdfViewerState.subjectId !== selectedSubjectId) {
        pdfViewerState.pdfDoc = null;
        pdfViewerState.currentPage = 1;
        pdfViewerState.filename = '';
        pdfViewerState.subjectId = null;
      }
      render();
    });

    // New Subject
    container.querySelector('#btn-new-subject')?.addEventListener('click', () => showNewSubjectModal(render));

    // Edit Subject Info
    container.querySelector('#btn-edit-subject')?.addEventListener('click', () => showEditSubjectInfoModal(currentSubject, render));

    // Add Resource
    const openAddResource = () => showAddResourceModal(currentSubject.id, render);
    container.querySelector('#btn-add-resource')?.addEventListener('click', openAddResource);
    container.querySelector('#btn-add-resource-empty')?.addEventListener('click', openAddResource);

    // Delete Resource
    container.querySelectorAll('[data-delete-resource]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const resId = e.currentTarget.getAttribute('data-delete-resource');
        if (confirm('Remove this resource from the subject workspace?')) {
          await deletePdfFromStorage(resId);
          db.deleteResource(resId);
          if (activeResourceId === resId) activeResourceId = null;
          render();
        }
      });
    });

    async function openResource(resource) {
      if (!resource || selectedSubjectId !== currentSubject.id) return;
      // Save the outgoing video's position before recording the new resource.
      disposeVideo?.();
      disposeVideo = null;
      activeResourceId = resource.id;
      db.recordStudyActivity({ type: resource.type === 'youtube' ? 'youtube_watch' : 'resource_open', subjectId: currentSubject.id, subjectCode: currentSubject.code, resourceId: resource.id, pdfFilename: resource.type === 'pdf' ? resource.title : null });
      if (resource.type === 'youtube' || resourceVideoId(resource) || parseYouTubeResource(resource.url || '')?.playlistId) {
        render();
        return;
      }
      if (resource.type !== 'pdf') {
        if (resource.url) window.open(resource.url, '_blank', 'noopener,noreferrer');
        return;
      }
      const generation = viewGeneration;
      const storedBlob = await getPdfFromStorage(resource.id);
      if (generation !== viewGeneration || activeResourceId !== resource.id) return;
      if (storedBlob) await loadPdfDocument(storedBlob, resource.title || 'Document', currentSubject.id);
      else if (resource.pdfDataUrl) await loadPdfDocument(resource.pdfDataUrl, resource.title || 'Document', currentSubject.id);
      else if (resource.url) await loadPdfDocument(resource.url, resource.title || 'Document', currentSubject.id);
      else window.showToast?.('No PDF document data found for this resource.');
    }

    container.querySelectorAll('.ws-resource-card').forEach(card => {
      const activate = () => openResource(subjectResources.find(r => r.id === card.dataset.resourceId));
      card.addEventListener('click', event => { if (!event.target.closest('a,button')) activate(); });
      card.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } });
    });

    // Open PDF Resource in Viewer
    container.querySelectorAll('[data-open-pdf]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const resId = e.currentTarget.getAttribute('data-open-pdf');
        await openResource((db.getResources() || []).find(r => r.id === resId));
      });
    });

    // Add Task
    const openAddTask = () => showCreateTaskModal(render, currentSubject.id);
    container.querySelector('#btn-add-subject-task')?.addEventListener('click', openAddTask);
    container.querySelector('#btn-add-subject-task-empty')?.addEventListener('click', openAddTask);

    // Toggle Hide Done Tasks
    container.querySelector('#ws-toggle-hide-done')?.addEventListener('change', (e) => {
      hideSubjectCompleted = e.target.checked;
      render();
    });

    // Clear Done Tasks for this subject
    container.querySelector('#btn-clear-subject-done')?.addEventListener('click', () => {
      if (confirm(`Remove ${completedTasks.length} completed task(s) from ${currentSubject.code}?`)) {
        completedTasks.forEach(t => db.deleteTask(t.id));
        window.showToast?.(`Cleared ${completedTasks.length} completed task(s).`);
        render();
      }
    });

    // Task Checkbox Toggle
    container.querySelectorAll('[data-action="toggle-task"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tId = e.currentTarget.getAttribute('data-task-id');
        const task = db.getTaskById(tId);
        if (task) {
          const next = task.status === 'completed' ? 'not_started' : 'completed';
          db.updateTask(tId, { status: next, completedAt: next === 'completed' ? new Date().toISOString() : null });
          if (next === 'completed') {
            window.showToast?.('Task completed!' + (hideSubjectCompleted ? ' Removed from view.' : ''));
          }
          render();
        }
      });
    });

    // Edit Task
    container.querySelectorAll('[data-action="edit-task"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tId = e.currentTarget.getAttribute('data-task-id');
        const task = db.getTaskById(tId);
        if (task) {
          showEditTaskModal(task, render);
        }
      });
    });

    // Delete Task / Remove from list
    container.querySelectorAll('[data-action="delete-task"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tId = e.currentTarget.getAttribute('data-task-id');
        const task = db.getTaskById(tId);
        if (task) {
          if (task.status === 'completed' || confirm(`Remove task "${task.title}"?`)) {
            db.deleteTask(tId);
            window.showToast?.('Task removed from list.');
            render();
          }
        }
      });
    });

    // Task "▶ Study" Button — attach task to focus cockpit
    container.querySelectorAll('[data-action="focus-task"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tId = e.currentTarget.getAttribute('data-task-id');
        const task = db.getTaskById(tId);
        if (task) {
          timer.setContext(currentSubject.id, null, task.id);
          updateFocusDisplay();
          // Scroll to focus cockpit
          container.querySelector('#ws-focus-cockpit')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    });

    function updateFocusDisplay() {
      const timerText = container.querySelector('#ws-focus-timer-text');
      const startPauseBtn = container.querySelector('#ws-btn-start-pause');
      const progressFill = container.querySelector('#ws-focus-progress-fill');
      const badge = container.querySelector('#ws-focus-sub-badge');

      if (timerText) {
        timerText.textContent = timer.formatTime();
        if (timer.state === 'running') {
          timerText.classList.add('running');
        } else {
          timerText.classList.remove('running');
        }
      }
      if (progressFill) {
        progressFill.style.width = `${timer.getProgress()}%`;
      }
      if (badge) {
        badge.textContent = (timer.state === 'running' && timer.selectedSubjectId === currentSubject?.id)
          ? '🔴 FOCUS ACTIVE'
          : 'READY';
      }
      if (startPauseBtn) {
        if (timer.state === 'running') {
          startPauseBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            PAUSE
          `;
          startPauseBtn.className = 'btn btn-secondary btn-timer-primary';
        } else {
          startPauseBtn.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            ${timer.state === 'paused' ? 'RESUME' : 'START'}
          `;
          startPauseBtn.className = 'btn btn-primary btn-timer-primary';
        }
      }
    }

    // ── FOCUS COCKPIT EVENT LISTENERS ─────────────────────────────────────────

    // Duration Presets
    container.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        const mins = parseInt(e.currentTarget.getAttribute('data-mins'), 10);
        timer.setDuration(mins);
        // Update active chip styling without full re-render
        container.querySelectorAll('.preset-chip').forEach(c => c.classList.remove('active'));
        e.currentTarget.classList.add('active');
        updateFocusDisplay();
      });
    });

    // Task Picker (filtered to this subject)
    container.querySelector('#ws-focus-task-picker')?.addEventListener('change', (e) => {
      const taskId = e.target.value;
      if (taskId) {
        const t = db.getTaskById(taskId);
        if (t) {
          timer.setContext(currentSubject.id, null, t.id);
          render(); // re-render to show subtask checklist if needed
        }
      } else {
        timer.setContext(currentSubject.id, null, null);
        render();
      }
    });

    // Subtask Toggle
    container.querySelectorAll('[data-action="ws-toggle-subtask"]').forEach(box => {
      box.addEventListener('change', (e) => {
        const stId = e.target.getAttribute('data-st-id');
        const task = timer.selectedTaskId ? db.getTaskById(timer.selectedTaskId) : null;
        if (task && task.subtasks) {
          const st = task.subtasks.find(s => s.id === stId);
          if (st) {
            st.completed = e.target.checked;
            db.updateTask(task.id, { subtasks: task.subtasks });
            render();
          }
        }
      });
    });

    // Start / Pause — with Resistance Check on pause
    container.querySelector('#ws-btn-start-pause')?.addEventListener('click', () => {
      if (timer.state === 'running') {
        showResistanceModal(() => {
          timer.pause();
          updateFocusDisplay();
        });
      } else {
        timer.setContext(currentSubject.id, null, timer.selectedTaskId || null);
        timer.start();
        updateFocusDisplay();
      }
    });

    // Finish Session
    container.querySelector('#ws-btn-finish-session')?.addEventListener('click', () => {
      if (timer.state === 'running' || timer.state === 'paused') {
        const elapsedMins = timer.stopEarly();
        window.focusApp.showSessionCompletionModal({
          durationMinutes: elapsedMins,
          subjectId: currentSubject.id,
          topicId: timer.selectedTopicId,
          taskId: timer.selectedTaskId,
          startTime: timer.startTime || new Date().toISOString(),
          endTime: new Date().toISOString()
        });
      } else {
        timer.reset();
        updateFocusDisplay();
      }
    });

    // Ambient Sound Select Dropdown & Legacy Buttons
    container.querySelector('#ws-sound-select')?.addEventListener('change', (e) => {
      const sound = e.target.value;
      timer.setAmbientSound(sound);
    });

    container.querySelectorAll('.sound-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sound = e.currentTarget.getAttribute('data-sound');
        timer.setAmbientSound(sound);
        container.querySelectorAll('.sound-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const sel = container.querySelector('#ws-sound-select');
        if (sel) sel.value = sound;
      });
    });

    // Fullscreen Focus Mode Toggle (collapses timer into a slim one-line bar)
    container.querySelector('#ws-btn-toggle-fullscreen')?.addEventListener('click', () => {
      isFullscreen = !isFullscreen;
      const layout = container.querySelector('#ws-reader-layout');
      const cockpit = container.querySelector('#ws-focus-cockpit');
      if (layout) layout.classList.toggle('ws-focus-fullscreen', isFullscreen);
      if (cockpit) cockpit.classList.toggle('fullscreen', isFullscreen);
      const btn = container.querySelector('#ws-btn-toggle-fullscreen');
      if (btn) btn.textContent = isFullscreen ? '✕ Exit' : '⛶ Fullscreen';
      setTimeout(async () => {
        if (pdfIsOpen) {
          if (pdfViewerState.fitMode === 'width') await applyFitWidth();
          else if (pdfViewerState.fitMode === 'page') await applyFitPage();
        }
      }, 80);
    });

    // Sidebar Toggle Button & Keyboard Shortcut (\)
    const toggleSidebar = () => {
      const layout = container.querySelector('#ws-reader-layout');
      if (!layout) return;
      const isHidden = layout.classList.toggle('ws-sidebar-hidden');
      localStorage.setItem('axiom_reader_sidebar_hidden', isHidden ? '1' : '0');
      const btn = container.querySelector('#ws-btn-toggle-sidebar');
      if (btn) btn.classList.toggle('active', isHidden);
      setTimeout(async () => {
        if (pdfIsOpen) {
          if (pdfViewerState.fitMode === 'width') await applyFitWidth();
          else if (pdfViewerState.fitMode === 'page') await applyFitPage();
        }
      }, 80);
    };

    container.querySelector('#ws-btn-toggle-sidebar')?.addEventListener('click', toggleSidebar);

    // Restore saved sidebar toggle state
    if (localStorage.getItem('axiom_reader_sidebar_hidden') === '1') {
      container.querySelector('#ws-reader-layout')?.classList.add('ws-sidebar-hidden');
      container.querySelector('#ws-btn-toggle-sidebar')?.classList.add('active');
    }

    // Keyboard shortcut: "\" to toggle sidebar
    sidebarKeyHandler = (e) => {
      if (e.key === '\\' && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const tag = (document.activeElement?.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable) {
          return;
        }
        e.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener('keydown', sidebarKeyHandler);

    // Draggable Divider between Reader and Sidebar
    const divider = container.querySelector('#ws-divider');
    const readerLayout = container.querySelector('#ws-reader-layout');
    const savedSidebarWidth = localStorage.getItem('axiom_reader_sidebar_width');
    if (savedSidebarWidth && readerLayout) {
      readerLayout.style.setProperty('--ws-sidebar-width', savedSidebarWidth);
    }

    if (divider && readerLayout) {
      divider.addEventListener('mousedown', (e) => {
        e.preventDefault();
        divider.classList.add('dragging');
        const startX = e.clientX;
        const sidebar = container.querySelector('#ws-sidebar');
        const startWidth = sidebar ? sidebar.getBoundingClientRect().width : 340;

        dividerMouseMoveHandler = (ev) => {
          const dx = startX - ev.clientX; // moving left increases sidebar width
          const minW = 280;
          const maxW = Math.min(520, window.innerWidth * 0.55);
          const newWidth = Math.max(minW, Math.min(maxW, Math.round(startWidth + dx)));
          readerLayout.style.setProperty('--ws-sidebar-width', `${newWidth}px`);
        };

        dividerMouseUpHandler = () => {
          divider.classList.remove('dragging');
          if (dividerMouseMoveHandler) {
            window.removeEventListener('mousemove', dividerMouseMoveHandler);
            dividerMouseMoveHandler = null;
          }
          if (dividerMouseUpHandler) {
            window.removeEventListener('mouseup', dividerMouseUpHandler);
            dividerMouseUpHandler = null;
          }
          const finalWidth = readerLayout.style.getPropertyValue('--ws-sidebar-width');
          if (finalWidth) {
            localStorage.setItem('axiom_reader_sidebar_width', finalWidth);
          }
          setTimeout(async () => {
            if (pdfIsOpen) {
              if (pdfViewerState.fitMode === 'width') await applyFitWidth();
              else if (pdfViewerState.fitMode === 'page') await applyFitPage();
            }
          }, 40);
        };

        window.addEventListener('mousemove', dividerMouseMoveHandler);
        window.addEventListener('mouseup', dividerMouseUpHandler);
      });

      divider.addEventListener('dblclick', () => {
        readerLayout.style.setProperty('--ws-sidebar-width', '340px');
        localStorage.setItem('axiom_reader_sidebar_width', '340px');
        setTimeout(async () => {
          if (pdfIsOpen) {
            if (pdfViewerState.fitMode === 'width') await applyFitWidth();
            else if (pdfViewerState.fitMode === 'page') await applyFitPage();
          }
        }, 40);
      });
    }

    // Resources Header Collapsible Toggle
    container.querySelector('#ws-resources-header')?.addEventListener('click', (e) => {
      if (e.target.closest('#btn-add-resource')) return;
      const panel = container.querySelector('#ws-panel-resources');
      if (!panel) return;
      const isCollapsed = panel.getAttribute('data-collapsed') === 'true';
      panel.setAttribute('data-collapsed', isCollapsed ? 'false' : 'true');
      const arrow = container.querySelector('#ws-resources-arrow');
      if (arrow) arrow.textContent = isCollapsed ? '▾' : '▸';
    });

    // Mobile Tabs (Timer | Tasks | Resources) for screens under 900px
    container.querySelectorAll('.ws-mobile-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const target = e.currentTarget.getAttribute('data-tab');
        container.querySelectorAll('.ws-mobile-tab').forEach(t => t.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const sidebar = container.querySelector('#ws-sidebar');
        if (sidebar) {
          sidebar.setAttribute('data-active-tab', target);
        }
      });
    });

    // Hide Motivation Banner
    container.querySelector('#ws-btn-hide-motivation')?.addEventListener('click', () => {
      showMotivation = false;
      const banner = container.querySelector('#ws-motivation-banner');
      if (banner) banner.style.display = 'none';
    });

    // ── PDF VIEWER EVENT LISTENERS & HELPERS ─────────────────────────

    // Local Storage reading progress and bookmark keys
    function getDocKey() {
      return pdfViewerState.filename || '__unnamed_doc__';
    }

    function saveReadingProgress() {
      try {
        const key = getDocKey();
        const stored = (db.data.pdfProgress || {});
        stored[key] = {
          page: pdfViewerState.currentPage,
          scale: pdfViewerState.scale,
          fitMode: pdfViewerState.fitMode,
          updatedAt: Date.now()
        };
        db.data.pdfProgress = stored;
        db.save();
        if (currentSubject) {
          db.recordStudyActivity({
            type: 'pdf_read',
            subjectId: currentSubject.id,
            subjectCode: currentSubject.code,
            pdfFilename: pdfViewerState.filename,
            resourceId: activeResourceId,
            page: pdfViewerState.currentPage,
            scale: pdfViewerState.scale
          });
        }
      } catch (_) {}
    }

    function loadReadingProgress() {
      try {
        const key = getDocKey();
        const stored = (db.data.pdfProgress || {});
        return stored[key] || null;
      } catch (_) { return null; }
    }

    function getDocBookmarks() {
      try {
        const key = getDocKey();
        const stored = (db.data.pdfBookmarks || {});
        return stored[key] || [];
      } catch (_) { return []; }
    }

    function toggleBookmarkCurrentPage() {
      try {
        const key = getDocKey();
        const stored = (db.data.pdfBookmarks || {});
        const list = stored[key] || [];
        const cur = pdfViewerState.currentPage;
        const idx = list.indexOf(cur);
        if (idx >= 0) {
          list.splice(idx, 1);
          window.showToast?.(`Removed bookmark for page ${cur}`);
        } else {
          list.push(cur);
          list.sort((a, b) => a - b);
          window.showToast?.(`🔖 Bookmarked page ${cur}`);
        }
        stored[key] = list;
        db.data.pdfBookmarks = stored;
        db.save();
        updateBookmarkUI();
      } catch (_) {}
    }

    function updateBookmarkUI() {
      const bBtn = container.querySelector('#ws-pdf-bookmark-btn');
      const bInd = container.querySelector('#ws-pdf-bookmark-indicator');
      const bookmarks = getDocBookmarks();
      const isCurBookmarked = bookmarks.includes(pdfViewerState.currentPage);

      if (bBtn) {
        bBtn.classList.toggle('active', isCurBookmarked);
        bBtn.style.color = isCurBookmarked ? 'var(--accent-amber)' : '';
      }
      if (bInd) {
        bInd.textContent = bookmarks.length > 0 ? `🔖 Bookmarks: p.${bookmarks.join(', p.')}` : '';
      }
    }

    // File input handlers
    container.querySelector('#ws-pdf-file-input')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handlePdfFileUpload(file, currentSubject.id);
    });
    container.querySelector('#ws-pdf-file-input-empty')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handlePdfFileUpload(file, currentSubject.id);
    });

    // Close PDF
    container.querySelector('#ws-pdf-close-btn')?.addEventListener('click', () => {
      activeResourceId = '__none__';
      if (pdfViewerState.activeRenderTask) {
        try { pdfViewerState.activeRenderTask.cancel(); } catch(_) {}
        pdfViewerState.activeRenderTask = null;
      }
      if (pdfViewerState.activeBlobUrl) {
        try { URL.revokeObjectURL(pdfViewerState.activeBlobUrl); } catch (_) {}
        pdfViewerState.activeBlobUrl = null;
      }
      if (thumbObserver) {
        thumbObserver.disconnect();
        thumbObserver = null;
      }
      pdfViewerState.pdfDoc = null;
      pdfViewerState.currentPage = 1;
      pdfViewerState.scale = 1.0;
      pdfViewerState.filename = '';
      pdfViewerState.subjectId = null;
      pdfViewerState.searchResults = [];
      pdfViewerState.searchQuery = '';
      pdfViewerState.thumbsOpen = false;
      render();
    });

    // Error retry button
    container.querySelector('#ws-pdf-error-retry-btn')?.addEventListener('click', () => {
      hidePdfError();
      renderCurrentPdfPage();
    });

    // Page navigation
    container.querySelector('#ws-pdf-prev-btn')?.addEventListener('click', () => {
      if (pdfViewerState.currentPage > 1) {
        pdfViewerState.currentPage--;
        renderCurrentPdfPage();
        syncPdfToolbar();
        updateThumbnailActive();
      }
    });

    container.querySelector('#ws-pdf-next-btn')?.addEventListener('click', () => {
      if (pdfViewerState.pdfDoc && pdfViewerState.currentPage < pdfViewerState.pdfDoc.numPages) {
        pdfViewerState.currentPage++;
        renderCurrentPdfPage();
        syncPdfToolbar();
        updateThumbnailActive();
      }
    });

    container.querySelector('#ws-pdf-page-num')?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10);
      if (pdfViewerState.pdfDoc && val >= 1 && val <= pdfViewerState.pdfDoc.numPages) {
        pdfViewerState.currentPage = val;
        renderCurrentPdfPage();
        syncPdfToolbar();
        updateThumbnailActive();
      } else {
        e.target.value = pdfViewerState.currentPage;
      }
    });

    // Zoom controls
    container.querySelector('#ws-pdf-zoom-in-btn')?.addEventListener('click', () => {
      pdfViewerState.scale = Math.min(5.0, parseFloat((pdfViewerState.scale + 0.25).toFixed(2)));
      pdfViewerState.fitMode = 'free';
      renderCurrentPdfPage();
      syncPdfToolbar();
    });

    container.querySelector('#ws-pdf-zoom-out-btn')?.addEventListener('click', () => {
      pdfViewerState.scale = Math.max(0.25, parseFloat((pdfViewerState.scale - 0.25).toFixed(2)));
      pdfViewerState.fitMode = 'free';
      renderCurrentPdfPage();
      syncPdfToolbar();
    });

    container.querySelector('#ws-pdf-reset-zoom-btn')?.addEventListener('click', () => {
      pdfViewerState.scale = 1.0;
      pdfViewerState.fitMode = 'free';
      renderCurrentPdfPage();
      syncPdfToolbar();
    });

    container.querySelector('#ws-pdf-fit-width-btn')?.addEventListener('click', async () => {
      await applyFitWidth();
    });

    container.querySelector('#ws-pdf-fit-page-btn')?.addEventListener('click', async () => {
      await applyFitPage();
    });

    // Fullscreen toggle
    container.querySelector('#ws-pdf-fullscreen-btn')?.addEventListener('click', () => {
      const panel = container.querySelector('#ws-pdf-viewer-section');
      const btn = container.querySelector('#ws-pdf-fullscreen-btn');
      if (panel) {
        panel.classList.toggle('fullscreen');
        const isFs = panel.classList.contains('fullscreen');
        if (btn) btn.textContent = isFs ? '✕ Exit' : '⛶';
        setTimeout(async () => {
          if (pdfViewerState.fitMode === 'width') await applyFitWidth();
          else if (pdfViewerState.fitMode === 'page') await applyFitPage();
          else renderCurrentPdfPage();
        }, 60);
      }
    });

    // Toggle Thumbnail Sidebar
    container.querySelector('#ws-pdf-thumbs-btn')?.addEventListener('click', () => {
      const sidebar = container.querySelector('#ws-pdf-thumbs-sidebar');
      const btn = container.querySelector('#ws-pdf-thumbs-btn');
      if (!sidebar) return;
      const isOpen = sidebar.style.display !== 'none';
      sidebar.style.display = isOpen ? 'none' : 'flex';
      pdfViewerState.thumbsOpen = !isOpen;
      if (btn) btn.classList.toggle('active', !isOpen);

      if (!isOpen && !container.querySelector('#ws-pdf-thumbs-list')?.children.length) {
        generateThumbnails();
      }
    });

    // Bookmark button
    container.querySelector('#ws-pdf-bookmark-btn')?.addEventListener('click', () => {
      toggleBookmarkCurrentPage();
    });

    // Search Toggle & Actions
    function toggleSearch(show) {
      const bar = container.querySelector('#ws-pdf-search-bar');
      const btn = container.querySelector('#ws-pdf-search-toggle-btn');
      if (!bar) return;
      const currentlyShown = bar.style.display !== 'none';
      const shouldShow = show !== undefined ? show : !currentlyShown;
      bar.style.display = shouldShow ? 'flex' : 'none';
      if (btn) btn.classList.toggle('active', shouldShow);
      if (shouldShow) {
        setTimeout(() => container.querySelector('#ws-pdf-search-input')?.focus(), 50);
      }
    }

    container.querySelector('#ws-pdf-search-toggle-btn')?.addEventListener('click', () => {
      toggleSearch();
    });
    container.querySelector('#ws-pdf-search-close-btn')?.addEventListener('click', () => {
      toggleSearch(false);
    });

    const searchInput = container.querySelector('#ws-pdf-search-input');
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const q = searchInput.value.trim();
          if (q) performSearch(q);
        }
      });
    }

    container.querySelector('#ws-pdf-search-prev-btn')?.addEventListener('click', () => {
      navigateToSearchResult(pdfViewerState.searchIndex - 1);
    });
    container.querySelector('#ws-pdf-search-next-btn')?.addEventListener('click', () => {
      navigateToSearchResult(pdfViewerState.searchIndex + 1);
    });

    async function performSearch(query) {
      if (!pdfViewerState.pdfDoc || !query) return;
      const searchSeq = ++pdfViewerState.searchSequence;
      pdfViewerState.searchQuery = query;
      pdfViewerState.searchResults = [];
      pdfViewerState.searchIndex = 0;
      const countEl = container.querySelector('#ws-pdf-search-count');
      if (countEl) countEl.textContent = 'Searching...';

      const numPages = pdfViewerState.pdfDoc.numPages;
      let pagesWithText = 0;
      let firstMatchFound = false;

      for (let i = 1; i <= numPages; i++) {
        if (searchSeq !== pdfViewerState.searchSequence) return;
        try {
          const page = await pdfViewerState.pdfDoc.getPage(i);
          const textContent = await page.getTextContent();
          if (textContent && textContent.items.length > 0) pagesWithText++;
          const pageStr = textContent.items.map(it => it.str).join(' ');
          if (pageStr.toLowerCase().includes(query.toLowerCase())) {
            pdfViewerState.searchResults.push(i);
            if (!firstMatchFound) {
              firstMatchFound = true;
              navigateToSearchResult(0);
            }
          }
        } catch (_) {}

        // Cooperative yield every 5 pages to keep UI responsive on large files
        if (i % 5 === 0) {
          if (countEl && searchSeq === pdfViewerState.searchSequence) {
            countEl.textContent = `${pdfViewerState.searchResults.length} found (p.${i}/${numPages})...`;
          }
          await new Promise(r => setTimeout(r, 0));
        }
      }

      if (searchSeq !== pdfViewerState.searchSequence) return;

      if (pagesWithText === 0) {
        window.showToast?.('This document appears to be scanned images without searchable text.');
      }

      updateSearchCount();
      if (!firstMatchFound && pdfViewerState.searchResults.length > 0) {
        navigateToSearchResult(0);
      }
    }

    function navigateToSearchResult(idx) {
      if (!pdfViewerState.searchResults.length) return;
      idx = Math.max(0, Math.min(idx, pdfViewerState.searchResults.length - 1));
      pdfViewerState.searchIndex = idx;
      pdfViewerState.currentPage = pdfViewerState.searchResults[idx];
      renderCurrentPdfPage();
      syncPdfToolbar();
      updateThumbnailActive();
      updateSearchCount();
    }

    function updateSearchCount() {
      const countEl = container.querySelector('#ws-pdf-search-count');
      if (!countEl) return;
      if (!pdfViewerState.searchQuery) { countEl.textContent = ''; return; }
      if (pdfViewerState.searchResults.length === 0) {
        countEl.textContent = '0 matches';
      } else {
        countEl.textContent = `${pdfViewerState.searchIndex + 1} of ${pdfViewerState.searchResults.length}`;
      }
    }

    // ── Mouse & Touch Viewport Interactions ───────────────────────────
    const pdfViewport = container.querySelector('#ws-pdf-viewport');
    if (pdfViewport) {
      let isPanning = false;
      let panStartX = 0;
      let panStartY = 0;
      let panScrollLeft = 0;
      let panScrollTop = 0;

      const startPan = (clientX, clientY) => {
        isPanning = true;
        panStartX = clientX;
        panStartY = clientY;
        panScrollLeft = pdfViewport.scrollLeft;
        panScrollTop = pdfViewport.scrollTop;
        pdfViewport.classList.add('is-dragging');
      };

      const endPan = () => {
        if (isPanning) {
          isPanning = false;
          pdfViewport.classList.remove('is-dragging');
        }
      };

      // Mousedown: Middle mouse (1) OR Space + Left click (0) initiates panning
      pdfViewport.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        if (e.button === 1) { // Middle click
          e.preventDefault();
          startPan(e.clientX, e.clientY);
        } else if (e.button === 0 && pdfViewerState.spaceDown) { // Space + Left drag
          e.preventDefault();
          startPan(e.clientX, e.clientY);
        }
      });

      const handleMouseMove = (e) => {
        if (!isPanning) return;
        e.preventDefault();
        const deltaX = e.clientX - panStartX;
        const deltaY = e.clientY - panStartY;
        pdfViewport.scrollLeft = panScrollLeft - deltaX;
        pdfViewport.scrollTop = panScrollTop - deltaY;
      };

      const handleMouseUp = () => {
        endPan();
      };

      mouseMoveHandler = handleMouseMove;
      mouseUpHandler = handleMouseUp;
      window.addEventListener('mousemove', mouseMoveHandler);
      window.addEventListener('mouseup', mouseUpHandler);
      window.addEventListener('blur', () => {
        endPan();
        pdfViewerState.spaceDown = false;
        if (pdfViewport) pdfViewport.style.cursor = 'default';
      });

      // Touch drag (single finger pan on touch devices)
      let touchStartX = 0, touchStartY = 0, touchScrollLeft = 0, touchScrollTop = 0;
      pdfViewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          touchStartX = e.touches[0].clientX;
          touchStartY = e.touches[0].clientY;
          touchScrollLeft = pdfViewport.scrollLeft;
          touchScrollTop = pdfViewport.scrollTop;
        }
      }, { passive: true });

      pdfViewport.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1) {
          const deltaX = e.touches[0].clientX - touchStartX;
          const deltaY = e.touches[0].clientY - touchStartY;
          pdfViewport.scrollLeft = touchScrollLeft - deltaX;
          pdfViewport.scrollTop = touchScrollTop - deltaY;
        }
      }, { passive: true });

      // Ctrl + Wheel = Anchor zoom to cursor; Normal wheel = native vertical scroll
      let wheelZoomTimer = null;
      pdfViewport.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey)) return; // Allow natural scroll through document!
        e.preventDefault();

        const oldScale = pdfViewerState.scale;
        const zoomStep = e.deltaY < 0 ? 0.15 : -0.15;
        const newScale = Math.max(0.25, Math.min(5.0, parseFloat((oldScale + zoomStep).toFixed(2))));
        if (newScale === oldScale) return;

        // Position of cursor in content coordinates before zoom
        const vpRect = pdfViewport.getBoundingClientRect();
        const cursorContentX = (e.clientX - vpRect.left) + pdfViewport.scrollLeft;
        const cursorContentY = (e.clientY - vpRect.top) + pdfViewport.scrollTop;

        pdfViewerState.scale = newScale;
        pdfViewerState.fitMode = 'free';

        // Immediately update zoom label in toolbar
        syncPdfToolbar();

        // Debounce render to allow smooth continuous wheeling on large documents
        if (wheelZoomTimer) clearTimeout(wheelZoomTimer);
        wheelZoomTimer = setTimeout(async () => {
          await renderCurrentPdfPage();
          // Adjust scroll position to keep point under cursor invariant
          const ratio = newScale / oldScale;
          pdfViewport.scrollLeft = cursorContentX * ratio - (e.clientX - vpRect.left);
          pdfViewport.scrollTop = cursorContentY * ratio - (e.clientY - vpRect.top);
          syncPdfToolbar();
        }, 75);
      }, { passive: false });

      // Double Click Zoom: toggle 2.0x / Fit Width
      pdfViewport.addEventListener('dblclick', async (e) => {
        if (e.target.closest('button, input, select, a, label')) return;
        if (!pdfViewerState.pdfDoc) return;

        if (pdfViewerState.scale >= 1.75) {
          await applyFitWidth();
        } else {
          const oldScale = pdfViewerState.scale;
          const newScale = Math.min(5.0, parseFloat((oldScale * 2).toFixed(2)));
          const vpRect = pdfViewport.getBoundingClientRect();
          const cursorContentX = (e.clientX - vpRect.left) + pdfViewport.scrollLeft;
          const cursorContentY = (e.clientY - vpRect.top) + pdfViewport.scrollTop;

          pdfViewerState.scale = newScale;
          pdfViewerState.fitMode = 'free';

          await renderCurrentPdfPage();
          const ratio = newScale / oldScale;
          pdfViewport.scrollLeft = cursorContentX * ratio - (e.clientX - vpRect.left);
          pdfViewport.scrollTop = cursorContentY * ratio - (e.clientY - vpRect.top);
          syncPdfToolbar();
        }
      });
    }

    // ── Global Document Keyboard Shortcuts ───────────────────────────
    pdfKeyHandler = (e) => {
      if (activeVideo || !picker.hidden) return;
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select'].includes(activeTag) || document.activeElement?.isContentEditable) {
        return; // Don't intercept while typing in forms
      }
      if (!pdfViewerState.pdfDoc) return;

      // Space key for panning
      if (e.key === ' ' || e.code === 'Space') {
        pdfViewerState.spaceDown = true;
        const vp = container.querySelector('#ws-pdf-viewport');
        if (vp && !vp.classList.contains('is-dragging')) {
          vp.style.cursor = 'grab';
        }
        e.preventDefault();
        return;
      }

      // Escape: Exit fullscreen or dismiss search
      if (e.key === 'Escape') {
        const panel = container.querySelector('#ws-pdf-viewer-section');
        const searchBar = container.querySelector('#ws-pdf-search-bar');
        if (panel?.classList.contains('fullscreen')) {
          panel.classList.remove('fullscreen');
          const btn = container.querySelector('#ws-pdf-fullscreen-btn');
          if (btn) btn.textContent = '⛶';
        } else if (searchBar && searchBar.style.display !== 'none') {
          toggleSearch(false);
        }
        return;
      }

      // Ctrl + F: Search within document
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        toggleSearch(true);
        return;
      }

      // Zoom keys
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        pdfViewerState.scale = Math.min(5.0, parseFloat((pdfViewerState.scale + 0.25).toFixed(2)));
        pdfViewerState.fitMode = 'free';
        renderCurrentPdfPage();
        syncPdfToolbar();
        return;
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        pdfViewerState.scale = Math.max(0.25, parseFloat((pdfViewerState.scale - 0.25).toFixed(2)));
        pdfViewerState.fitMode = 'free';
        renderCurrentPdfPage();
        syncPdfToolbar();
        return;
      }
      if (e.key === '0') {
        e.preventDefault();
        pdfViewerState.scale = 1.0;
        pdfViewerState.fitMode = 'free';
        renderCurrentPdfPage();
        syncPdfToolbar();
        return;
      }

      // Page navigation keys
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        if (pdfViewerState.currentPage > 1) {
          pdfViewerState.currentPage--;
          renderCurrentPdfPage();
          syncPdfToolbar();
          updateThumbnailActive();
        }
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        if (pdfViewerState.pdfDoc && pdfViewerState.currentPage < pdfViewerState.pdfDoc.numPages) {
          pdfViewerState.currentPage++;
          renderCurrentPdfPage();
          syncPdfToolbar();
          updateThumbnailActive();
        }
        return;
      }

      // W for Fit Width, P for Fit Page, T for Thumbnails
      if (e.key === 'w' || e.key === 'W') {
        applyFitWidth();
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        applyFitPage();
        return;
      }
      if (e.key === 't' || e.key === 'T') {
        container.querySelector('#ws-pdf-thumbs-btn')?.click();
        return;
      }
    };
    document.addEventListener('keydown', pdfKeyHandler);

    pdfKeyUpHandler = (e) => {
      if (e.key === ' ' || e.code === 'Space') {
        pdfViewerState.spaceDown = false;
        const vp = container.querySelector('#ws-pdf-viewport');
        if (vp && !vp.classList.contains('is-dragging')) {
          vp.style.cursor = 'default';
        }
      }
    };
    document.addEventListener('keyup', pdfKeyUpHandler);

    // ── PDF VIEWER HELPERS ───────────────────────────────────────────

    function syncPdfToolbar() {
      const pageNum = container.querySelector('#ws-pdf-page-num');
      const prevBtn = container.querySelector('#ws-pdf-prev-btn');
      const nextBtn = container.querySelector('#ws-pdf-next-btn');
      const zoomLabel = container.querySelector('#ws-pdf-zoom-label');
      const fitWBtn = container.querySelector('#ws-pdf-fit-width-btn');
      const fitPBtn = container.querySelector('#ws-pdf-fit-page-btn');

      if (pageNum) pageNum.value = pdfViewerState.currentPage;
      if (prevBtn) prevBtn.disabled = pdfViewerState.currentPage <= 1;
      if (nextBtn) nextBtn.disabled = !pdfViewerState.pdfDoc || pdfViewerState.currentPage >= pdfViewerState.pdfDoc.numPages;
      if (zoomLabel) zoomLabel.textContent = `${Math.round(pdfViewerState.scale * 100)}%`;
      if (fitWBtn) fitWBtn.classList.toggle('active', pdfViewerState.fitMode === 'width');
      if (fitPBtn) fitPBtn.classList.toggle('active', pdfViewerState.fitMode === 'page');

      updateBookmarkUI();
    }

    function showPdfLoading(show) {
      const el = container.querySelector('#ws-pdf-loading');
      if (el) el.style.display = show ? 'flex' : 'none';
    }

    function showPdfError(msg) {
      const overlay = container.querySelector('#ws-pdf-error-overlay');
      const text = container.querySelector('#ws-pdf-error-text');
      if (overlay && text) {
        text.textContent = msg;
        overlay.style.display = 'flex';
      }
    }

    function hidePdfError() {
      const overlay = container.querySelector('#ws-pdf-error-overlay');
      if (overlay) overlay.style.display = 'none';
    }

    async function applyFitWidth() {
      if (!pdfViewerState.pdfDoc) return;
      try {
        const page = await pdfViewerState.pdfDoc.getPage(pdfViewerState.currentPage);
        const viewport = page.getViewport({ scale: 1 });
        const vpEl = container.querySelector('#ws-pdf-viewport');
        if (vpEl) {
          const availWidth = vpEl.clientWidth - 48;
          pdfViewerState.scale = Math.max(0.2, parseFloat((availWidth / viewport.width).toFixed(2)));
          pdfViewerState.fitMode = 'width';
          await renderCurrentPdfPage();
          syncPdfToolbar();
        }
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('applyFitWidth error:', err);
        }
      }
    }

    async function applyFitPage() {
      if (!pdfViewerState.pdfDoc) return;
      try {
        const page = await pdfViewerState.pdfDoc.getPage(pdfViewerState.currentPage);
        const viewport = page.getViewport({ scale: 1 });
        const vpEl = container.querySelector('#ws-pdf-viewport');
        if (vpEl) {
          const scaleW = (vpEl.clientWidth - 48) / viewport.width;
          const scaleH = (vpEl.clientHeight - 48) / viewport.height;
          pdfViewerState.scale = Math.max(0.2, parseFloat(Math.min(scaleW, scaleH).toFixed(2)));
          pdfViewerState.fitMode = 'page';
          await renderCurrentPdfPage();
          syncPdfToolbar();
        }
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.warn('applyFitPage error:', err);
        }
      }
    }

    async function renderCurrentPdfPage() {
      if (!pdfViewerState.pdfDoc) return;

      const currentSeq = ++pdfViewerState.renderSequence;
      pdfViewerState.rendering = true;
      showPdfLoading(true);

      // 1. Cancel previous in-flight render task if running
      if (pdfViewerState.activeRenderTask) {
        try {
          pdfViewerState.activeRenderTask.cancel();
        } catch (_) {}
        pdfViewerState.activeRenderTask = null;
      }

      // 2. Wait for previous render promise to abort/settle so worker frees up
      if (pdfViewerState.activeRenderPromise) {
        try {
          await pdfViewerState.activeRenderPromise;
        } catch (_) {}
      }

      // Check if another render was requested while waiting
      if (currentSeq !== pdfViewerState.renderSequence) {
        return;
      }

      try {
        const pageNum = pdfViewerState.currentPage;
        const page = await pdfViewerState.pdfDoc.getPage(pageNum);

        if (currentSeq !== pdfViewerState.renderSequence) {
          return;
        }

        const wrap = container.querySelector('#ws-pdf-canvas-wrap');
        if (!wrap) {
          pdfViewerState.rendering = false;
          showPdfLoading(false);
          return;
        }

        // High-DPI support: render at device pixel ratio for crisp text and equations
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: pdfViewerState.scale * dpr });

        // CRITICAL FIX: Always render into a FRESH canvas instance.
        // This guarantees "Cannot use the same canvas during multiple render() operations" can NEVER occur.
        const freshCanvas = document.createElement('canvas');
        freshCanvas.id = 'ws-pdf-canvas';
        freshCanvas.className = 'ws-pdf-page-canvas';
        freshCanvas.width = viewport.width;
        freshCanvas.height = viewport.height;
        freshCanvas.style.width = (viewport.width / dpr) + 'px';
        freshCanvas.style.height = (viewport.height / dpr) + 'px';

        const ctx = freshCanvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, viewport.width, viewport.height);

        const renderTask = page.render({ canvasContext: ctx, viewport });
        pdfViewerState.activeRenderTask = renderTask;
        pdfViewerState.activeRenderPromise = renderTask.promise.catch((err) => {
          if (err?.name === 'RenderingCancelledException' || err?.message?.includes('cancelled') || err?.message?.includes('Rendering cancelled')) {
            return null;
          }
          throw err;
        });

        await pdfViewerState.activeRenderPromise;

        // If superseded by a newer render while drawing, discard this frame
        if (currentSeq !== pdfViewerState.renderSequence) {
          return;
        }

        // Swap into DOM seamlessly without white flash or layout jump
        wrap.replaceChildren(freshCanvas);
        hidePdfError();

        saveReadingProgress();
      } catch (err) {
        if (err?.name === 'RenderingCancelledException' || err?.message?.includes('cancelled')) {
          return; // Cancelled as expected
        }
        console.error('PDF render error:', err);
        showPdfError(`Error rendering page: ${err.message || err}`);
      } finally {
        if (currentSeq === pdfViewerState.renderSequence) {
          pdfViewerState.rendering = false;
          pdfViewerState.activeRenderTask = null;
          pdfViewerState.activeRenderPromise = null;
          showPdfLoading(false);
        }
      }
    }

    // ── Thumbnails Lazy Generator (IntersectionObserver for Large PDFs) ──
    const renderedThumbPages = new Set();

    function generateThumbnails() {
      const list = container.querySelector('#ws-pdf-thumbs-list');
      const sidebar = container.querySelector('#ws-pdf-thumbs-sidebar');
      if (!list || !pdfViewerState.pdfDoc) return;
      list.innerHTML = '';
      renderedThumbPages.clear();

      if (thumbObserver) {
        thumbObserver.disconnect();
        thumbObserver = null;
      }

      const numPages = pdfViewerState.pdfDoc.numPages;

      // IntersectionObserver: Only render thumbnails when scrolled into view
      thumbObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const pageNum = parseInt(entry.target.dataset.page, 10);
            if (pageNum && !renderedThumbPages.has(pageNum)) {
              renderThumbnailItemCanvas(pageNum, entry.target);
            }
          }
        });
      }, {
        root: sidebar,
        rootMargin: '160px 0px 160px 0px'
      });

      const fragment = document.createDocumentFragment();
      for (let i = 1; i <= numPages; i++) {
        const item = document.createElement('div');
        item.className = `ws-pdf-thumb-item ${i === pdfViewerState.currentPage ? 'active' : ''}`;
        item.dataset.page = i;
        item.title = `Jump to Page ${i}`;

        const placeholder = document.createElement('div');
        placeholder.className = 'ws-pdf-thumb-placeholder';
        placeholder.innerHTML = `<span class="ws-pdf-thumb-loading-num">p.${i}</span>`;

        const label = document.createElement('span');
        label.className = 'ws-pdf-thumb-num';
        label.textContent = i;

        item.appendChild(placeholder);
        item.appendChild(label);

        item.addEventListener('click', () => {
          pdfViewerState.currentPage = i;
          renderCurrentPdfPage();
          syncPdfToolbar();
          updateThumbnailActive();
        });

        thumbObserver.observe(item);
        fragment.appendChild(item);
      }
      list.appendChild(fragment);
    }

    async function renderThumbnailItemCanvas(pageNum, itemEl) {
      if (renderedThumbPages.has(pageNum) || !pdfViewerState.pdfDoc) return;
      renderedThumbPages.add(pageNum);

      try {
        const page = await pdfViewerState.pdfDoc.getPage(pageNum);
        const vp = page.getViewport({ scale: 0.16 });

        const canvas = document.createElement('canvas');
        canvas.className = 'ws-pdf-thumb-canvas';
        canvas.width = vp.width;
        canvas.height = vp.height;

        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, vp.width, vp.height);

        await page.render({ canvasContext: ctx, viewport: vp }).promise;

        const placeholder = itemEl.querySelector('.ws-pdf-thumb-placeholder');
        if (placeholder) {
          placeholder.replaceWith(canvas);
        } else {
          itemEl.insertBefore(canvas, itemEl.lastChild);
        }
      } catch (_) {}
    }

    function updateThumbnailActive() {
      const list = container.querySelector('#ws-pdf-thumbs-list');
      if (!list) return;
      list.querySelectorAll('.ws-pdf-thumb-item').forEach(it => {
        const p = parseInt(it.dataset.page, 10);
        it.classList.toggle('active', p === pdfViewerState.currentPage);
      });
      const activeEl = list.querySelector('.ws-pdf-thumb-item.active');
      activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    async function loadPdfDocument(source, filename, subjectId) {
      const generation = viewGeneration;
      const resourceId = activeResourceId;
      try {
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        if (!pdfjsLib) {
          window.showToast?.('PDF.js not loaded. Check your internet connection.');
          return;
        }
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        // Clean up active blob URL
        if (pdfViewerState.activeBlobUrl) {
          try { URL.revokeObjectURL(pdfViewerState.activeBlobUrl); } catch (_) {}
          pdfViewerState.activeBlobUrl = null;
        }

        // Cancel previous active render task if any
        if (pdfViewerState.activeRenderTask) {
          try { pdfViewerState.activeRenderTask.cancel(); } catch (_) {}
          pdfViewerState.activeRenderTask = null;
        }

        let docSource;
        if (source instanceof Blob || source instanceof File) {
          const blobUrl = URL.createObjectURL(source);
          pdfViewerState.activeBlobUrl = blobUrl;
          docSource = blobUrl;
        } else {
          docSource = source;
        }

        showPdfLoading(true);
        const loadingText = container.querySelector('.ws-pdf-loading-text');
        if (loadingText) loadingText.textContent = 'Loading document...';

        const loadingTask = pdfjsLib.getDocument({
          url: typeof docSource === 'string' ? docSource : undefined,
          data: docSource instanceof ArrayBuffer || docSource instanceof Uint8Array ? docSource : undefined,
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/',
          enableXfa: true,
          rangeChunkSize: 65536 * 4
        });

        loadingTask.onProgress = function(progress) {
          const lt = container.querySelector('.ws-pdf-loading-text');
          if (!lt) return;
          if (progress.total > 0) {
            const pct = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
            lt.textContent = `Loading document: ${pct}%...`;
          } else if (progress.loaded > 0) {
            const mb = (progress.loaded / (1024 * 1024)).toFixed(1);
            lt.textContent = `Loading document: ${mb} MB...`;
          }
        };

        const pdfDoc = await loadingTask.promise;

        if (generation !== viewGeneration || selectedSubjectId !== subjectId || activeResourceId !== resourceId) {
          await pdfDoc.destroy?.();
          return;
        }
        await pdfViewerState.pdfDoc?.destroy?.();
        pdfViewerState.pdfDoc = pdfDoc;
        pdfViewerState.filename = filename;
        pdfViewerState.subjectId = subjectId;
        pdfViewerState.searchResults = [];
        pdfViewerState.searchQuery = '';

        // Restore saved reading progress if available
        const savedProgress = loadReadingProgress();
        if (savedProgress && savedProgress.page <= pdfDoc.numPages) {
          pdfViewerState.currentPage = savedProgress.page;
          pdfViewerState.scale = savedProgress.scale || 1.0;
          pdfViewerState.fitMode = savedProgress.fitMode || 'width';
          window.showToast?.(`📖 Resuming ${filename} at page ${savedProgress.page}`);
        } else {
          pdfViewerState.currentPage = 1;
          pdfViewerState.scale = 1.0;
          pdfViewerState.fitMode = 'width';
        }

        render();

        setTimeout(() => {
          container.querySelector('#ws-pdf-viewer-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
      } catch (err) {
        if (generation !== viewGeneration || activeResourceId !== resourceId) return;
        console.error('Failed to load PDF:', err);
        showPdfLoading(false);
        window.showToast?.('Failed to load PDF: ' + (err.message || err));
      }
    }

    const loadPdfFromDataUrl = loadPdfDocument;

    async function handlePdfFileUpload(file, subjectId) {
      if (!file || (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) {
        window.showToast?.('Please select a valid PDF file.');
        return;
      }
      // Direct File loading via createObjectURL (instant, 0 memory overhead!)
      disposeVideo?.();
      disposeVideo = null;
      activeResourceId = '__local_pdf__';
      db.recordStudyActivity({ type: 'pdf_read', subjectId, resourceId: null, pdfFilename: file.name });
      await loadPdfDocument(file, file.name, subjectId);
      // Persist in IndexedDB for active subject workspace
      await savePdfToStorage(`active-pdf-${subjectId}`, file, file.name);
    }

    timerUnsubscribe = timer.subscribe(() => updateFocusDisplay());
    updateFocusDisplay();

    // Check if Continue Studying requested auto-opening a resource
    const targetResourceId = sessionStorage.getItem('axiom_target_resource_id');
    if (targetResourceId) {
      sessionStorage.removeItem('axiom_target_resource_id');
      const targetRes = (db.getResources() || []).find(r => r.id === targetResourceId);
      if (targetRes && targetRes.subjectId === currentSubject.id) setTimeout(() => openResource(targetRes), 60);
    } else if (activeResource?.type === 'pdf' && !pdfIsOpen && restoredResourceId !== activeResource.id) {
      restoredResourceId = activeResource.id;
      setTimeout(() => openResource(activeResource), 60);
    }

    // Auto-render if PDF is loaded (handles initial load and tab switches without colliding)
    if (pdfIsOpen) {
      setTimeout(async () => {
        if (!pdfViewerState.pdfDoc) return;
        if (pdfViewerState.fitMode === 'width') {
          await applyFitWidth();
        } else if (pdfViewerState.fitMode === 'page') {
          await applyFitPage();
        } else {
          await renderCurrentPdfPage();
        }
        if (pdfViewerState.thumbsOpen) {
          generateThumbnails();
        }
      }, 50);
    }
  }

  render();

  // Return router unmount cleanup
  return () => {
    cleanup();
  };
}
// ─────────────────────────────────────────────────────────────────────────────
//  Focus Modals — embedded so the Subject Workspace cockpit can call them
// ─────────────────────────────────────────────────────────────────────────────

function showResistanceModal(onConfirmPause) {
  const modalHtml = `
    <dialog class="modal" id="resistance-dialog">
      <div class="modal-header">
        <h3 style="font-size:1rem; color:var(--accent-amber);">TAKING A BREAK?</h3>
        <button class="btn btn-ghost btn-sm" id="close-res-btn">✕</button>
      </div>
      <div class="modal-body" style="text-align:center; padding:var(--space-6) var(--space-4);">
        <p style="font-size:1.1rem; color:var(--text-primary); margin-bottom:var(--space-2);">You can stop.</p>
        <p style="font-size:0.95rem; color:var(--text-secondary); margin-bottom:var(--space-6);">Or give yourself five more minutes of focus?</p>
        <div style="display:flex; justify-content:center; gap:var(--space-4);">
          <button class="btn btn-primary" id="res-continue-btn">Give 5 More Minutes</button>
          <button class="btn btn-secondary" id="res-pause-btn">Take Break</button>
        </div>
      </div>
    </dialog>
  `;
  const existing = document.getElementById('resistance-dialog');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('resistance-dialog');
  dialog.showModal();
  const close = () => { dialog.close(); dialog.remove(); };
  dialog.querySelector('#close-res-btn').addEventListener('click', close);
  dialog.querySelector('#res-continue-btn').addEventListener('click', () => {
    close();
    timer.addFiveMinutes();
  });
  dialog.querySelector('#res-pause-btn').addEventListener('click', () => { close(); onConfirmPause(); });
}

function showPreStudyMeditationModal(onReadyToStudy) {
  let secondsLeft = 120;
  let interval = null;
  const modalHtml = `
    <dialog class="modal" id="pre-med-dialog">
      <div class="modal-header">
        <h3>2-Minute Settle In</h3>
        <button class="btn btn-ghost btn-sm" id="close-pre-med-btn">✕</button>
      </div>
      <div class="modal-body" style="text-align:center; padding:var(--space-8) var(--space-4);">
        <p style="font-size:0.95rem; color:var(--text-secondary); margin-bottom:var(--space-4);">
          Clear distractions. Close unnecessary browser tabs. Take steady, calm breaths.
        </p>
        <div style="font-family:var(--font-mono); font-size:3rem; font-weight:700; color:var(--accent-primary); margin:var(--space-4) 0;" id="pre-med-timer">
          02:00
        </div>
        <p style="font-size:0.85rem; color:var(--text-muted); font-style:italic;">
          "The mind is not a vessel to be filled, but a fire to be kindled."
        </p>
      </div>
      <div class="modal-footer" style="justify-content:space-between;">
        <button class="btn btn-ghost" id="pre-med-skip-btn">Skip to Study</button>
        <button class="btn btn-primary" id="pre-med-ready-btn">I'm Ready</button>
      </div>
    </dialog>
  `;
  const existing = document.getElementById('pre-med-dialog');
  if (existing) existing.remove();
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('pre-med-dialog');
  dialog.showModal();
  const timerDisplay = dialog.querySelector('#pre-med-timer');
  interval = setInterval(() => {
    secondsLeft--;
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    if (timerDisplay) timerDisplay.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (secondsLeft <= 0) { clearInterval(interval); close(); onReadyToStudy(); }
  }, 1000);
  const close = () => { clearInterval(interval); dialog.close(); dialog.remove(); };
  dialog.querySelector('#close-pre-med-btn').addEventListener('click', close);
  dialog.querySelector('#pre-med-skip-btn').addEventListener('click', () => { close(); onReadyToStudy(); });
  dialog.querySelector('#pre-med-ready-btn').addEventListener('click', () => { close(); onReadyToStudy(); });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Modal: Add Resource (with PDF file upload support)
// ─────────────────────────────────────────────────────────────────────────────
function showAddResourceModal(subjectId, onComplete) {
  const modalHtml = `
    <dialog class="modal" id="add-resource-modal">
      <div class="modal-header">
        <h3>+ Add Subject Resource</h3>
        <button class="btn btn-ghost btn-sm" id="close-res-modal">✕</button>
      </div>
      <div class="modal-body">
        <form id="add-resource-form">
          <div class="form-group">
            <label class="form-label">Resource Title *</label>
            <input type="text" name="title" required placeholder="e.g. Chapter 3 Reviewer &amp; Differential Models" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Resource Type</label>
              <select name="type" id="res-type-select">
                <option value="pdf">PDF File</option>
                <option value="youtube">YouTube Video</option><option value="playlist">YouTube Playlist</option>
                <option value="module">Module</option>
                <option value="notes">Notes</option>
                <option value="drive">Google Drive</option>
                <option value="video">Other Video</option>
                <option value="reviewer">Reviewer</option>
                <option value="website">Website</option>
                <option value="reference">Reference</option>
                <option value="other">Other Material</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Category</label>
              <select name="category">
                <option value="Study Material">Study Material</option>
                <option value="Lecture">Lecture</option>
                <option value="Reviewer">Reviewer</option>
                <option value="Reference">Reference</option>
                <option value="Practice">Practice</option>
              </select>
            </div>
          </div>
          <div class="form-group" id="res-url-group">
            <label class="form-label" id="res-url-label">Resource URL / Link</label>
            <input type="url" name="url" id="res-url-input" placeholder="https://..." />
            <div id="res-url-error" class="ws-resource-error" role="alert"></div>
          </div>
          <!-- PDF file upload — shown when type is "pdf" -->
          <div class="form-group" id="pdf-file-upload-group">
            <label class="form-label">Upload PDF File (Optional — stores locally for in-app viewing)</label>
            <label class="ws-pdf-file-label">
              📁 Choose PDF file to embed...
              <input type="file" id="res-pdf-file-input" accept=".pdf" />
            </label>
            <div class="ws-pdf-selected-file" id="res-pdf-selected-name" style="display:none;"></div>
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea name="description" rows="2" placeholder="Key topics covered, chapters, or instructions..."></textarea>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-res-btn">Cancel</button>
        <button class="btn btn-primary" id="save-res-btn">Save Resource</button>
      </div>
    </dialog>
  `;

  const existing = document.getElementById('add-resource-modal');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('add-resource-modal');
  dialog.showModal();

  // Show/hide PDF upload based on type selection
  const typeSelect = dialog.querySelector('#res-type-select');
  const pdfUploadGroup = dialog.querySelector('#pdf-file-upload-group');
  const urlInput = dialog.querySelector('#res-url-input');
  const updateType = () => {
    pdfUploadGroup.style.display = typeSelect.value === 'pdf' ? 'block' : 'none';
    dialog.querySelector('#res-url-label').textContent = ['youtube', 'playlist'].includes(typeSelect.value) ? 'YouTube URL *' : 'Resource URL / Link';
    urlInput.placeholder = ['youtube', 'playlist'].includes(typeSelect.value) ? 'https://www.youtube.com/watch?v=...' : 'https://...';
    urlInput.required = ['youtube', 'playlist'].includes(typeSelect.value);
    dialog.querySelector('#res-url-error').textContent = '';
  };
  typeSelect.addEventListener('change', updateType);
  urlInput.addEventListener('paste', () => setTimeout(() => { if (parseYouTubeResource(urlInput.value)) { typeSelect.value = parseYouTubeResource(urlInput.value).playlistId ? 'playlist' : 'youtube'; updateType(); } }, 0));
  updateType();

  // Show selected filename
  const pdfFileInput = dialog.querySelector('#res-pdf-file-input');
  const pdfSelectedName = dialog.querySelector('#res-pdf-selected-name');
  pdfFileInput.addEventListener('change', () => {
    const file = pdfFileInput.files[0];
    if (file) {
      pdfSelectedName.textContent = `✓ ${file.name}`;
      pdfSelectedName.style.display = 'block';
    }
  });

  const close = () => {
    dialog.close();
    dialog.remove();
  };

  dialog.querySelector('#close-res-modal').addEventListener('click', close);
  dialog.querySelector('#cancel-res-btn').addEventListener('click', close);
  dialog.querySelector('#save-res-btn').addEventListener('click', async () => {
    const form = dialog.querySelector('#add-resource-form');
    const formData = new FormData(form);
    const title = formData.get('title')?.trim();
    if (!title) return;

    let url = formData.get('url')?.trim() || '';
    let domain = '';
    if (url) {
      try {
        const u = new URL(url);
        domain = u.hostname.replace('www.', '');
      } catch (e) {
        domain = 'link';
      }
    }

    const resourceType = formData.get('type') || 'other';
    const parsed = parseYouTubeResource(url);
    const videoId = parsed?.videoId;
    if (['youtube', 'playlist'].includes(resourceType) && !parsed) {
      dialog.querySelector('#res-url-error').textContent = 'Enter a valid YouTube video or playlist URL.';
      urlInput.focus();
      return;
    }
    let pdfFile = null;
    let pdfDataUrl = undefined;

    // Handle PDF file upload if type is pdf and a file was selected
    if (resourceType === 'pdf' && pdfFileInput.files[0]) {
      pdfFile = pdfFileInput.files[0];
      // If small file (< 1MB), also keep dataUrl as quick fallback
      if (pdfFile.size < 1024 * 1024) {
        pdfDataUrl = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.readAsDataURL(pdfFile);
        });
      }
    }

    const resourceData = {
      title,
      type: resourceType,
      ...(parsed || {}),
      category: formData.get('category') || 'Study Material',
      url,
      domain,
      description: formData.get('description')?.trim() || '',
      subjectId
    };
    resourceData.dateAdded = new Date().toISOString();
    if (videoId) {
      resourceData.videoId = videoId;
      resourceData.youtubeUrl = url;
      resourceData.lastPlaybackPosition = 0;
      resourceData.lastStudiedAt = null;
    }

    if (pdfFile) {
      resourceData.hasPdfFile = true;
      resourceData.pdfFileName = pdfFile.name;
    }
    if (pdfDataUrl !== undefined) {
      resourceData.pdfDataUrl = pdfDataUrl;
    }

    const created = db.addResource(resourceData);
    if (pdfFile && created?.id) {
      await savePdfToStorage(created.id, pdfFile, pdfFile.name);
    }

    close();
    if (onComplete) onComplete();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Modal: Create Subject
// ─────────────────────────────────────────────────────────────────────────────
function showNewSubjectModal(onComplete) {
  const modalHtml = `
    <dialog class="modal" id="subject-modal">
      <div class="modal-header">
        <h3>Create New Subject</h3>
        <button class="btn btn-ghost btn-sm" id="close-sub-modal">✕</button>
      </div>
      <div class="modal-body">
        <form id="subject-form">
          <div class="form-group">
            <label class="form-label">Subject Name *</label>
            <input type="text" name="name" required />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Course Code *</label>
              <input type="text" name="code" required />
            </div>
            <div class="form-group">
              <label class="form-label">Instructor</label>
              <input type="text" name="instructor" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <input type="text" name="description" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Color Accent</label>
              <select name="color">
                <option value="#38bdf8">Cyan (#38bdf8)</option>
                <option value="#6366f1">Indigo (#6366f1)</option>
                <option value="#10b981">Emerald (#10b981)</option>
                <option value="#f59e0b">Amber (#f59e0b)</option>
                <option value="#a855f7">Purple (#a855f7)</option>
                <option value="#f43f5e">Rose (#f43f5e)</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">Units</label>
              <input type="number" name="units" min="1" max="10" />
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-sub-btn">Cancel</button>
        <button class="btn btn-primary" id="save-sub-btn">Add Subject</button>
      </div>
    </dialog>
  `;

  const existing = document.getElementById('subject-modal');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('subject-modal');
  dialog.showModal();

  const close = () => {
    dialog.close();
    dialog.remove();
  };

  dialog.querySelector('#close-sub-modal').addEventListener('click', close);
  dialog.querySelector('#cancel-sub-btn').addEventListener('click', close);
  dialog.querySelector('#save-sub-btn').addEventListener('click', () => {
    const form = dialog.querySelector('#subject-form');
    const formData = new FormData(form);
    const name = formData.get('name')?.trim();
    const code = formData.get('code')?.trim();
    if (!name || !code) return;

    db.addSubject({
      name,
      code,
      instructor: formData.get('instructor')?.trim() || '',
      description: formData.get('description')?.trim() || '',
      color: formData.get('color') || '#38bdf8',
      units: formData.get('units') ? parseInt(formData.get('units'), 10) : undefined,
      icon: '📁',
      notes: ''
    });

    close();
    if (onComplete) onComplete();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  Modal: Edit Subject Info
// ─────────────────────────────────────────────────────────────────────────────
function showEditSubjectInfoModal(subject, onComplete) {
  const modalHtml = `
    <dialog class="modal" id="edit-sub-modal">
      <div class="modal-header">
        <h3>Edit Subject: ${subject.name}</h3>
        <button class="btn btn-ghost btn-sm" id="close-edit-sub-modal">✕</button>
      </div>
      <div class="modal-body">
        <form id="edit-sub-form">
          <div class="form-group">
            <label class="form-label">Subject Name *</label>
            <input type="text" name="name" required value="${subject.name || ''}" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Course Code *</label>
              <input type="text" name="code" required value="${subject.code || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label">Instructor</label>
              <input type="text" name="instructor" value="${subject.instructor || ''}" />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Notes</label>
            <textarea name="description" rows="2">${subject.description || ''}</textarea>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Schedule</label>
              <input type="text" name="schedule" value="${subject.schedule || ''}" />
            </div>
            <div class="form-group">
              <label class="form-label">Units</label>
              <input type="number" name="units" value="${subject.units || ''}" />
            </div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-edit-sub-btn">Cancel</button>
        <button class="btn btn-primary" id="save-edit-sub-btn">Save Changes</button>
      </div>
    </dialog>
  `;

  const existing = document.getElementById('edit-sub-modal');
  if (existing) existing.remove();

  document.body.insertAdjacentHTML('beforeend', modalHtml);
  const dialog = document.getElementById('edit-sub-modal');
  dialog.showModal();

  const close = () => {
    dialog.close();
    dialog.remove();
  };

  dialog.querySelector('#close-edit-sub-modal').addEventListener('click', close);
  dialog.querySelector('#cancel-edit-sub-btn').addEventListener('click', close);
  dialog.querySelector('#save-edit-sub-btn').addEventListener('click', () => {
    const form = dialog.querySelector('#edit-sub-form');
    const formData = new FormData(form);
    const name = formData.get('name')?.trim();
    const code = formData.get('code')?.trim();
    if (!name || !code) return;

    db.updateSubject(subject.id, {
      name,
      code,
      instructor: formData.get('instructor')?.trim() || '',
      description: formData.get('description')?.trim() || '',
      schedule: formData.get('schedule')?.trim() || '',
      units: formData.get('units') ? parseInt(formData.get('units'), 10) : undefined
    });

    close();
    if (onComplete) onComplete();
  });
}

import { showRenameResourceModal } from './renameResource.js';
import { mountResourceNavigation } from '../resourceViewer.js';
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
import { taskScheduledDate } from '../taskSchedule.js';
import { floatingTimer } from '../floatingTimer.js';
import { formatStudyMinutes } from '../studyTime.js';
import { durationPickerMarkup, mountDurationPicker } from '../durationPicker.js';
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
  resourceId: null,
  rendering: false,
  fitMode: 'width',
  spaceDown: false,
  thumbsOpen: false,
  thumbsWidth: 115,
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
const safeResourceUrl = value => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
};
const embeddableResourceUrl = value => {
  const url = new URL(value);
  const match = url.hostname === 'docs.google.com' && url.pathname.match(/^\/(document|spreadsheets|presentation)\/d\/([^/]+)/);
  if (match) return `https://docs.google.com/${match[1]}/d/${match[2]}/preview`;
  const drive = url.hostname === 'drive.google.com' && url.pathname.match(/^\/file\/d\/([^/]+)/);
  return drive ? `https://drive.google.com/file/d/${drive[1]}/preview` : url.href;
};
const webNavigation = new Map();

export function renderSubjects(container) {
  let selectedSubjectId = null;
  let viewGeneration = 0;
  let activeResourceId = null;
  let restoredResourceId = null;
  let disposeImage = null;
  let disposeVideo = null;
  let timerUnsubscribe = null;
  let floatingChangeHandler = null;
  let durationPicker = null;
  let hideSubjectCompleted = false;
  let viewerFullscreen = false;
  let disposeNavigation = null;
  const imageStates = new Map();
  let pdfTimerVisible = false;

  // Per-render Focus cockpit state (reset when switching subjects)
  let isFullscreen = false;
  let showMotivation = true;
  let currentQuote = getQuoteForDate().quote;

  let mouseMoveHandler = null;
  let mouseUpHandler = null;
  let thumbObserver = null;
  let sidebarKeyHandler = null;
  let timerFullscreenKeyHandler = null;
  let dividerMouseMoveHandler = null;
  let dividerMouseUpHandler = null;

  function cleanup() {
    durationPicker?.destroy();
    durationPicker = null;
    viewGeneration++;
    disposeNavigation?.();
    disposeNavigation = null;
    disposeImage?.();
    disposeImage = null;
    disposeVideo?.();
    disposeVideo = null;
    if (timerUnsubscribe) {
      timerUnsubscribe();
      timerUnsubscribe = null;
    }
    if (floatingChangeHandler) {
      window.removeEventListener('axiom-floating-timer-change', floatingChangeHandler);
      floatingChangeHandler = null;
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
    if (timerFullscreenKeyHandler) {
      document.removeEventListener('keydown', timerFullscreenKeyHandler);
      timerFullscreenKeyHandler = null;
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

  function addSubject() {
    showAddWorkspaceSubject(subject => {
      selectedSubjectId = subject.id;
      render();
    });
  }

  function render() {
    cleanup();
    document.body.classList.add('ws-reader-active');

    // Reset focus cockpit state on subject switch
    isFullscreen = false;
    showMotivation = true;
    currentQuote = getQuoteForDate().quote;

    const targetSub = sessionStorage.getItem('axiom_target_subject_id');
    const target = targetSub ? db.getSubjectById(targetSub) : null;
    if (targetSub) sessionStorage.removeItem('axiom_target_subject_id');
    let subjects = db.getSubjectsForPeriod();
    if (target && !subjects.some(subject => subject.id === target.id)) {
      db.updateUserProfile({ ...db.getSubjectPeriod(target), term: '' });
      subjects = db.getSubjectsForPeriod();
    }
    if (target) selectedSubjectId = target.id;
    if (floatingTimer.active && subjects.some(subject => subject.id === floatingTimer.subjectId)) {
      selectedSubjectId = floatingTimer.subjectId;
    }
    if (!subjects.some(subject => subject.id === selectedSubjectId)) {
      const previousSubject = db.getStudyActivity()?.subjectId;
      selectedSubjectId = subjects.some(s => s.id === previousSubject) ? previousSubject : subjects[0]?.id ?? null;
    }

    const currentSubject = db.getSubjectById(selectedSubjectId) || {
      id: null, code: 'GENERAL', name: 'General Workspace', color: '#38bdf8'
    };

    if (currentSubject) {
      db.recordStudyActivity({
        type: 'subject_visit',
        subjectId: currentSubject.id,
        subjectCode: currentSubject.code
      });
    }

    // Empty state
    if (!currentSubject.id) {
      container.innerHTML = `
        <div class="ws-container">
          <div class="tasks-toolbar">
            <div>
              <h2>Workspace</h2>
            </div>
            <div>
              <button class="btn btn-primary" id="ws-add-subject">Add Subject</button>
            </div>
          </div>
          <div class="ws-no-subject"><div class="ws-no-subject-icon">📚</div><h3>General Workspace</h3><p>Start studying now, or add a subject when you are ready.</p><a href="#grades" class="btn btn-secondary">Manage subjects and terms</a></div>
        </div>
      `;
      container.querySelector('#ws-add-subject').addEventListener('click', addSubject);
    }

    // Per-subject data
    const subjectTasks = db.getTasks().filter(t => t.subjectId === currentSubject.id);
    const pendingTasks = subjectTasks.filter(t => t.status !== 'completed');
    const completedTasks = subjectTasks.filter(t => t.status === 'completed');

    const allResources = db.getResources() || [];
    const subjectResources = allResources.filter(r => r.subjectId === currentSubject.id);
    if (activeResourceId !== '__none__' && !subjectResources.some(resource => resource.id === activeResourceId)) {
      activeResourceId = db.getLastResourceId(currentSubject.id) || null;
    }
    const activeResource = subjectResources.find(r => r.id === activeResourceId) || null;
    const activeVideo = activeResource && (studyResourceDisplay(activeResource).icon === '▶') ? activeResource : null;
    const activeImage = activeResource?.type === 'image' ? activeResource : null;
    const activeWeb = activeResource && !activeVideo && !activeImage && activeResource.type !== 'pdf' && safeResourceUrl(activeResource.url) ? activeResource : null;
    const activeVideoId = activeVideo ? resourceVideoId(activeVideo) : null;
    const activePlaylistId = activeVideo ? (activeVideo.playlistId || parseYouTubeResource(activeVideo.url || '')?.playlistId) : null;
    const activeYouTubeUrl = activeVideoId
      ? `https://www.youtube.com/watch?v=${activeVideoId}${activePlaylistId ? '&list=' + activePlaylistId : ''}`
      : `https://www.youtube.com/playlist?list=${activePlaylistId}`;

    const focusSessions = db.getFocusSessions() || [];
    const subjectSessions = focusSessions.filter(s => s.subjectId === currentSubject.id);

    const todayStr = db.getTodayDate();
    const todaySessions = subjectSessions.filter(s => s.startTime && db.isSameLocalDate(s.startTime, todayStr));
    const todayMins = todaySessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

    const formatMins = formatStudyMinutes;

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
    if (timer.state === 'idle' && !floatingTimer.active && (!existingTask || existingTask.subjectId !== currentSubject.id)) {
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
    const pdfIsOpen = !activeVideo && !activeWeb && !activeImage && !!(pdfViewerState.pdfDoc && pdfViewerState.subjectId === currentSubject.id && pdfViewerState.resourceId === activeResourceId);

    container.innerHTML = `
      <div class="ws-container" style="--ws-accent: ${currentSubject.color || '#38bdf8'};">
        <!-- ── Top Subject Strip (Compact Command Header) ───────────────────── -->
        <h2 class="ws-page-title">Workspace</h2>
        <header class="ws-top-strip">
          <div class="ws-top-strip-left">
            <select class="ws-subject-select" id="ws-subject-dropdown" aria-label="Select Subject">
              ${!subjects.length ? '<option value="">General Workspace</option>' : ''}
              ${subjects.map(s => `
                <option value="${s.id}" ${s.id === currentSubject.id ? 'selected' : ''}>
                  ${escapeHtml(s.code ? s.code + ' · ' + s.name : s.name)}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="ws-top-strip-right">
            <div class="ws-header-stats-compact">
              <span class="ws-stat-pill" title="Today's study time">TODAY: <b>${formatMins(todayMins)}</b></span>
            </div>
            <button class="btn btn-secondary btn-sm ws-btn-sub-action" id="ws-add-subject">Add Subject</button>
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
            <div class="ws-panel ws-pdf-viewer-panel" aria-label="Study Viewer" id="ws-pdf-viewer-section" tabindex="-1">
              <div class="ws-resource-header resource-navigation">
                <button type="button" class="btn btn-secondary btn-sm" data-viewer-resources aria-expanded="false" aria-controls="viewer-resource-list">Resources</button>
                <button type="button" class="btn btn-ghost btn-sm" data-viewer-prev aria-label="Previous resource" title="Previous resource (←)">←</button>
                <button type="button" class="btn btn-ghost btn-sm" data-viewer-next aria-label="Next resource" title="Next resource (→)">→</button>
                <span class="resource-active-title">${escapeHtml(activeResource?.title || 'Study Viewer')}</span>
                <details class="resource-more"><summary title="More options">More</summary><div class="resource-more-menu">
                  <button type="button" class="btn btn-secondary btn-sm" id="ws-change-resource" aria-controls="ws-resource-picker" aria-expanded="${!activeVideo && !activeWeb && !activeImage && !pdfIsOpen}">Add Resource</button>
                  <button type="button" class="btn btn-ghost btn-sm" data-viewer-timer>Toggle timer</button>
                </div></details>
                <button type="button" class="btn btn-secondary btn-sm" data-viewer-fullscreen>${viewerFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</button>
              </div>
              <nav id="viewer-resource-list" class="viewer-resource-list" aria-label="Saved subject resources" hidden>
                ${subjectResources.map(resource => `<button type="button" class="btn btn-secondary btn-sm" data-viewer-resource="${escapeHtml(resource.id)}" aria-current="${resource.id === activeResourceId ? 'true' : 'false'}">${studyResourceDisplay(resource).icon} ${escapeHtml(resource.title)}</button>`).join('')}
                ${!subjectResources.length ? '<p>No saved resources yet.</p>' : ''}
              </nav>
              <p class="viewer-lock" role="status" hidden>Return the floating timer to switch resources.</p>
              <section class="ws-resource-picker" id="ws-resource-picker" aria-label="Choose a study resource" ${activeVideo || activeWeb || activeImage || pdfIsOpen ? 'hidden' : ''}>
                <div class="ws-resource-picker-inner">
                  <h3>Choose your study resource</h3>
                  <div class="ws-resource-options">
                    <button type="button" class="ws-resource-option" id="ws-choose-pdf">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/></svg>
                      <strong>PDF</strong><span>Read a PDF from your device.</span>
                    </button>
                    <button type="button" class="ws-resource-option" id="ws-choose-link" aria-controls="ws-link-form" aria-expanded="false">
                      <strong>🔗 Link</strong><span>Open a YouTube video, playlist, or website.</span>
                    </button>
                  </div>
                  <input type="file" id="ws-resource-pdf-input" accept=".pdf,application/pdf" hidden aria-label="Upload PDF" />
                  <button type="button" class="btn btn-secondary" id="ws-choose-image">🖼 Image</button>
                  <input type="file" id="ws-image-input" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" hidden />
                  <form id="ws-link-form" class="ws-youtube-form" hidden novalidate>
                    <label for="ws-link-url">Resource URL</label>
                    <div class="ws-youtube-input-row"><input type="url" id="ws-link-url" autocomplete="off" required /><button class="btn btn-primary" type="submit">Open Resource</button></div>
                    <label for="ws-link-title">Resource name (optional)</label>
                    <input type="text" id="ws-link-title" name="title" />
                    <p id="ws-link-type" aria-live="polite"></p>
                    <p id="ws-link-error" class="ws-resource-error" role="alert"></p>
                  </form>
                  <button type="button" class="btn btn-ghost btn-sm" id="ws-resource-cancel" ${activeVideo || activeWeb || activeImage || pdfIsOpen ? '' : 'hidden'}>Return to current resource</button>
                </div>
              </section>
              <div class="ws-resource-content" id="ws-resource-content" ${activeVideo || activeWeb || activeImage || pdfIsOpen ? '' : 'hidden'}>

              ${activeImage ? `<div class="ws-web-toolbar"><button type="button" class="btn btn-ghost btn-sm" data-image-zoom="-1" aria-label="Zoom out">−</button><button type="button" class="btn btn-ghost btn-sm" data-image-fit>Fit to Screen</button><button type="button" class="btn btn-ghost btn-sm" data-image-reset>1:1</button><button type="button" class="btn btn-ghost btn-sm" data-image-zoom="1" aria-label="Zoom in">+</button></div><div class="ws-image-viewer"><img id="ws-study-image" alt="${escapeHtml(activeImage.title)}" hidden><p id="ws-image-status" role="status">Loading image…</p></div>` : activeWeb ? `<div class="ws-web-toolbar"><button class="btn btn-secondary btn-sm" id="ws-web-back">Workspace</button><button class="btn btn-secondary btn-sm" id="ws-web-previous" aria-label="Back">←</button><button class="btn btn-secondary btn-sm" id="ws-web-next" aria-label="Forward">→</button><input id="ws-web-url" type="url" aria-label="Website URL" value="${escapeHtml(activeWeb.url)}"><button class="btn btn-secondary btn-sm" id="ws-web-load">Load</button><button class="btn btn-secondary btn-sm" id="ws-web-refresh">Refresh</button><a class="btn btn-secondary btn-sm" id="ws-web-external" href="${escapeHtml(activeWeb.url)}" target="_blank" rel="noopener noreferrer">Open in New Tab</a></div><p id="ws-web-status" role="status">Loading resource…</p><iframe id="ws-web-frame" title="${escapeHtml(activeWeb.title)}" src="${escapeHtml(embeddableResourceUrl(activeWeb.url))}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-storage-access-by-user-activation" allow="identity-credentials-get" loading="eager"></iframe><p class="ws-web-help">Sites can use your browser sign-in when their embed and cookie policies allow it. If sign-in or the page is blocked here, use Open in New Tab.</p>` : activeVideo ? `
                <div class="ws-pdf-topbar"><div class="ws-pdf-filename">▶ ${escapeHtml(activeVideo.title)}</div><span class="ws-video-position">${formatVideoTime(activeVideo.lastPlaybackPosition || 0)}</span>${activeVideoId || activePlaylistId ? `<a class="ws-video-external" href="${activeYouTubeUrl}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>` : ''}</div>
                <div class="ws-playlist-controls"><span id="ws-current-video-title">${escapeHtml(activeVideo.currentVideoTitle || (activePlaylistId ? activeVideo.title : ""))}</span>${activePlaylistId ? `<button id="ws-playlist-prev" class="btn btn-secondary btn-sm" disabled>Previous</button><button id="ws-playlist-next" class="btn btn-secondary btn-sm" disabled>Next</button><small>Use the player’s playlist menu to choose a video.</small>` : ""}</div><div class="ws-video-body"><div class="ws-video-frame" id="ws-video-frame"><div id="ws-youtube-player" class="ws-video-player"><span>Loading video…</span></div></div><div class="ws-video-error" id="ws-video-error" role="alert" hidden><strong>Video unavailable</strong><p></p><div class="ws-video-error-actions"><button type="button" class="btn btn-secondary btn-sm" id="ws-video-retry">Try Again</button>${activeVideoId || activePlaylistId ? `<a class="btn btn-secondary btn-sm" href="${activeYouTubeUrl}" target="_blank" rel="noopener noreferrer">Open on YouTube ↗</a>` : ''}</div></div></div>
              ` : `

              <!-- Top Toolbar: single distraction-free compact bar -->
              <div class="ws-pdf-topbar" id="ws-pdf-topbar">
                <button class="ws-pdf-tb-btn ${pdfViewerState.thumbsOpen ? 'active' : ''}" id="ws-pdf-thumbs-btn" aria-controls="ws-pdf-thumbs-pane" aria-expanded="${pdfViewerState.thumbsOpen}" title="Toggle page thumbnails (T)" ${!pdfIsOpen ? 'disabled' : ''}>
                  <span aria-hidden="true">📑</span> PDF Thumbnails
                </button>
                <div class="ws-pdf-filename" title="${pdfIsOpen ? escapeHtml(pdfViewerState.filename) : ''}">
                  ${pdfIsOpen ? `📄 ${escapeHtml(pdfViewerState.filename)}` : 'No PDF Loaded'}
                </div>

                ${pdfIsOpen ? `
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

                  <!-- Zoom controls -->
                  <div class="ws-pdf-zoom-group">
                    <button class="ws-pdf-tb-btn" id="ws-pdf-zoom-out-btn" title="Zoom out (- / Ctrl+Wheel)">−</button>
                    <span class="ws-pdf-zoom-label" id="ws-pdf-zoom-label">${Math.round(pdfViewerState.scale * 100)}%</span>
                    <button class="ws-pdf-tb-btn" id="ws-pdf-zoom-in-btn" title="Zoom in (+ / Ctrl+Wheel)">+</button>
                    <button class="ws-pdf-tb-btn ${pdfViewerState.fitMode === 'width' ? 'active' : ''}" id="ws-pdf-fit-width-btn" title="Fit to width (W)">Fit W</button>
                    <button class="ws-pdf-tb-btn ${pdfViewerState.fitMode === 'page' ? 'active' : ''}" id="ws-pdf-fit-page-btn" title="Fit full page (P)">Fit P</button>
                    <button class="ws-pdf-tb-btn" id="ws-pdf-reset-zoom-btn" title="Reset zoom to 100% (0)">1:1</button>
                  </div>

                  <!-- Reading tools -->
                ` : ''}
                <div class="ws-pdf-action-group">
                  ${pdfIsOpen ? `

                  <button type="button" class="ws-pdf-tb-btn ws-pdf-timer-toggle" id="ws-pdf-timer-toggle" aria-controls="ws-pdf-focus-panel" aria-expanded="false" aria-label="Show timer" title="Show timer">
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2"/>
                      <path d="M14 5v14"/>
                      <path class="ws-pdf-timer-icon-pane" d="M16 7h3v10h-3z" fill="currentColor" stroke="none"/>
                    </svg>
                  </button>
                  <button class="ws-pdf-tb-btn danger" id="ws-pdf-close-btn" title="Close document">✕</button>
                  ` : ''}

                  <label class="btn btn-secondary btn-sm ws-pdf-upload-btn" title="Load PDF from your device" style="position:relative; overflow:hidden; cursor:pointer; flex-shrink:0;">
                  📂 Load PDF
                  <input type="file" id="ws-pdf-file-input" accept=".pdf" style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%;" />
                  </label>
                </div>
              </div>

              ${pdfIsOpen ? `
                <!-- Document Body: Collapsible Left Thumbnails + Main Viewport -->
                <div class="ws-pdf-body">
                  <!-- Collapsible Left Thumbnail Sidebar -->
                  <div class="ws-pdf-thumbs-pane" id="ws-pdf-thumbs-pane" style="display:${pdfViewerState.thumbsOpen ? 'flex' : 'none'}; --ws-thumbs-width:${pdfViewerState.thumbsWidth}px;">
                    <div class="ws-pdf-thumbs-sidebar" id="ws-pdf-thumbs-sidebar">
                      <div class="ws-pdf-thumbs-header">
                        <span>PAGES (${pdfViewerState.pdfDoc.numPages})</span>
                      </div>
                      <div class="ws-pdf-thumbs-list" id="ws-pdf-thumbs-list">
                        <!-- Rendered dynamically -->
                      </div>
                    </div>
                    <div class="ws-pdf-thumbs-grip" role="separator" aria-label="Resize PDF thumbnails" aria-orientation="vertical" aria-controls="ws-pdf-thumbs-sidebar" tabindex="0"></div>
                  </div>

                  <aside class="ws-pdf-focus-panel" id="ws-pdf-focus-panel" aria-labelledby="ws-pdf-focus-label" hidden>
                    <h3 id="ws-pdf-focus-label">Focus timer</h3>
                  </aside>

                  <!-- Canvas Viewport -->
                  <div class="ws-pdf-viewport" id="ws-pdf-viewport" tabindex="0" aria-label="PDF viewer">
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
              <div class="ws-floating-indicator" id="ws-floating-indicator" hidden><span>⏱ Timer running in floating window</span><button type="button" class="btn btn-ghost btn-sm" id="ws-return-floating">Return timer</button></div>
              <div class="ws-timer-compact-header">
                <div class="ws-timer-title-line" id="ws-focus-task-title" title="${escapeHtml(currentFocusTask ? currentFocusTask.title : (currentSubject.code || currentSubject.name))}">
                  ${escapeHtml(currentFocusTask ? currentFocusTask.title : (currentSubject.code || currentSubject.name))}
                </div>
                ${activeResource ? `<div class="ws-studying-resource">Studying: ${activeVideo ? '▶' : activeResource.type === 'pdf' ? '📄' : '●'} ${escapeHtml(activeResource.title)}</div>` : ''}
                <button class="btn btn-ghost btn-sm" id="ws-btn-toggle-fullscreen" style="font-size:0.75rem; padding:2px 8px;" title="Focus Fullscreen Mode" aria-pressed="false" aria-label="Enter timer fullscreen">⛶ Fullscreen</button>
                <button class="btn btn-secondary btn-sm" id="ws-btn-float-timer" type="button">Float Timer</button>
              </div>

              <div class="focus-container ws-compact-focus" id="ws-focus-cockpit">
                ${durationPickerMarkup(timer.selectedDurationSeconds)}

                <span class="ws-countdown-label">Time remaining</span>
                <!-- Timer Digits (~36px) -->
                <div class="timer-display ws-compact-timer-display" id="ws-focus-timer-text">${timer.formatTime(true)}</div>

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
                  <button class="btn btn-secondary ws-timer-finish-btn" id="ws-btn-finish-session" hidden>
                    FINISH SESSION
                  </button>
                </div>

                <button class="btn btn-ghost btn-sm" id="ws-btn-reset-timer">Reset</button>

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
                        <option value="" ${!currentFocusTask ? 'selected' : ''}>General ${escapeHtml(currentSubject.code || currentSubject.name)} Study</option>
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
                            ${taskScheduledDate(t) ? `<span class="ws-task-due">Scheduled: ${taskScheduledDate(t)}</span>` : ''}
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
                      const { label, icon } = studyResourceDisplay(r);
                      return `
                        <article class="ws-resource-card ${activeResourceId === r.id ? 'is-active' : ''}" data-resource-id="${escapeHtml(r.id)}">
                          <span class="ws-resource-type">${icon} ${label}</span>
                          <div class="ws-resource-title">${escapeHtml(r.title)}</div>
                          <div class="ws-resource-footer">
                            <button type="button" class="btn btn-secondary btn-sm" data-open-resource="${escapeHtml(r.id)}">Open</button>
                            <button type="button" class="btn btn-ghost btn-sm" data-edit-resource="${escapeHtml(r.id)}">Rename</button>
                            <button type="button" class="btn btn-ghost btn-sm" data-delete-resource="${escapeHtml(r.id)}">Delete</button>
                          </div>
                        </article>
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
    const sourceControls = '#ws-subject-dropdown, #ws-change-resource, #ws-choose-image, #ws-image-input, #ws-choose-pdf, #ws-choose-link, #ws-link-form, #ws-resource-pdf-input, #ws-pdf-file-input, #ws-pdf-file-input-empty, #ws-pdf-close-btn, #ws-web-back, #ws-web-previous, #ws-web-next, #ws-web-url, #ws-web-load, #ws-playlist-prev, #ws-playlist-next, #btn-add-resource, #btn-add-resource-empty, [data-edit-resource], [data-delete-resource], [data-open-resource], .ws-resource-card, #ws-focus-task-picker, [data-action="focus-task"]';
    const workspaceRoot = container.querySelector('.ws-container');
    const preventSourceSwitch = event => {
      if (!floatingTimer.active || !event.target.closest(sourceControls)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.showToast?.('Return the floating timer to switch subjects or resources.');
    };
    for (const type of ['click', 'change', 'keydown', 'submit']) {
      workspaceRoot.addEventListener(type, preventSourceSwitch, true);
    }
    floatingChangeHandler = () => {
      const floating = floatingTimer.active;
      workspaceRoot.classList.toggle('floating-source-locked', floating);
      container.querySelector('#ws-panel-timer').classList.toggle('is-floating', floating);
      container.querySelector('#ws-floating-indicator').hidden = !floating;
      container.querySelector('#ws-subject-dropdown').disabled = floating;
      changeResource.disabled = floating;
      container.querySelector('.viewer-lock').hidden = !floating;
      container.querySelectorAll('[data-viewer-resource], [data-viewer-prev], [data-viewer-next]').forEach(button => { button.disabled = floating; });
      container.querySelector('#ws-btn-float-timer').disabled = floating;
      container.querySelectorAll('.ws-resource-card').forEach(card => card.setAttribute('aria-disabled', String(floating)));
    };
    window.addEventListener('axiom-floating-timer-change', floatingChangeHandler);
    floatingChangeHandler();
    container.querySelector('#ws-return-floating').addEventListener('click', () => floatingTimer.close(true));
    container.querySelector('#ws-btn-float-timer').addEventListener('click', async () => {
      await floatingTimer.open({ subjectId: currentSubject.id, resourceId: activeResourceId });
    });
    function showResourcePicker(show) {
      container.querySelector('.resource-more').open = false;
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
    container.querySelector('#ws-choose-image').addEventListener('click', () => container.querySelector('#ws-image-input').click());
    container.querySelector('#ws-image-input').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (!file || floatingTimer.active) return;
      const generation = viewGeneration;
      try {
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) throw new Error('Choose a supported image file.');
        const bitmap = await createImageBitmap(file);
        bitmap.close();
        const storageId = 'subject-image-' + crypto.randomUUID();
        if (!await savePdfToStorage(storageId, file, file.name)) throw new Error('Could not save the image on this device.');
        const resource = db.addResource({ subjectId: currentSubject.id, title: file.name, type: 'image', fileStorageId: storageId });
        if (generation === viewGeneration) await openResource(resource);
      } catch (error) { window.showToast?.(error.message || 'Could not open this image.'); }
      event.target.value = '';
    });
    const linkForm = container.querySelector('#ws-link-form');
    const linkInput = container.querySelector('#ws-link-url');
    linkInput.addEventListener('input', () => {
      container.querySelector('#ws-link-type').textContent = detectedLinkLabel(linkInput.value);
      container.querySelector('#ws-link-error').textContent = '';
    });
    container.querySelector('#ws-choose-link').addEventListener('click', event => {
      linkForm.hidden = false;
      event.currentTarget.setAttribute('aria-expanded', 'true');
      linkInput.focus();
    });
    linkForm.addEventListener('submit', async event => {
      event.preventDefault();
      const generation = viewGeneration;
      const error = container.querySelector('#ws-link-error');
      const submit = linkForm.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        const resource = await prepareStudyLink(currentSubject.id, linkInput.value, linkForm.elements.namedItem('title').value);
        if (generation !== viewGeneration || floatingTimer.active) return;
        await openResource(db.addResource(resource));
      } catch (failure) {
        error.textContent = failure.message;
        linkInput.focus();
      } finally { submit.disabled = false; }
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

    // Edit Subject Info
    container.querySelector('#ws-add-subject')?.addEventListener('click', addSubject);

    // Add Resource
    const openAddResource = () => {
      showResourcePicker(true);
      picker.scrollIntoView({ block: 'nearest' });
    };
    container.querySelector('#btn-add-resource')?.addEventListener('click', openAddResource);
    container.querySelector('#btn-add-resource-empty')?.addEventListener('click', openAddResource);
    container.querySelectorAll('[data-edit-resource]').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const resource = subjectResources.find(item => item.id === button.dataset.editResource);
      if (resource) showRenameResourceModal(resource, render);
    }));

    // Delete Resource
    container.querySelectorAll('[data-delete-resource]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const resId = e.currentTarget.getAttribute('data-delete-resource');
        if (confirm('Remove this resource from the subject workspace?')) {
          const resource = db.getResources().find(item => item.id === resId);
          if (resource?.fileStorageId || resource?.type === 'pdf') await deletePdfFromStorage(resource.fileStorageId || resource.pdfStorageId || resId);
          db.deleteResource(resId);
          if (activeResourceId === resId) {
            activeResourceId = '__none__';
            db.setLastResourceId(currentSubject.id, null);
            if (resource?.type === 'pdf') {
              pdfViewerState.pdfDoc?.destroy?.();
              pdfViewerState.pdfDoc = null;
            }
          }
          render();
        }
      });
    });

    async function openResource(resource) {
      if (floatingTimer.active || !resource || selectedSubjectId !== currentSubject.id) return;
      // Save the outgoing video's position before recording the new resource.
      disposeVideo?.();
      disposeVideo = null;
      activeResourceId = resource.id;
      db.setLastResourceId(currentSubject.id, resource.id);
      db.recordStudyActivity({ type: studyResourceDisplay(resource).icon === '▶' ? 'youtube_watch' : 'resource_open', subjectId: currentSubject.id, subjectCode: currentSubject.code, resourceId: resource.id, pdfFilename: resource.type === 'pdf' ? resource.title : null });
      if (studyResourceDisplay(resource).icon === '▶') {
        render();
        return;
      }
      if (resource.type !== 'pdf') {
        render();
        return;
      }
      const generation = viewGeneration;
      const storedBlob = await getPdfFromStorage(resource.pdfStorageId || resource.id);
      if (generation !== viewGeneration || activeResourceId !== resource.id) return;
      if (storedBlob) await loadPdfDocument(storedBlob, resource.title || 'Document', currentSubject.id);
      else if (resource.pdfDataUrl) await loadPdfDocument(resource.pdfDataUrl, resource.title || 'Document', currentSubject.id);
      else if (resource.url) await loadPdfDocument(resource.url, resource.title || 'Document', currentSubject.id);
      else window.showToast?.('No PDF document data found for this resource.');
    }

    if (activeImage) {
      const image = container.querySelector('#ws-study-image');
      const status = container.querySelector('#ws-image-status');
      let disposed = false;
      let objectUrl;
      disposeImage = () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
      getPdfFromStorage(activeImage.fileStorageId || activeImage.id).then(blob => {
        if (disposed) return;
        if (!blob) { status.textContent = 'This image is unavailable on this device. Upload it again.'; return; }
        objectUrl = URL.createObjectURL(blob);
        image.onload = () => { image.hidden = false; status.hidden = true; };
        image.onerror = () => { status.textContent = 'Could not display this image.'; };
        image.src = objectUrl;
      }).catch(() => { if (!disposed) status.textContent = 'Could not load this image.'; });

    }
    if (activeWeb) {
      const frame = container.querySelector('#ws-web-frame');
      const status = container.querySelector('#ws-web-status');
      let navigation = webNavigation.get(activeWeb.id);
      if (!navigation) {
        navigation = { entries: [activeWeb.url], index: 0 };
        webNavigation.set(activeWeb.id, navigation);
      }
      const visit = url => {
        frame.src = embeddableResourceUrl(url);
        container.querySelector('#ws-web-url').value = url;
        container.querySelector('#ws-web-external').href = url;
        container.querySelector('#ws-web-previous').disabled = navigation.index === 0;
        container.querySelector('#ws-web-next').disabled = navigation.index === navigation.entries.length - 1;
        status.textContent = 'Loading resource…';
      };
      visit(navigation.entries[navigation.index]);
      frame.addEventListener('load', () => { status.textContent = 'If this site does not appear, use Open in New Tab.'; });
      setTimeout(() => {
        if (status.isConnected && status.textContent === 'Loading resource…') {
          status.textContent = 'This site may block embedding. Use Open in New Tab if it does not appear.';
        }
      }, 8000);
      container.querySelector('#ws-web-refresh').addEventListener('click', () => { status.textContent = 'Loading resource…'; frame.src = frame.src; });
      container.querySelector('#ws-web-previous').addEventListener('click', () => { if (navigation.index > 0) visit(navigation.entries[--navigation.index]); });
      container.querySelector('#ws-web-next').addEventListener('click', () => { if (navigation.index < navigation.entries.length - 1) visit(navigation.entries[++navigation.index]); });
      container.querySelector('#ws-web-back').addEventListener('click', () => container.querySelector('#ws-change-resource').click());

      const load = () => {
        const url = safeResourceUrl(container.querySelector('#ws-web-url').value.trim());
        if (!url) { status.textContent = 'Enter a valid HTTP or HTTPS URL.'; return; }
        navigation.entries.splice(navigation.index + 1);
        navigation.entries.push(url);
        navigation.index = navigation.entries.length - 1;
        visit(url);
      };
      container.querySelector('#ws-web-load').addEventListener('click', load);
      container.querySelector('#ws-web-url').addEventListener('keydown', event => { if (event.key === 'Enter') load(); });
    }

    container.querySelectorAll('.ws-resource-card').forEach(card => card.addEventListener('click', event => {
      if (!event.target.closest('button')) openResource(subjectResources.find(resource => resource.id === card.dataset.resourceId));
    }));

    // Open the saved resource in its viewer
    container.querySelectorAll('[data-open-resource]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const resId = e.currentTarget.dataset.openResource;
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
      if (confirm(`Remove ${completedTasks.length} completed task(s) from ${currentSubject.code || currentSubject.name}?`)) {
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
      const finishBtn = container.querySelector('#ws-btn-finish-session');
      if (finishBtn) finishBtn.hidden = !['running', 'paused'].includes(timer.state);
      const badge = container.querySelector('#ws-focus-sub-badge');

      if (timerText) {
        timerText.textContent = timer.formatTime(true);
        timerText.classList.toggle('running', timer.state === 'running');
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

    durationPicker = mountDurationPicker(container, timer, updateFocusDisplay);
    const applyDuration = () => durationPicker.apply();
    container.querySelector('#ws-btn-reset-timer')?.addEventListener('click', () => {
      timer.reset();
      durationPicker.sync();
      updateFocusDisplay();
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

    // Start / Pause
    container.querySelector('#ws-btn-start-pause')?.addEventListener('click', () => {
      if (timer.state === 'running') {
        timer.pause();
        updateFocusDisplay();
      } else {
        if (timer.state === 'paused' && timer.selectedSubjectId !== currentSubject.id) {
          window.showToast?.('Resume this session from its original subject, or finish it before starting another.');
          return;
        }
        if (!applyDuration()) { durationPicker.focus(); return; }
        const task = timer.selectedTaskId ? db.getTaskById(timer.selectedTaskId) : null;
        timer.setContext(currentSubject.id, null, task?.subjectId === currentSubject.id ? task.id : null);
        timer.start();
        updateFocusDisplay();
      }
    });

    // Finish Session
    container.querySelector('#ws-btn-finish-session')?.addEventListener('click', () => {
      if (timer.state === 'running' || timer.state === 'paused') {
        const durationSeconds = timer.getElapsedSeconds();
        timer.stopEarly();
        window.focusApp.showSessionCompletionModal({
          durationSeconds,
          subjectId: timer.selectedSubjectId,
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

    // Keep the exit control inside the fullscreen panel, never behind the timer.
    const setTimerFullscreen = (enabled) => {
      isFullscreen = enabled;
      const layout = container.querySelector('#ws-reader-layout');
      layout?.classList.toggle('ws-focus-fullscreen', enabled);
      const btn = container.querySelector('#ws-btn-toggle-fullscreen');
      if (btn) {
        btn.textContent = enabled ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
        btn.setAttribute('aria-pressed', String(enabled));
        btn.setAttribute('aria-label', enabled ? 'Exit timer fullscreen' : 'Enter timer fullscreen');
      }
      if (pdfIsOpen) setTimeout(() => {
        if (pdfViewerState.fitMode === 'width') applyFitWidth();
        else if (pdfViewerState.fitMode === 'page') applyFitPage();
      }, 80);
    };
    container.querySelector('#ws-btn-toggle-fullscreen')?.addEventListener('click', () => {
      setTimerFullscreen(!isFullscreen);
    });
    timerFullscreenKeyHandler = (e) => {
      if (e.key === 'Escape' && isFullscreen) setTimerFullscreen(false);
    };
    document.addEventListener('keydown', timerFullscreenKeyHandler);

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
      db.setLastResourceId(currentSubject.id, null);
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

    const pdfPanel = container.querySelector('#ws-pdf-viewer-section');
    const pdfTimerButton = container.querySelector('#ws-pdf-timer-toggle');
    const pdfTimerPanel = container.querySelector('#ws-pdf-focus-panel');
    const timerCockpit = container.querySelector('#ws-focus-cockpit');
    const timerHome = timerCockpit.parentElement;

    function syncPdfFullscreen() {
      const fullscreen = viewerFullscreen;
      const showTimer = fullscreen && pdfTimerVisible;
      pdfPanel.classList.toggle('fullscreen', fullscreen);
      pdfPanel.querySelector('[data-viewer-timer]').hidden = !pdfIsOpen;
      pdfPanel.classList.toggle('resource-fullscreen', fullscreen);
      pdfPanel.querySelector('[data-viewer-fullscreen]').textContent = fullscreen ? 'Exit Fullscreen' : 'Fullscreen';
      if (!pdfTimerButton || !pdfTimerPanel) return;
      const timerLabel = showTimer ? 'Hide timer' : 'Show timer';
      pdfTimerButton.title = timerLabel;
      pdfTimerButton.setAttribute('aria-label', timerLabel);
      pdfTimerButton.setAttribute('aria-expanded', String(showTimer));
      pdfTimerPanel.hidden = !showTimer;
      // Move the same controls so their listeners and timer state are shared.
      const target = fullscreen ? pdfTimerPanel : timerHome;
      if (timerCockpit.parentElement !== target) target.append(timerCockpit);
      if (!fullscreen || showTimer) durationPicker.sync();
    }

    function refitPdf() {
      if (pdfViewerState.fitMode === 'width') applyFitWidth();
      else if (pdfViewerState.fitMode === 'page') applyFitPage();
    }

    function setPdfFullscreen(enabled) {
      viewerFullscreen = enabled;
      syncPdfFullscreen();
      if (pdfIsOpen) refitPdf();
    }

    syncPdfFullscreen();
    disposeNavigation = mountResourceNavigation(pdfPanel, {
      resources: subjectResources, activeId: activeResourceId, imageStates,
      fullscreen: () => viewerFullscreen,
      setFullscreen: enabled => { setPdfFullscreen(enabled); pdfPanel.focus({ preventScroll: true }); },
      locked: () => floatingTimer.active,
      open: openResource,
      zoomPdf: direction => container.querySelector(direction > 0 ? '#ws-pdf-zoom-in-btn' : '#ws-pdf-zoom-out-btn')?.click()
    });

    pdfPanel.querySelector('[data-viewer-timer]').addEventListener('click', () => pdfTimerButton?.click());
    pdfTimerButton?.addEventListener('click', () => {
      pdfTimerVisible = !pdfTimerVisible;
      syncPdfFullscreen();
      refitPdf();
    });

    // Toggle Thumbnail Sidebar
    container.querySelector('#ws-pdf-thumbs-btn')?.addEventListener('click', () => {
      const sidebar = container.querySelector('#ws-pdf-thumbs-pane');
      const btn = container.querySelector('#ws-pdf-thumbs-btn');
      if (!sidebar) return;
      const isOpen = sidebar.style.display !== 'none';
      sidebar.style.display = isOpen ? 'none' : 'flex';
      pdfViewerState.thumbsOpen = !isOpen;
      if (btn) {
        btn.classList.toggle('active', !isOpen);
        btn.setAttribute('aria-expanded', String(!isOpen));
      }

      if (!isOpen && !container.querySelector('#ws-pdf-thumbs-list')?.children.length) {
        generateThumbnails();
      }
    });

    const thumbsPane = container.querySelector('#ws-pdf-thumbs-pane');
    const thumbsGrip = thumbsPane?.querySelector('.ws-pdf-thumbs-grip');
    if (thumbsGrip) {
      const resize = width => {
        pdfViewerState.thumbsWidth = Math.max(80, Math.min(320, width));
        thumbsPane.style.setProperty('--ws-thumbs-width', pdfViewerState.thumbsWidth + 'px');
      };
      thumbsGrip.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        thumbsGrip.setPointerCapture(event.pointerId);
      });
      thumbsGrip.addEventListener('pointermove', event => {
        if (!thumbsGrip.hasPointerCapture(event.pointerId)) return;
        resize(event.clientX - thumbsPane.getBoundingClientRect().left);
      });
      thumbsGrip.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        event.stopPropagation();
        resize(thumbsPane.offsetWidth + (event.key === 'ArrowLeft' ? -16 : 16));
      });
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

      // Scale the visible bitmap during the gesture, then redraw it sharply.
      let wheelZoomTimer;
      pdfViewport.addEventListener('wheel', (e) => {
        if (!(e.ctrlKey || e.metaKey) || !pdfViewerState.pdfDoc) return;
        e.preventDefault();

        const oldScale = pdfViewerState.scale;
        const unitPixels = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? pdfViewport.clientHeight : 1;
        const wheelPixels = Math.max(-100, Math.min(100, e.deltaY * unitPixels));
        const newScale = Math.max(0.25, Math.min(5, oldScale * Math.pow(1.4, -wheelPixels / 100)));
        if (newScale === oldScale) return;

        const canvas = pdfViewport.querySelector('.ws-pdf-page-canvas');
        if (canvas) {
          const before = canvas.getBoundingClientRect();
          const ratio = newScale / oldScale;
          canvas.style.width = (before.width * ratio) + 'px';
          canvas.style.height = (before.height * ratio) + 'px';
          const after = canvas.getBoundingClientRect();
          pdfViewport.scrollLeft += after.left + (e.clientX - before.left) * ratio - e.clientX;
          pdfViewport.scrollTop += after.top + (e.clientY - before.top) * ratio - e.clientY;
        }

        pdfViewerState.scale = newScale;
        pdfViewerState.fitMode = 'free';
        syncPdfToolbar();

        clearTimeout(wheelZoomTimer);
        wheelZoomTimer = setTimeout(() => {
          if (pdfViewport.isConnected && pdfViewerState.scale === newScale) renderCurrentPdfPage(true);
        }, 120);
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
      if (viewerFullscreen && e.target.closest('#ws-pdf-viewer-section') && !e.target.closest('.ws-pdf-viewport, #ws-pdf-topbar')) return;
      if (!pdfIsOpen || !picker.hidden || e.defaultPrevented || e.target.closest('dialog')) return;
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select'].includes(activeTag) || document.activeElement?.isContentEditable) {
        return; // Don't intercept while typing in forms
      }
      // Escape: Exit fullscreen or dismiss search
      if (e.key === 'Escape') {
        if (viewerFullscreen) {
          setPdfFullscreen(false);
          pdfPanel.querySelector('[data-viewer-fullscreen]').focus();
        }
        return;
      }

      if (e.target.closest('#ws-focus-cockpit')) return;

      // Space pans the document, while focused buttons retain keyboard activation.
      if ((e.key === ' ' || e.code === 'Space') && !e.target.closest('button, a')) {
        pdfViewerState.spaceDown = true;
        if (!pdfViewport.classList.contains('is-dragging')) pdfViewport.style.cursor = 'grab';
        e.preventDefault();
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

    async function renderCurrentPdfPage(keepPreview = false) {
      if (!pdfViewerState.pdfDoc) return;

      const currentSeq = ++pdfViewerState.renderSequence;
      pdfViewerState.rendering = true;
      showPdfLoading(!keepPreview);

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
        const renderScale = pdfViewerState.scale;
        const viewport = page.getViewport({ scale: renderScale * dpr });

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
        if (renderScale !== pdfViewerState.scale) return;
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
        const pageWidth = page.getViewport({ scale: 1 }).width;
        const vp = page.getViewport({ scale: 480 / pageWidth });

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
        pdfViewerState.resourceId = resourceId;
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

    async function handlePdfFileUpload(file, subjectId) {
      if (floatingTimer.active) return;
      const generation = viewGeneration;
      try {
        const resource = await saveStudyPdf(subjectId, file);
        if (generation === viewGeneration) await openResource(resource);
      } catch (error) { window.showToast?.(error.message); }
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
function studyResourceDisplay(resource) {
  const parsed = parseYouTubeResource(resource.url || resource.youtubeUrl || '');
  if (resource.type === 'image') return { label: 'Image', icon: '🖼' };
  if (resource.type === 'pdf') return { label: 'PDF', icon: '📄' };
  if (resource.playlistId || parsed?.playlistId || ['playlist', 'youtube_playlist'].includes(resource.type)) return { label: 'YouTube Playlist', icon: '▶' };
  if (resourceVideoId(resource) || ['youtube', 'youtube_video'].includes(resource.type)) {
    const original = resource.url || resource.youtubeUrl || '';
    const short = parsed && new URL(safeResourceUrl(original) || 'https://' + original).pathname.startsWith('/shorts/');
    return { label: short ? 'YouTube Short' : 'YouTube Video', icon: '▶' };
  }
  return { label: 'Website', icon: '🔗' };
}

function detectedLinkLabel(value) {
  const url = value.trim();
  return safeResourceUrl(url) || parseYouTubeResource(url) ? studyResourceDisplay({ url }).label : '';
}

async function prepareStudyLink(subjectId, value, name = '') {
  const original = value.trim();
  const parsed = parseYouTubeResource(original);
  const url = safeResourceUrl(original) || (parsed ? safeResourceUrl('https://' + original) : null);
  if (!url) throw new Error('Enter a valid HTTP or HTTPS link.');
  const domain = new URL(url).hostname.replace(/^www\./, '');
  const type = parsed?.playlistId ? 'youtube_playlist' : parsed?.videoId ? 'youtube_video' : 'website';
  let title = name.trim();
  if (!title && parsed?.videoId && !parsed.playlistId) {
    try {
      const metadata = new URL('https://www.youtube.com/oembed');
      metadata.searchParams.set('url', parsed.url);
      const response = await fetch(metadata, { signal: AbortSignal.timeout(1500) });
      if (response.ok) title = (await response.json()).title?.trim() || '';
    } catch { /* A link can still be saved when metadata is unavailable. */ }
  }
  if (!title) title = parsed?.playlistId ? 'YouTube Playlist · ' + parsed.playlistId :
    parsed?.videoId ? 'YouTube Video · ' + parsed.videoId : domain;
  return { ...parsed, title, type, url: safeResourceUrl(original) ? original : url, domain, subjectId, dateAdded: new Date().toISOString() };
}

async function saveStudyPdf(subjectId, file) {
  if (!file || !(await file.slice(0, 1024).text()).includes('%PDF-')) throw new Error('Choose a valid PDF file.');
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  const fingerprint = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const existing = db.getResources().find(resource => resource.subjectId === subjectId && resource.pdfFingerprint === fingerprint);
  if (existing && await getPdfFromStorage(existing.pdfStorageId || existing.id)) return existing;
  const pdfStorageId = existing ? existing.pdfStorageId || existing.id : 'subject-pdf-' + crypto.randomUUID();
  if (!await savePdfToStorage(pdfStorageId, file, file.name)) throw new Error('The PDF could not be saved on this device.');
  if (existing) return existing;
  const resource = db.addResource({
    subjectId, type: 'pdf', title: file.name, pdfFileName: file.name, hasPdfFile: true, pdfStorageId,
    pdfFingerprint: fingerprint, dateAdded: new Date().toISOString()
  });
  if (resource.pdfStorageId !== pdfStorageId) await deletePdfFromStorage(pdfStorageId);
  return resource;
}

function showAddWorkspaceSubject(onComplete) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal';
  dialog.setAttribute('aria-labelledby', 'ws-add-subject-title');
  dialog.innerHTML = `
    <form>
      <div class="modal-header"><h3 id="ws-add-subject-title">Add Subject</h3></div>
      <div class="modal-body">
        <label class="form-group">
          <span class="form-label">Subject name</span>
          <input name="name" required autofocus>
        </label>
        <p>You can edit subject details in Grades.</p>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-secondary">Cancel</button>
        <button type="submit" class="btn btn-primary">Add Subject</button>
      </div>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const nameInput = form.elements.namedItem('name');
  nameInput.addEventListener('input', () => nameInput.setCustomValidity(''));
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('button[type="button"]').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.setCustomValidity('Enter a subject name.');
      nameInput.reportValidity();
      return;
    }
    const period = db.getAcademicPeriod();
    const existing = db.getSubjects().find(subject => {
      const own = db.getSubjectPeriod(subject);
      return subject.name?.trim().toLowerCase() === name.toLowerCase() &&
        own.semester === period.semester && own.schoolYear === period.schoolYear;
    });
    const subject = existing || db.addSubject({ name, code: '', color: '#38bdf8', icon: '📚', grades: {} });
    dialog.close();
    onComplete(subject);
  });
  dialog.showModal();
}

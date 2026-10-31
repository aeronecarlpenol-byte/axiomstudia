import { GRADE_WEIGHTS } from './grading.js';
/**
 * Axiom Studia — Academic Operating System Database & State Management
 * Starts with an empty workspace and stores each user's entries in this browser.
 */

const STORAGE_KEY = 'axiom_studia_database_v16';
const REMOVED_FEATURE_KEYS = ['formulas', 'textbooks', 'inboxItems', 'habits', 'stoicQuotes', 'motivationReminders'];
const DEFAULT_GRADING_SYSTEM = {
  minimum: 0, maximum: 10, passing: 5, direction: 'higher',
  weights: GRADE_WEIGHTS
};

function cleanWorkspace(data) {
  REMOVED_FEATURE_KEYS.forEach(key => delete data[key]);
  data.gradingSystem = { ...DEFAULT_GRADING_SYSTEM, ...(data.gradingSystem || {}),
    weights: GRADE_WEIGHTS };
  return data;
}
const FRESH_START_KEY = 'axiom_studia_fresh_start_v1';
const OLD_LOCAL_KEYS = [
  'axiom_study_activity',
  'axiom_pdf_progress',
  'axiom_pdf_bookmarks',
  'axiom_reader_sidebar_hidden',
  'axiom_reader_sidebar_width'
];

function clearPreviousWorkspace() {
  try {
    if (!localStorage.getItem(FRESH_START_KEY)) {
      const keys = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (key?.startsWith('axiom_studia_database_') || OLD_LOCAL_KEYS.includes(key)) keys.push(key);
      }
      keys.forEach(key => localStorage.removeItem(key));
      localStorage.setItem(FRESH_START_KEY, 'pdf-pending');
    }

    if (localStorage.getItem(FRESH_START_KEY) === 'pdf-pending') {
      if (typeof indexedDB === 'undefined') {
        localStorage.setItem(FRESH_START_KEY, 'done');
      } else {
        const request = indexedDB.deleteDatabase('axiom_pdf_store');
        request.onsuccess = () => localStorage.setItem(FRESH_START_KEY, 'done');
        request.onerror = () => console.warn('Old PDFs could not be removed; cleanup will retry on the next visit.');
        request.onblocked = () => console.warn('Close other Axiom Studia tabs to finish removing old PDFs.');
      }
    }
  } catch (error) {
    console.warn('Could not clear previous workspace data:', error);
  }
}

// Existing browser data is the user's workspace. Never clear it during startup.
const INITIAL_DATABASE = {
  version: 16,
  userProfile: {
    name: '',
    preferredName: '',
    studentId: '',
    school: '',
    major: '',
    term: '',
    schoolYear: '',
    semester: '',
    dailyFocusGoalMinutes: 240,
    theme: 'dark',
    purposeStatement: ''
  },
  subjects: [],
  topics: [],
  tasks: [],
  resources: [],
  focusSessions: [],
  exams: [],
  examWeekSchedule: [],
  holidays: [],
  examWeeks: [],
  gradeDeadlines: [],
  academicEvents: [],
  gradingSystem: DEFAULT_GRADING_SYSTEM,
  meditationSessions: [],
  controlItems: { within: [], outside: [] },
  voluntaryDiscomforts: [],
  stoicReflections: [],
  stoicJournals: [],
  morningReflections: [],
  eveningReflections: [],
  mentalCheckIns: [],
  stoicLessons: [],
  dailyReflections: []
};

class Database {
  constructor() {
    this.subscribers = new Set();
    this.data = this.load();
  }

  load() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && Array.isArray(parsed.subjects) && Array.isArray(parsed.tasks)) {
          const hadRemovedData = REMOVED_FEATURE_KEYS.some(key => key in parsed);
          cleanWorkspace(parsed);
          if (hadRemovedData) this.save(parsed);
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Could not read local data; starting a fresh workspace', e);
    }
    const cloned = JSON.parse(JSON.stringify(INITIAL_DATABASE));
    this.save(cloned);
    return cloned;
  }

  save(data = this.data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      this.notify();
    } catch (e) {
      console.error("Failed to save database to localStorage", e);
    }
  }

  reset() {
    this.data = JSON.parse(JSON.stringify(INITIAL_DATABASE));
    this.save();
    return this.data;
  }

  exportJSON() {
    return JSON.stringify(this.data, null, 2);
  }

  importJSON(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      if (!parsed.subjects || !parsed.tasks) {
        throw new Error("Invalid Axiom Studia backup file.");
      }
      this.data = cleanWorkspace(parsed);
      this.save();
      return true;
    } catch (e) {
      console.error("Failed to import database", e);
      return false;
    }
  }

  subscribe(listener) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  notify() {
    for (const listener of this.subscribers) {
      try {
        listener(this.data);
      } catch (err) {
        console.error("Subscriber notification error", err);
      }
    }
  }

  // --- Entities Read/Write Helpers ---

  // User Profile
  getUserProfile() { return this.data.userProfile; }
  getAcademicPeriod(profile = this.getUserProfile() || {}) {
    const semester = String(profile.semester || profile.term || '');
    const match = semester.match(/\b([123])(?:st|nd|rd)?\b/i);
    const labels = ['1st Semester', '2nd Semester', '3rd Semester'];
    return {
      semester: match ? labels[Number(match[1]) - 1] : semester,
      schoolYear: profile.schoolYear || semester.match(/\b\d{4}\s*[–—-]\s*\d{4}\b/)?.[0] || ''
    };
  }
  updateUserProfile(updates) {
    const previous = this.getAcademicPeriod();
    const next = this.getAcademicPeriod({ ...this.data.userProfile, ...updates });
    if (previous.semester !== next.semester || previous.schoolYear !== next.schoolYear) {
      // Legacy grades were implicitly tied to the old profile. Record that
      // association once, before changing the selected academic period.
      this.data.subjects.forEach(subject => {
        if (!subject.academicPeriod && Object.values(subject.grades || {}).some(value => value !== null && value !== undefined && value !== '')) {
          subject.academicPeriod = this.getAcademicPeriod({
            semester: subject.semester ?? previous.semester,
            schoolYear: subject.schoolYear ?? previous.schoolYear
          });
        }
      });
    }
    this.data.userProfile = { ...this.data.userProfile, ...updates };
    this.save();
  }

  getGradingSystem() { return this.data.gradingSystem || DEFAULT_GRADING_SYSTEM; }
  updateGradingSystem(settings) {
    const previous = this.getGradingSystem();
    if (!(settings.maximum > settings.minimum) || !Number.isFinite(settings.passing) || settings.passing < settings.minimum || settings.passing > settings.maximum) return;
    if (previous.minimum !== settings.minimum || previous.maximum !== settings.maximum || previous.direction !== settings.direction) {
      const convert = value => {
        if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value))) return value;
        let normalized = (Number(value) - previous.minimum) / (previous.maximum - previous.minimum);
        if (previous.direction !== settings.direction) normalized = 1 - normalized;
        return settings.minimum + normalized * (settings.maximum - settings.minimum);
      };
      this.data.subjects.forEach(subject => {
        if (subject.grades) subject.grades = Object.fromEntries(Object.entries(subject.grades).map(([term, value]) => [term, convert(value)]));
        if (subject.targetGrade !== undefined) subject.targetGrade = convert(subject.targetGrade);
        if (subject.gradePlanner?.planned) subject.gradePlanner = { ...subject.gradePlanner,
          planned: Object.fromEntries(Object.entries(subject.gradePlanner.planned).map(([term,value]) => [term,convert(value)])) };
      });
    }
    this.data.gradingSystem = { ...settings, weights: GRADE_WEIGHTS };
    this.save();
  }

  // Subjects
  getSubjects() { return this.data.subjects; }
  getSubjectById(id) { return this.data.subjects.find(s => s.id === id); }
  addSubject(subject) {
    subject.id = 'sub-' + Date.now();
    subject.academicPeriod ??= this.getAcademicPeriod();
    this.data.subjects.push(subject);
    this.save();
    return subject;
  }
  updateSubject(id, updates) {
    const idx = this.data.subjects.findIndex(s => s.id === id);
    if (idx !== -1) {
      if (updates.grades && !this.data.subjects[idx].academicPeriod) {
        const subject = this.data.subjects[idx];
        subject.academicPeriod = this.getAcademicPeriod({
          semester: subject.semester ?? this.getAcademicPeriod().semester,
          schoolYear: subject.schoolYear ?? this.getAcademicPeriod().schoolYear
        });
      }
      this.data.subjects[idx] = { ...this.data.subjects[idx], ...updates };
      this.save();
    }
  }
  deleteSubject(id) {
    this.data.subjects = this.data.subjects.filter(s => s.id !== id);
    this.data.topics = this.data.topics.filter(t => t.subjectId !== id);
    this.data.tasks = this.data.tasks.filter(t => t.subjectId !== id);
    this.save();
  }
  clearSubjects() {
    const count = this.data.subjects.length;
    this.data.subjects = [];
    this.data.topics = [];
    this.data.tasks = [];
    this.save();
    return count;
  }

  // Topics
  getTopics(subjectId = null) {
    if (subjectId) return this.data.topics.filter(t => t.subjectId === subjectId);
    return this.data.topics;
  }
  clearTopics(subjectId = null) {
    let count = 0;
    if (subjectId) {
      count = this.data.topics.filter(t => t.subjectId === subjectId).length;
      this.data.topics = this.data.topics.filter(t => t.subjectId !== subjectId);
    } else {
      count = this.data.topics.length;
      this.data.topics = [];
    }
    this.save();
    return count;
  }
  getTopicById(id) { return this.data.topics.find(t => t.id === id); }
  addTopic(topic) {
    topic.id = 'top-' + Date.now();
    topic.mastery = topic.mastery || 3;
    topic.reviewStatus = topic.reviewStatus || 'developing';
    this.data.topics.push(topic);
    this.save();
    return topic;
  }
  updateTopic(id, updates) {
    const idx = this.data.topics.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.data.topics[idx] = { ...this.data.topics[idx], ...updates };
      this.save();
    }
  }

  // Tasks
  getTasks() { return this.data.tasks; }
  getTaskById(id) { return this.data.tasks.find(t => t.id === id); }
  getTasksBySubject(subjectId) { return this.data.tasks.filter(t => t.subjectId === subjectId); }
  getOverdueTasks() {
    const now = Date.now();
    return this.data.tasks.filter(t => t.status !== 'completed' && t.deadline && new Date(t.deadline).getTime() < now);
  }

  getTodayDate(d = new Date()) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  isSameLocalDate(dateInput, targetDateStr = this.getTodayDate()) {
    if (!dateInput) return false;
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return false;
    return this.getTodayDate(d) === targetDateStr;
  }

  getTasksDueToday() {
    const today = this.getTodayDate();
    return this.data.tasks.filter(t => t.status !== 'completed' && t.deadline && this.isSameLocalDate(t.deadline, today));
  }
  getTasksDueIn(days) {
    const now = Date.now();
    const cutoff = now + days * 86400000;
    return this.data.tasks.filter(t => {
      if (t.status === 'completed' || !t.deadline) return false;
      const d = new Date(t.deadline).getTime();
      return d >= now && d <= cutoff;
    });
  }
  getTaskDeadlineStatus(task) {
    if (!task) return 'no_deadline';
    if (task.status === 'completed') return 'completed';
    if (!task.deadline) return 'no_deadline';

    const deadlineDate = new Date(task.deadline);
    if (isNaN(deadlineDate.getTime())) return 'no_deadline';

    const now = new Date();
    // Midnight comparison in local time
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const deadlineDayMidnight = new Date(deadlineDate.getFullYear(), deadlineDate.getMonth(), deadlineDate.getDate()).getTime();
    const diffDays = Math.round((deadlineDayMidnight - todayMidnight) / 86400000);

    // Exact moment comparison for overdue vs today
    if (deadlineDate.getTime() < now.getTime()) {
      if (diffDays === 0) return 'due_today'; // still due today even if past current hour
      return 'overdue';
    }
    if (diffDays === 0) return 'due_today';
    if (diffDays === 1) return 'due_tomorrow';
    return 'upcoming';
  }

  // --- Study Activity Tracking for Continue Studying ---
  getStudyActivity() {
    try {
      const stored = localStorage.getItem('axiom_study_activity');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) {
      console.warn('Failed to read study activity', e);
    }
    return null;
  }

  recordStudyActivity(activity) {
    if (!activity || !activity.type) return;
    try {
      const current = this.getStudyActivity() || {};
      const updated = {
        ...(current.subjectId === activity.subjectId ? current : {}),
        ...activity,
        updatedAt: Date.now()
      };
      localStorage.setItem('axiom_study_activity', JSON.stringify(updated));
    } catch (e) {
      console.warn('Failed to record study activity', e);
    }
  }

  getContinueStudyingDestination() {
    // 1. Check explicitly recorded study activity (e.g. last opened PDF, task, or subject)
    const recorded = this.getStudyActivity();
    if (recorded && recorded.subjectId) {
      const subject = this.getSubjectById(recorded.subjectId);
      if (subject) {
        // If resource is specified, check if it still exists
        let validResource = null;
        if (recorded.resourceId) {
          const res = (this.getResources() || []).find(r => r.id === recorded.resourceId);
          if (res && res.subjectId === subject.id) validResource = res;
        }
        return {
          subject,
          resource: validResource,
          pdfFilename: validResource?.type === 'youtube' ? null : (recorded.pdfFilename || (validResource ? validResource.title : null)),
          playbackPosition: validResource?.lastPlaybackPosition || 0,
          page: recorded.page || 1,
          scale: recorded.scale || 1.0,
          taskId: recorded.taskId || null,
          reason: validResource?.type === 'youtube' ? 'Continue Lecture' : recorded.pdfFilename || validResource ? 'Continue Document Reading' : 'Resume Subject Workspace',
          source: 'recorded'
        };
      }
    }

    // 2. Check latest focus session
    const sessions = this.getFocusSessions() || [];
    if (sessions.length > 0) {
      const latest = sessions[0];
      if (latest && latest.subjectId) {
        const subject = this.getSubjectById(latest.subjectId);
        if (subject) {
          const task = latest.taskId ? this.getTaskById(latest.taskId) : null;
          return {
            subject,
            task,
            taskId: task?.id || null,
            reason: task ? `Continue: ${task.title}` : `Study ${subject.code}`,
            source: 'session'
          };
        }
      }
    }

    // 3. Check most urgent pending task
    const overdue = this.getOverdueTasks();
    if (overdue.length > 0) {
      const task = overdue[0];
      const subject = this.getSubjectById(task.subjectId);
      if (subject) {
        return {
          subject,
          task,
          taskId: task.id,
          reason: `Overdue Priority: ${task.title}`,
          source: 'overdue_task'
        };
      }
    }

    const todayTasks = this.getTasksDueToday();
    if (todayTasks.length > 0) {
      const task = todayTasks[0];
      const subject = this.getSubjectById(task.subjectId);
      if (subject) {
        return {
          subject,
          task,
          taskId: task.id,
          reason: `Due Today: ${task.title}`,
          source: 'today_task'
        };
      }
    }

    // 4. Default to primary subject
    const subjects = this.getSubjects();
    if (subjects.length > 0) {
      const primary = subjects[0];
      return {
        subject: primary,
        reason: `Open ${primary.code} Workspace`,
        source: 'default'
      };
    }

    return null;
  }
  getProgressSummary() {
    const today = this.getTodayDate();
    const todaySessions = this.data.focusSessions.filter(s => s.startTime && this.isSameLocalDate(s.startTime, today));
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    const weekSessions = this.data.focusSessions.filter(s => s.startTime && new Date(s.startTime).getTime() >= sevenDaysAgo);
    const studyTimeTodayMins = todaySessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
    const studyTimeWeekMins = weekSessions.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
    const allTasks = this.data.tasks;
    const completedToday = allTasks.filter(t => t.status === 'completed' && (!t.completedAt || this.isSameLocalDate(t.completedAt, today))).length;
    const totalActive = allTasks.filter(t => t.status !== 'completed').length;
    const subjectProgress = this.data.subjects.map(sub => {
      const subTasks = allTasks.filter(t => t.subjectId === sub.id);
      const done = subTasks.filter(t => t.status === 'completed').length;
      return { subjectId: sub.id, code: sub.code, color: sub.color, total: subTasks.length, done };
    }).filter(sp => sp.total > 0);
    return { completedToday, totalActive, studyTimeTodayMins, studyTimeWeekMins, subjectProgress };
  }
  addTask(task) {
    task.id = 'task-' + Date.now();
    task.status = task.status || 'not_started';
    task.subtasks = task.subtasks || [];
    task.submissionChecklist = task.submissionChecklist || [];
    task.externalLinks = task.externalLinks || [];
    task.attachedResources = task.attachedResources || [];
    task.taskType = task.taskType || 'assignment';
    task.notes = task.notes || '';
    this.data.tasks.unshift(task);
    this.save();
    return task;
  }
  updateTask(id, updates) {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx !== -1) {
      this.data.tasks[idx] = { ...this.data.tasks[idx], ...updates };
      this.save();
    }
  }
  deleteTask(id) {
    this.data.tasks = this.data.tasks.filter(t => t.id !== id);
    this.save();
  }

  clearCompletedTasks() {
    const beforeCount = this.data.tasks.length;
    this.data.tasks = this.data.tasks.filter(t => t.status !== 'completed');
    this.save();
    return beforeCount - this.data.tasks.length;
  }

  clearAllTasks() {
    const count = this.data.tasks.length;
    this.data.tasks = [];
    this.save();
    return count;
  }

  clearCalendarDeadlines({ mode = 'all', dateKey = null } = {}) {
    let clearedCount = 0;

    if (mode === 'date' && dateKey) {
      this.data.tasks.forEach(t => {
        if (t.deadline && t.deadline.split('T')[0] === dateKey) {
          t.deadline = '';
          clearedCount++;
        }
      });
      const beforeExams = this.data.exams.length;
      this.data.exams = this.data.exams.filter(e => e.date && e.date.split('T')[0] !== dateKey);
      clearedCount += (beforeExams - this.data.exams.length);

      this.data.topics.forEach(top => {
        if (top.reviewDate === dateKey) {
          top.reviewDate = '';
          clearedCount++;
        }
      });
    } else if (mode === 'completed') {
      this.data.tasks.forEach(t => {
        if (t.status === 'completed' && t.deadline) {
          t.deadline = '';
          clearedCount++;
        }
      });
    } else if (mode === 'all') {
      this.data.tasks.forEach(t => {
        if (t.deadline) {
          t.deadline = '';
          clearedCount++;
        }
      });
      clearedCount += this.data.exams.length;
      this.data.exams = [];
      this.data.topics.forEach(top => {
        if (top.reviewDate) {
          top.reviewDate = '';
          clearedCount++;
        }
      });
    }

    this.save();
    return clearedCount;
  }

  // Resources
  getResources() { return this.data.resources; }
  addResource(resource) {
    const savedId = (entry, kind) => {
      if (entry[kind]) return entry[kind];
      try {
        const url = new URL(entry.url || entry.youtubeUrl);
        if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be', 'www.youtu.be'].includes(url.hostname)) return null;
        if (kind === 'playlistId') return url.searchParams.get('list');
        return url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).at(-1);
      } catch (_) { return null; }
    };
    const existing = this.data.resources.find(r => r.subjectId === resource.subjectId &&
      (resource.playlistId ? savedId(r, 'playlistId') === resource.playlistId : resource.videoId ? !savedId(r, 'playlistId') && savedId(r, 'videoId') === resource.videoId : false));
    if (existing) return existing;
    resource.id = 'res-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    this.data.resources.push(resource);
    this.save();
    return resource;
  }
  deleteResource(id) {
    this.data.resources = this.data.resources.filter(r => r.id !== id);
    this.save();
  }
  updateResource(id, updates) {
    const idx = this.data.resources.findIndex(r => r.id === id);
    if (idx !== -1) {
      this.data.resources[idx] = { ...this.data.resources[idx], ...updates };
      this.save();
    }
  }

  // Focus Sessions
  getFocusSessions() { return this.data.focusSessions; }
  addFocusSession(session) {
    session.id = 'sess-' + Date.now();
    this.data.focusSessions.unshift(session);

    // Auto-update topic last studied & review date
    if (session.topicId) {
      const topic = this.getTopicById(session.topicId);
      if (topic) {
        const today = new Date().toISOString().split('T')[0];
        const nextReview = new Date(Date.now() + 4 * 86400000).toISOString().split('T')[0];
        let newMastery = topic.mastery;
        if (session.confidence >= 4 && newMastery < 5) newMastery += 1;
        if (session.confidence <= 2 && newMastery > 1) newMastery -= 1;
        this.updateTopic(topic.id, {
          lastStudied: today,
          reviewDate: nextReview,
          mastery: newMastery,
          reviewStatus: newMastery >= 4 ? 'mastered' : (newMastery === 3 ? 'developing' : 'needs_review')
        });
      }
    }

    // Auto-update task if marked completed
    if (session.taskId && session.completedGoal === 'finished') {
      const task = this.getTaskById(session.taskId);
      if (task) {
        this.updateTask(task.id, { status: 'completed' });
      }
    }

    this.save();
    return session;
  }

  // Exams
  getExams() {
    return [...(this.data.exams || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }
  getExamById(id) {
    return (this.data.exams || []).find(e => e.id === id);
  }
  addExam(exam) {
    exam.id = 'exam-' + Date.now();
    if (!this.data.exams) this.data.exams = [];
    this.data.exams.push(exam);
    this.save();
    return exam;
  }
  updateExam(id, updates) {
    const idx = (this.data.exams || []).findIndex(e => e.id === id);
    if (idx !== -1) {
      this.data.exams[idx] = { ...this.data.exams[idx], ...updates };
      this.save();
    }
  }
  deleteExam(id) {
    this.data.exams = (this.data.exams || []).filter(e => e.id !== id);
    this.save();
  }

  // Holidays, exam weeks, and academic calendar
  getHolidays() { return this.data.holidays || []; }
  getExamWeeks() { return this.data.examWeeks || []; }
  getGradeDeadlines() { return this.data.gradeDeadlines || []; }
  getAcademicEvents() { return this.data.academicEvents || []; }
  getExamWeekSchedule() { return this.data.examWeekSchedule || INITIAL_DATABASE.examWeekSchedule; }

  /**
   * Expand multi-day academic events into per-day entries for calendar event map.
   * Returns array of { date: "YYYY-MM-DD", name, category, icon }
   */
  getAcademicEventDays() {
    const days = [];
    for (const ae of this.getAcademicEvents()) {
      const startParts = ae.startDate.split('-');
      const endParts = (ae.endDate || ae.startDate).split('-');
      const start = new Date(parseInt(startParts[0], 10), parseInt(startParts[1], 10) - 1, parseInt(startParts[2], 10));
      const end   = new Date(parseInt(endParts[0], 10), parseInt(endParts[1], 10) - 1, parseInt(endParts[2], 10));
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push({
          date: this.getTodayDate(d),
          name: ae.name,
          category: ae.category,
          icon: ae.icon || '📌'
        });
      }
    }
    return days;
  }

  /**
   * Expand examWeeks into per-day entries for calendar event map.
   * Returns array of { date: "YYYY-MM-DD", name, term }
   */
  getExamWeekDays() {
    const days = [];
    for (const ew of this.getExamWeeks()) {
      const startParts = ew.startDate.split('-');
      const endParts = ew.endDate.split('-');
      const start = new Date(parseInt(startParts[0], 10), parseInt(startParts[1], 10) - 1, parseInt(startParts[2], 10));
      const end   = new Date(parseInt(endParts[0], 10), parseInt(endParts[1], 10) - 1, parseInt(endParts[2], 10));
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push({
          date: this.getTodayDate(d),
          name: `${ew.name} (${ew.term})`,
          term: ew.term
        });
      }
    }
    return days;
  }

  // Daily Reflection
  getDailyReflections() { return this.data.dailyReflections || []; }
  getTodayReflection() {
    const today = this.getTodayDate();
    return (this.data.dailyReflections || []).find(r => r.date === today) || null;
  }
  saveDailyReflection(ref) {
    if (!this.data.dailyReflections) this.data.dailyReflections = [];
    const today = this.getTodayDate();
    const existingIndex = this.data.dailyReflections.findIndex(r => r.date === today);
    const item = {
      id: existingIndex >= 0 ? this.data.dailyReflections[existingIndex].id : 'dref-' + Date.now(),
      date: today,
      control: ref.control || '',
      importantThing: ref.importantThing || '',
      obstacle: ref.obstacle || '',
      response: ref.response || '',
      grateful: ref.grateful || '',
      updatedAt: new Date().toISOString()
    };
    if (existingIndex >= 0) {
      this.data.dailyReflections[existingIndex] = item;
    } else {
      this.data.dailyReflections.unshift(item);
    }
    this.save();
    return item;
  }
  deleteDailyReflection(id) {
    this.data.dailyReflections = (this.data.dailyReflections || []).filter(r => r.id !== id);
    this.save();
  }

  // Stoic Lessons
  getStoicLessons() { return this.data.stoicLessons || INITIAL_DATABASE.stoicLessons; }
  getStoicLessonByPillar(pillar) {
    return this.getStoicLessons().find(l => l.pillar.toLowerCase() === (pillar || '').toLowerCase()) || null;
  }

  // Mind Suite
  getControlItems() { return this.data.controlItems; }
  addControlItem(type, text) {
    const item = { id: 'c-' + Date.now(), text };
    if (type === 'within') this.data.controlItems.within.push(item);
    else this.data.controlItems.outside.push(item);
    this.save();
    return item;
  }
  deleteControlItem(type, id) {
    if (type === 'within') {
      this.data.controlItems.within = this.data.controlItems.within.filter(i => i.id !== id);
    } else {
      this.data.controlItems.outside = this.data.controlItems.outside.filter(i => i.id !== id);
    }
    this.save();
  }

  getVoluntaryDiscomforts() { return this.data.voluntaryDiscomforts; }
  toggleDiscomfort(id) {
    const item = this.data.voluntaryDiscomforts.find(d => d.id === id);
    if (item) {
      item.completed = !item.completed;
      this.save();
    }
  }

  getStoicReflections() { return this.data.stoicReflections; }
  addStoicReflection(reflection) {
    reflection.id = 'sr-' + Date.now();
    reflection.date = new Date().toISOString().split('T')[0];
    this.data.stoicReflections.unshift(reflection);
    this.save();
    return reflection;
  }

  getStoicJournals() { return this.data.stoicJournals; }
  addStoicJournal(journal) {
    journal.id = 'sj-' + Date.now();
    journal.date = new Date().toISOString().split('T')[0];
    this.data.stoicJournals.unshift(journal);
    this.save();
    return journal;
  }

  getMorningReflections() { return this.data.morningReflections; }
  addMorningReflection(ref) {
    ref.id = 'mr-' + Date.now();
    ref.date = new Date().toISOString().split('T')[0];
    this.data.morningReflections.unshift(ref);
    this.save();
    return ref;
  }

  getEveningReflections() { return this.data.eveningReflections; }
  addEveningReflection(ref) {
    ref.id = 'er-' + Date.now();
    ref.date = new Date().toISOString().split('T')[0];
    this.data.eveningReflections.unshift(ref);
    this.save();
    return ref;
  }

  getMentalCheckIns() { return this.data.mentalCheckIns; }
  addMentalCheckIn(checkin) {
    checkin.id = 'mc-' + Date.now();
    checkin.date = new Date().toISOString().split('T')[0];
    this.data.mentalCheckIns.unshift(checkin);
    this.save();
    return checkin;
  }

}

export const db = new Database();

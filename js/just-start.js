/**
 * FOCUS//ECE — "JUST START" Decision Fatigue Breaker & "I'M LOST" Triage Engine
 * Selects the single highest-impact task based on deadlines, priority, duration, and cognitive friction.
 */

import { db } from './db.js';
import { timer } from './timer.js';

export class JustStartEngine {
  static getRecommendedTask() {
    const tasks = db.getTasks().filter(t => t.status !== 'completed');
    if (!tasks.length) return null;

    const now = new Date().getTime();

    // Priority scoring weights
    const priorityWeights = { urgent: 100, high: 60, medium: 30, low: 10 };

    const scored = tasks.map(task => {
      let score = priorityWeights[task.priority] || 20;

      // Deadline proximity score
      if (task.deadline) {
        const deadlineTime = new Date(task.deadline).getTime();
        const hoursUntil = (deadlineTime - now) / (1000 * 60 * 60);

        if (hoursUntil < 0) {
          // Overdue gets massive boost
          score += 150;
        } else if (hoursUntil < 24) {
          score += 80;
        } else if (hoursUntil < 72) {
          score += 40;
        }
      }

      // In progress tasks get a continuation bonus
      if (task.status === 'in_progress') {
        score += 25;
      }

      // Check topic mastery: lower mastery = higher preparation need
      if (task.topicId) {
        const topic = db.getTopicById(task.topicId);
        if (topic) {
          score += (5 - topic.mastery) * 8;
        }
      }

      return { task, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0].task;
  }

  static getTriageRecommendation(situationKey) {
    const incompleteTasks = db.getTasks().filter(t => t.status !== 'completed');
    const topics = db.getTopics();
    const exams = db.getExams();

    switch (situationKey) {
      case 'no_idea': {
        const best = this.getRecommendedTask();
        return {
          task: best,
          advice: "Decision paralysis happens when you look at the whole mountain. We selected this single task for you. Commit to 25 minutes only."
        };
      }

      case 'not_understanding': {
        // Find topic with lowest mastery
        const weakest = [...topics].sort((a, b) => a.mastery - b.mastery)[0];
        const task = incompleteTasks.find(t => t.topicId === weakest?.id) || incompleteTasks[0];
        return {
          task,
          topic: weakest,
          advice: `Focus on fundamentals for ${weakest ? weakest.name : 'this topic'}. Don't try to solve complex problems yet—review the formula vault and module first.`
        };
      }

      case 'too_many_tasks': {
        const topTask = this.getRecommendedTask();
        return {
          task: topTask,
          advice: "Ignore everything else on your dashboard for the next 45 minutes. Focus on one step at a time. Only this task exists right now."
        };
      }

      case 'procrastinating': {
        // Find shortest task
        const shortest = [...incompleteTasks].sort((a, b) => (a.estimatedMinutes || 45) - (b.estimatedMinutes || 45))[0];
        return {
          task: shortest,
          advice: "You don't have to want it. You just have to sit down for 15 minutes. Action precedes motivation. Set the timer to 15 minutes and just open the file."
        };
      }

      case 'exam_coming': {
        // Find upcoming exam and lowest mastery topic in it
        const upcomingExam = exams[0];
        let examTopic = null;
        if (upcomingExam && upcomingExam.topicIds?.length) {
          const examTopics = upcomingExam.topicIds.map(id => db.getTopicById(id)).filter(Boolean);
          examTopics.sort((a, b) => a.mastery - b.mastery);
          examTopic = examTopics[0];
        }
        const task = (examTopic && incompleteTasks.find(t => t.topicId === examTopic.id)) || incompleteTasks[0];
        return {
          task,
          topic: examTopic,
          advice: upcomingExam
            ? `Targeting ${upcomingExam.title}. Reviewing weak topic: ${examTopic ? examTopic.name : 'Key concepts'}.`
            : "Review your lowest confidence topic before moving to new assignments."
        };
      }

      case 'twenty_minutes': {
        const shortTask = incompleteTasks.find(t => t.estimatedMinutes <= 30) || incompleteTasks[0];
        return {
          task: shortTask,
          advice: "20 minutes is enough to review a formula, check one problem, or organize module notes. Let's do a fast 20-minute sprint."
        };
      }

      default:
        return { task: this.getRecommendedTask(), advice: "Begin with your next highest priority move." };
    }
  }

  static launchTask(task, customMinutes = null) {
    if (!task) return;
    const duration = customMinutes || task.estimatedMinutes || 45;
    timer.setDuration(duration);
    timer.setContext(task.subjectId, task.topicId, task.id);
    window.location.hash = '#focus';
  }
}

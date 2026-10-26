/**
 * Fixed reading excerpts for the dashboard and focus banners.
 * Source PDFs were checked locally; these entries are intentionally outside user data.
 */
export const DAILY_QUOTES = Object.freeze([
  Object.freeze({ quote: 'You do not rise to the level of your goals. You fall to the level of your systems.', author: 'James Clear', work: 'Atomic Habits', context: 'Build a study routine that makes the next useful action easy.' }),
  Object.freeze({ quote: 'True behavior change is identity change.', author: 'James Clear', work: 'Atomic Habits', context: 'Practice the actions of the student you want to become.' }),
  Object.freeze({ quote: 'Fix the inputs and the outputs will fix themselves.', author: 'James Clear', work: 'Atomic Habits', context: 'Give your daily process more attention than a distant result.' }),
  Object.freeze({ quote: 'There is always a countermove, always an escape or a way through', author: 'Ryan Holiday', work: 'The Obstacle Is the Way', context: 'Look for the next action available inside a difficulty.' }),
  Object.freeze({ quote: "We choose how we'll look at things.", author: 'Ryan Holiday', work: 'The Obstacle Is the Way', context: 'A change in perspective can change your response.' }),
  Object.freeze({ quote: 'The path is there for those ready to take it.', author: 'Ryan Holiday', work: 'The Obstacle Is the Way', context: 'Steady yourself, then take the next step.' }),
  Object.freeze({ quote: 'Only the educated are free.', author: 'Epictetus', work: 'The Daily Stoic', context: 'January 2: Education Is Freedom.' }),
  Object.freeze({ quote: 'Control your perceptions. Direct your actions properly.', author: 'Ryan Holiday', work: 'The Daily Stoic', context: 'January 4: The Big Three.' }),
  Object.freeze({ quote: 'I learned to read carefully and not be satisfied with a rough understanding of the whole', author: 'Marcus Aurelius', work: 'The Daily Stoic', context: 'January 24: Push for Deep Understanding.' })
]);

export function getQuoteForDate(date = new Date()) {
  const start = new Date(date.getFullYear(), 0, 1);
  const dayIndex = Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(start.getFullYear(), 0, 1)) / 86400000);
  return DAILY_QUOTES[dayIndex % DAILY_QUOTES.length];
}

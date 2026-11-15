export function formatStudyMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0m';
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))}s`;
  const rounded = Math.round(minutes * 10) / 10;
  if (rounded < 60) return `${rounded}m`;
  const hours = Math.floor(rounded / 60);
  const remainder = Math.round((rounded - hours * 60) * 10) / 10;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

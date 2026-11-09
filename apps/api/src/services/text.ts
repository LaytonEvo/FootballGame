/** "Bukayo Saka" → "Saka" (name plates and pushes). */
export function plateName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : full;
}

/** Dev mapping from the dataset's price (tenths of £m) to a 40-99 card rating. See config/packs.v0.1.json. */
export function ratingFromProviderValue(value: number): number {
  return Math.max(40, Math.min(99, Math.round(48 + 0.9 * (value - 40))));
}

// Data of the growth, self and style tabs. The app edits these objects and saves them whole.
export const emptySections = () => ({
  growth: { books: [], reading: [], habits: null, habitLog: {}, wheel: [], tipsDone: [] },
  self: { wins: [], practiceLog: {}, reframes: [], jokes: [] },
  style: { profile: null, guide: null, items: [], looks: [], shopping: [] },
});
export const SECTIONS = Object.keys(emptySections());

// Fills in missing fields, e.g. data saved by an older version of the app
export function withSectionDefaults(sections = {}) {
  const out = {};
  for (const [k, v] of Object.entries(emptySections())) out[k] = { ...v, ...(sections[k] || {}) };
  return out;
}

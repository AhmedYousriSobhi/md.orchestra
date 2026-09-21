// A simple session-lifetime pool of every tag seen so far — whichever
// document it came from (the active one, a workspace file read for
// search, a standalone file opened once and since closed). It only ever
// *suggests* existing tags for autocomplete (ui/tagsEditor.js); tags stay
// genuinely free-form, so suggesting one from a different open workspace
// than the current file is harmless — at worst ignored, at best it's
// exactly the point (reusing "project" consistently across folders).
const knownTags = new Set();

export function registerTags(tags) {
  (tags || []).forEach((t) => { if (t) knownTags.add(t); });
}

export function getKnownTags() {
  return [...knownTags].sort((a, b) => a.localeCompare(b));
}

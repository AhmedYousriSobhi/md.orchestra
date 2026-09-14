// Reproduces GitHub's heading-anchor algorithm (as implemented by the
// `github-slugger` package): lowercase, strip anything that isn't a word
// character, hyphen, or space, turn spaces into hyphens, then de-duplicate
// by appending -1, -2, ... in document order. This lets in-document links
// like `[Foo](#foo-bar)` — e.g. a Table of Contents — resolve to the same
// anchor GitHub itself would generate for that heading.
function slugify(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\w\- ]+/g, '')
    // Each space becomes its own hyphen (not collapsed): removing punctuation
    // that sat between two spaces — "Foo / Bar" -> "Foo  Bar" — must produce
    // a double hyphen ("foo--bar"), matching GitHub's own anchor generator.
    .replace(/ /g, '-');
}

/** Walk the whole tree in document order, building both slug->id and id->slug maps in one pass. */
export function buildSlugMaps(root) {
  const slugToId = new Map();
  const idToSlug = new Map();
  const seen = new Map();

  function visit(node) {
    if (node.level > 0) {
      const base = slugify(node.title);
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      const slug = count === 0 ? base : `${base}-${count}`;
      slugToId.set(slug, node.id);
      idToSlug.set(node.id, slug);
    }
    node.children.forEach(visit);
  }
  visit(root);
  return { slugToId, idToSlug };
}

/** Map every possible anchor slug to its node id (see buildSlugMaps). */
export function buildSlugIndex(root) {
  return buildSlugMaps(root).slugToId;
}

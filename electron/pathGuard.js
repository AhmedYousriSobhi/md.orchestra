const path = require('path');
const fs = require('fs/promises');

/**
 * Canonical path of `target` with every symlink resolved, even when the
 * target itself doesn't exist yet (a file about to be created): the nearest
 * existing ancestor is realpath'd and the not-yet-existing tail re-appended.
 * Comparing canonical paths is what stops a symlink inside an allowed
 * folder from naming something outside it.
 *
 * `followFinal: false` leaves the last path component unresolved, for
 * operations that act on a link itself (unlink) rather than what it points at.
 */
async function canonicalize(target, { followFinal = true } = {}) {
  const resolved = path.resolve(target);
  if (!followFinal) {
    return path.join(await canonicalize(path.dirname(resolved)), path.basename(resolved));
  }
  const tail = [];
  let current = resolved;
  for (;;) {
    try {
      const real = await fs.realpath(current);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') throw err;
      const parent = path.dirname(current);
      if (parent === current) return resolved;
      tail.push(path.basename(current));
      current = parent;
    }
  }
}

function createPathGuard() {
  const entries = [];

  async function allow(type, targetPath) {
    entries.push({ type, path: await canonicalize(targetPath) });
  }

  async function isAllowed(targetPath, opts) {
    const real = await canonicalize(targetPath, opts);
    return entries.some((entry) => {
      if (entry.type === 'file') return real === entry.path;
      return real === entry.path || real.startsWith(entry.path + path.sep);
    });
  }

  async function assertAllowed(targetPath, opts) {
    if (!(await isAllowed(targetPath, opts))) {
      throw new Error(`Not allowed: "${targetPath}" is outside every folder/file you've opened.`);
    }
  }

  return { allow, isAllowed, assertAllowed };
}

module.exports = { createPathGuard, canonicalize };

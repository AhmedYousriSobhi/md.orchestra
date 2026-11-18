const path = require('path');

const MESSAGES = {
  EACCES: (name) => `Permission denied for "${name}". Check the file's permissions, or save a copy elsewhere.`,
  EPERM: (name) => `Not permitted to change "${name}" (it may be locked or protected).`,
  EROFS: (name) => `"${name}" is on a read-only location, so it can't be changed there.`,
  ENOSPC: (name) => `The disk is full, so "${name}" could not be written. Your original file is untouched; free some space and try again.`,
  EDQUOT: (name) => `Your disk quota is exceeded, so "${name}" could not be written. Your original file is untouched.`,
  EIO: (name) => `A disk read/write error occurred while accessing "${name}". Your edits are still in the app; try saving a copy elsewhere.`,
  ENOENT: (name) => `"${name}" or its folder no longer exists (moved or deleted outside the app). Save a copy elsewhere to keep your edits.`,
  ENOTDIR: (name) => `A part of the path to "${name}" is not a folder anymore.`,
  EISDIR: (name) => `"${name}" is a folder, not a file.`,
  EBUSY: (name) => `"${name}" is in use by another program. Close it there and try again.`,
  EMFILE: () => 'Too many files are open at once. Close some and try again.',
};

/**
 * Turns a raw Node fs error into one whose message says what actually went
 * wrong and what to do (the review's distinct EACCES/ENOSPC/EIO/ENOENT cases)
 * instead of "EACCES: permission denied, open '/long/path'". The errno code is
 * kept on `.code`; errors with no known code, and our own "Not allowed" /
 * "changed on disk" errors, pass through unchanged.
 */
function toFriendlyFsError(err, targetPath) {
  const make = err && MESSAGES[err.code];
  if (!make) return err;
  const friendly = new Error(make(targetPath ? path.basename(targetPath) : 'this file'));
  friendly.code = err.code;
  return friendly;
}

module.exports = { toFriendlyFsError };

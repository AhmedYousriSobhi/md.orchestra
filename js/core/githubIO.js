// Read-only GitHub repo browsing: fetch a public repo's file tree and let
// the user open any Markdown file in it through the exact same viewer
// every other file already goes through. Deliberately just phase one —
// "visualize the repo directory, open a file from it" — with no write-back
// at all yet; pushing edits as commits is a real, separate follow-up (it
// needs OAuth/a token and a genuinely different trust model — a workspace
// you can browse without asking permission for anything is not the same
// thing as one you can push commits to), not something to fake here.
//
// No auth: GitHub's REST API and raw.githubusercontent.com both serve
// public repos with permissive CORS (`Access-Control-Allow-Origin: *`),
// so a plain fetch() works directly from the app with no proxy or token —
// verified live against a real public repo, not assumed. The unauthenticated
// rate limit (60 requests/hour per IP) is a real, honest constraint of that
// same choice, not hidden: each "open repo" is exactly 1-2 requests (one to
// resolve the default branch if not given, one for the whole tree), so it
// takes real repeated use to hit, but it's not unlimited either.

const MD_RE = /\.(md|markdown)$/i;

/**
 * Accepts `owner/repo`, a full https://github.com/owner/repo[/tree/branch]
 * URL, or an owner/repo.git SSH-style remote, and pulls {owner, repo,
 * branch} out of whichever form was pasted in. `branch` is null when the
 * input didn't specify one (fetchGithubRepoTree then resolves the repo's
 * actual default branch instead of guessing "main").
 */
export function parseGithubRepoInput(raw) {
  const input = raw.trim();
  if (!input) return null;

  let rest = input;
  rest = rest.replace(/^git@github\.com:/, 'https://github.com/');
  rest = rest.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  rest = rest.replace(/\.git$/i, '');
  rest = rest.replace(/^\/+|\/+$/g, '');
  if (!rest) return null;

  const parts = rest.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  let branch = null;
  if (parts[2] === 'tree' && parts[3]) {
    branch = parts.slice(3).join('/');
  }
  return { owner, repo, branch };
}

async function githubApiFetch(path) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    if (res.status === 404) throw new Error("Repo, branch, or path not found — double-check it's public and spelled correctly.");
    if (res.status === 403) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      if (remaining === '0') throw new Error("GitHub's rate limit for un-authenticated requests was hit — try again in a few minutes.");
      throw new Error('GitHub API request was forbidden.');
    }
    throw new Error(`GitHub API returned ${res.status}.`);
  }
  return res.json();
}

/** A live, read-only handle to one file inside a public GitHub repo. `createWritable()` exists (rather than being simply absent) so a Save attempt fails through the exact same error-toast path a real write failure already would, with a clear, honest message — not a raw "not a function" error. */
export function makeGithubFileHandle(owner, repo, branch, relPath, name) {
  const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${relPath.split('/').map(encodeURIComponent).join('/')}`;
  return {
    kind: 'file',
    name,
    path: relPath,
    async getFile() {
      const res = await fetch(rawUrl);
      if (!res.ok) throw new Error(`Could not fetch "${relPath}" from GitHub (${res.status}).`);
      const text = await res.text();
      return { text: async () => text };
    },
    async createWritable() {
      throw new Error('GitHub files are read-only for now — pushing edits back as commits is planned for later.');
    },
  };
}

/**
 * Fetches a public repo's whole file tree in one call and returns it in
 * exactly the shape workspaceIO.js's workspaceFromFileList() already
 * produces ({rootName, files}, no dirHandles) — the same shape
 * main.js's handleWorkspaceOpened() already knows how to open, and
 * critically the same shape state/workspace.js's workspaceSupportsWrite()
 * already reads as "no dirHandles -> read-only", so every write-gated
 * action (add/delete/copy a file) is already correctly disabled for a
 * GitHub-sourced workspace with no new gating logic needed anywhere else.
 */
export async function fetchGithubRepoTree({ owner, repo, branch }) {
  // GitHub itself treats owner/repo as case-insensitive (github.com/Octocat
  // and github.com/octocat land on the same repo), but raw.githubusercontent.com
  // is a separate, exact-match CDN path -- a URL built from whatever case
  // the user actually typed can 404 there even though the API call above
  // it just succeeded. Fetching the repo's own metadata first and using the
  // *canonical* owner/name GitHub returns for every call after this one
  // (tree, and every raw file URL) sidesteps that mismatch entirely, rather
  // than trying to guess which specific call was the case-sensitive one.
  const repoMeta = await githubApiFetch(`/repos/${owner}/${repo}`);
  const canonicalOwner = repoMeta.owner.login;
  const canonicalRepo = repoMeta.name;
  const resolvedBranch = branch || repoMeta.default_branch;
  const treeRes = await githubApiFetch(`/repos/${canonicalOwner}/${canonicalRepo}/git/trees/${encodeURIComponent(resolvedBranch)}?recursive=1`);

  const files = treeRes.tree
    .filter((entry) => entry.type === 'blob' && MD_RE.test(entry.path))
    .map((entry) => {
      const segments = entry.path.split('/');
      const name = segments[segments.length - 1];
      return {
        relPath: entry.path,
        name,
        fileHandle: makeGithubFileHandle(canonicalOwner, canonicalRepo, resolvedBranch, entry.path, name),
        webkitFile: null,
      };
    });

  return {
    rootName: `${canonicalOwner}/${canonicalRepo}`,
    files,
    branch: resolvedBranch,
    truncated: Boolean(treeRes.truncated),
  };
}

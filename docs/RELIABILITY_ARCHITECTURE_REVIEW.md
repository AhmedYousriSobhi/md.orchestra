# MD.Orchestra — Filesystem Reliability, Security & Architecture Review

**Scope:** the Electron desktop shell's real-filesystem path — `electron/main.js`,
`electron/preload.js`, `js/core/electronFsAdapter.js`, `js/core/workspaceIO.js`,
`js/core/fileIO.js`, `js/core/recovery.js`, and the save/autosave orchestration in
`js/main.js`. Everything below is grounded in the code as it exists on `master`
today (post the Electron-shell merge), not a hypothetical design — every finding
cites the file/line it comes from.

**Status:** review only. Nothing in this document has been implemented yet; it's
the input to deciding what to actually build next, and in what order.

---

## 1. Architecture Assessment

### 1.1 Current layering

```
UI (js/ui/*.js)  →  js/main.js (orchestration)  →  js/core/*.js (adapters)  →  IPC  →  electron/main.js (fs)  →  OS
                        ↑
                   js/state/store.js (in-memory doc/dirty state)
```

- **`store.js`** (243 lines) is a small, single-purpose pub/sub store — one
  `state` object, a `Set` of listeners, `setState`/`subscribe`. This is
  appropriately minimal for an app this size: no action creators, no
  middleware, no reducers-of-reducers. **This is a positive finding, not a
  gap** — resist the urge to "productionize" it with a state-management
  library; it already does exactly what's needed and nothing more.
- **The adapter-object pattern** (`electronFsAdapter.js` constructing objects
  shaped exactly like the browser's `FileSystemDirectoryHandle`/
  `FileSystemFileHandle`) is a genuinely elegant way to keep
  `workspaceIO.js`/`fileIO.js` backend-agnostic (browser File System Access
  API vs. Electron IPC) **without** a formal strategy-pattern/DI framework.
  This is the right amount of abstraction for two backends — also a positive
  finding worth preserving as-is in any refactor.
- **The security boundary is in the right place**: `electron/main.js` keeps
  an in-memory `allowlist` and validates every IPC call against it
  server-side (main process), never trusting the renderer's own claims. That
  instinct — narrow preload surface, `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true` — is correct Electron practice.
  The gaps below are in the *implementation* of that boundary, not its
  placement.

### 1.2 Where it's under-separated

`js/main.js` is **1,770 lines** and mixes four concerns that have no module
boundary between them: DOM/event wiring, save/dirty orchestration, crash-
recovery snapshotting, and drag-resize handling for unrelated UI panels. The
save → recovery-snapshot → Changes-panel pipeline (roughly lines 370–1300) is
exactly the logic this review is about, and today it's interleaved with
`el.previewResizeHandle` pointer-drag math in the same file. This isn't
"unnecessary enterprise complexity" in the other direction (no premature
layering is needed) — it's the opposite problem: the one part of this
codebase that most needs to be independently reasoned about, unit-tested, and
changed safely (file persistence) currently can't be, without also holding
the rest of `main.js` in your head. A single `js/core/persistence.js`
(or similar) extracting `handleSave`, `snapshotNow`/`snapshotIfDirty`,
`notifyOtherPendingChanges`, `enrichSnapshot`/`enrichActiveSnapshot`, and the
write helpers out of `main.js` would fix this proportionately — no new
layers, just a seam that doesn't currently exist.

### 1.3 Global state

The only real global mutable state is `store.js`'s single `state` object
(by design — it's the document model) and `electron/main.js`'s in-memory
`allowlist` array (by design — it's a security boundary that must not
survive a relaunch). Neither is a problem in itself. `js/main.js` additionally
holds several module-level `let`s (`currentBaseline`, `standaloneCleanText`,
etc.) that are really part of the same "current document" concern as
`store.js`'s state but live outside it — a minor smell, not a defect, and
worth folding into the persistence module above rather than fixing in
isolation.

---

## 2. Filesystem Correctness

| Operation | Where | Current behavior | Correct? |
|---|---|---|---|
| Read | `electron/main.js:130-133` | `fs.readFile(path, 'utf-8')` | Fine — reads are naturally atomic from the caller's point of view. |
| Write | `electron/main.js:135-138` | `fs.writeFile(path, content, 'utf-8')` — **direct, in-place** | **Not atomic.** `fs.writeFile` opens the existing file, truncates it, then streams the new content in. A reader (or a crash) between truncate and the write completing sees a **shorter-than-either** file — not the old version, not the new one. |
| Delete | `electron/main.js:150-153` | `fs.unlink` | Fine — POSIX unlink is atomic by nature. |
| Existence check | `electron/main.js:140-148` | `fs.access` | Fine, but see §7 (TOCTOU) — a check-then-act gap exists between this and any subsequent operation on the same path. |
| Directory listing | `electron/main.js:124-128` | `fs.readdir(..., {withFileTypes:true})` | Fine. |
| Rename | — | **Not used anywhere.** | Missing — this is the operation the safe-write pattern below depends on. |
| fsync | — | **Never called.** | Missing on every write path, including the "Saved" toast's own write. |

**The missing pattern — atomic file replacement:**

```
1. write new content to  <dir>/.<name>.tmp-<random>   (same directory as the target — required for step 4 to be a same-filesystem rename)
2. fsync(fd) the temp file                             (flush data + metadata before it's ever visible under the real name)
3. close(fd)
4. rename(tmp, target)                                  (atomic on POSIX — the target either has all-old or all-new bytes, never a mix)
5. fsync the *directory* fd                              (the rename itself isn't guaranteed durable until the directory entry is flushed — commonly missed even by people who remember steps 1-4)
```

**Why fsync is justified here specifically:** a "Saved" toast is a promise —
the user is told their edit is durable. Without fsync, `fs.writeFile`'s
returned Promise only means "handed to the OS's page cache," not "on disk."
On Linux in particular, that gap can be seconds to tens of seconds under
normal `writeback` timing, and unbounded under a real power-loss (the whole
point of `fsync` is to force a specific, bounded durability point rather than
trust the OS's own opportunistic flush). This justification applies **only**
to the explicit "write the real file" path — not to every keystroke of the
recovery cache (see §5).

---

## 3. Crash Consistency

| Failure mode | Current behavior | Risk |
|---|---|---|
| SIGKILL / app crash mid-write | `fs.writeFile` has no atomicity — file can be left truncated or partially written. | **Real data loss**, not theoretical: the exact file the user opened is the one being truncated in place. |
| Power loss mid-write | Same as above, compounded by no fsync — even a "completed" write may not have reached the physical disk yet. | Same as above. |
| Disk full (`ENOSPC`) mid-write | `write-file`'s `await fs.writeFile(...)` rejects; the IPC promise rejects; `handleSave()` catches it generically (`js/main.js:1196-1199`) and shows `Save failed: ${err.message}`. | The **temp file** from a failed write (if the atomic pattern below is adopted) must be cleaned up on this path, or `ENOSPC` failures leave orphaned `.tmp-*` files behind indefinitely. Today, with in-place `writeFile`, a mid-write `ENOSPC` can leave the **real file itself** truncated — worse than an orphaned temp file. |
| Partial write (slow/network filesystem) | No timeout, no partial-write detection. | Low likelihood for a local-first app, but same truncation risk as above applies for as long as the write is in flight. |

**Deterministic, failure-safe behavior this app should guarantee (target, not yet built):**

1. **The user's real file is never touched until a complete, verified copy
   exists elsewhere on disk.** (The atomic temp→fsync→rename pattern in §2.)
2. **A crash at any point before the final `rename()` leaves the original
   file byte-for-byte untouched.** A stray `.tmp-*` file next to it is an
   acceptable, self-evidently-safe-to-delete leftover — a truncated real
   file is not.
3. **A crash after the `rename()` is indistinguishable from a normal save**
   — POSIX rename is atomic, so there is no partial-rename state to recover
   from.
4. **`ENOSPC`/`EACCES`/`EIO` during the temp-file write must surface as a
   distinct, actionable error** (§8), and must never be allowed to reach the
   `rename()` call — a failed temp write must abort before touching the real
   file, not fall through to overwriting it with a possibly-truncated temp.

---

## 4. Recovery Cache Design

**What exists today** (`js/core/recovery.js`): a debounced (1.5s),
content-diffed (only writes when `serializeMarkdown(doc) !== currentBaseline`
— already correctly avoiding no-op writes) snapshot of every dirty
document's Markdown, stored under one `localStorage` key
(`mdDashboard.recovery.v2`) as a single JSON array, capped at 20 entries.

This was a reasonable design for the **browser-only** era of this app (before
the Electron shell), where `localStorage` was the only persistence available
at all. Now that the app has real filesystem access via IPC, it inherits
several concrete weaknesses that a real desktop editor's crash-recovery
mechanism (vim swap files, Word's `.tmp` autosave, VSCode's local history)
doesn't have:

| Weakness | Detail |
|---|---|
| **Not a real cache directory** | `localStorage` is a browser-origin store with a soft ~5-10MB quota, cleared by "Clear browsing data," invisible to the user or to any external tool, and with no OS-standard location. |
| **One blob, not one file per document** | Every snapshot write (`writeAll`, `recovery.js:51-57`) re-serializes and re-writes the **entire** snapshot list, even though only one document's entry actually changed. Editing document A while document B also has a pending snapshot means every A-keystroke's debounced write re-persists B's (unchanged) Markdown too. |
| **Count-bounded, not size-bounded** | `MAX_SNAPSHOTS = 20` caps the *number* of entries, not their total byte size — 20 large documents can still blow past a reasonable disk/quota budget. |
| **No collision detection** | Confirmed absent: `recovery.js`'s own comment (lines 13-19) states plainly that it "has no way to re-check a file that's been edited outside the app since." There is no `stat()` of the source file at open time, and `handleSave()` (`js/main.js:1180`) writes unconditionally on save — **editing a file in the app while git/vim/another process also modifies it on disk is a silent lost update** on the next save. This is the single most consequential correctness gap in the review, and the one the user's own requirements called out by name. |

**Proposed target design** (on-disk, XDG-style — not yet implemented):

- **Location:** Electron's `app.getPath('userData')` is the conventional
  per-OS location (`~/.config/md-orchestra` on Linux, matching
  `XDG_CONFIG_HOME` — note this is technically the *config* path, not
  `app.getPath('cache')`, which maps closer to `XDG_CACHE_HOME`
  (`~/.cache/md-orchestra`); **this is a real decision to make explicitly**,
  since recovery snapshots are disposable/regenerable data and belong under
  `cache`, not `config`, by XDG's own definitions.
- **Layout:** one JSON file per document identity under
  `<cache>/recovery/<sha256(identity)>.json`, not one shared blob — so
  writing document A's snapshot never touches document B's bytes.
- **Metadata schema per snapshot file:**
  ```json
  {
    "schemaVersion": 1,
    "identity": { "workspaceRootName": "...", "workspaceRelPath": "...", "fileName": "..." },
    "sourcePath": "/absolute/path/on/disk",
    "sourceStatAtOpen": { "mtimeMs": 0, "size": 0 },
    "baselineMarkdown": "...",
    "markdown": "...",
    "savedAt": 0
  }
  ```
- **Collision detection:** `stat()` the real source file when it's opened
  and again immediately before any save; compare `mtimeMs`/`size` against
  `sourceStatAtOpen`. A mismatch means the file changed outside the app —
  surface a real conflict choice (keep mine / reload theirs / save-as)
  instead of silently overwriting. This is the direct fix for the gap
  `recovery.js`'s own comment already admits to.
- **Atomicity:** the recovery cache's own writes should use the same
  temp→rename pattern as §2 — a torn recovery-cache write defeats the whole
  point of having one.

---

## 5. Cache Lifecycle & Performance

- **Checkpointing:** keep the existing content-diff-before-write logic
  (`snapshotNow`'s `currentBaseline` comparison, `js/main.js:402-406`) — it's
  already correct and should carry over unchanged to an on-disk cache.
- **Debouncing:** the current 1.5s debounce (`snapshotIfDirty`,
  `js/main.js:417`) is a reasonable default; keep it for the recovery cache
  specifically. **Do not** fsync on every debounced recovery tick — that
  would turn a "best-effort local safety net" into continuous disk
  thrashing for no proportionate benefit. fsync is reserved for the
  explicit, user-initiated real-file save (§2).
- **Size-bounding:** replace the count-based `MAX_SNAPSHOTS = 20` with a
  byte-budget (e.g. total recovery-cache directory capped at some tens of
  MB) with LRU eviction by `savedAt`, plus a per-document size sanity check
  (warn, don't silently truncate, on an unusually large document).
- **Write amplification:** the move to one-file-per-document (§4) is itself
  the fix here — it turns "rewrite everything on every tick" into "rewrite
  only what changed," which is the single biggest lifecycle improvement
  available.

---

## 6. Concurrency & External Watchers

**Current state: none exist.** No `fs.watch`, no `chokidar`, no inotify
usage anywhere in the codebase — confirmed by search. This is a legitimate,
deliberate scope cut for v1 (the app only ever knows a file's content as of
whenever it last explicitly read it), not a bug in itself. It does, however,
compound §4's collision-detection gap: without a watcher, the app has no way
to proactively notice an external edit even to *warn* about it before the
user tries to save — the stat-at-save-time check in §4 is a necessary
minimum, not a substitute for a watcher, just the cheapest correct thing to
build first.

**If/when a watcher is added, the specific footgun to design around from day
one:** raw filesystem events are not atomic logical operations. A single
conceptual "save" from an external editor can emit multiple raw events —
`vim`'s atomic-rename-on-save pattern (its own crash-safety mechanism)
produces an `unlink` + `create` pair for what the user experiences as one
save, not a `modify`; other editors emit `modify` + separate `attrib`
events for the same write. Any future watcher must **coalesce and debounce
by path** before reacting (e.g. "something happened to this path, re-stat it
after a short quiet period") rather than mapping each raw event 1:1 to an
action — otherwise a single external save can trigger duplicate reload
prompts, or worse, a spurious "file was deleted" state for a file that was
never actually gone.

---

## 7. Security

| Area | Finding | Severity |
|---|---|---|
| **Allowlist bypass via `reallow-folder`** | `ipcMain.handle('reallow-folder', ...)` (`electron/main.js:164-166`) calls `allow('dir', folderPath)` with **zero validation** of `folderPath` — it will add *any* string the renderer sends. The only renderer-side caller today is `electronReopenFolder()` (`electronFsAdapter.js:91-94`), fed from a `localStorage`-remembered path — legitimate today, but the IPC handler itself provides no defense if that call site is ever compromised (a supply-chain-compromised CDN script, or any future renderer-side bug) or simply reused incorrectly later. **This is the single most severe finding in this review**: since `contextIsolation`/`nodeIntegration`/`sandbox` are all correctly configured specifically to ensure the IPC bridge is the *only* thing standing between a compromised renderer and the real filesystem, and this one handler grants unrestricted access through that bridge with no check at all, it undermines the entire allowlist model in one call. | **P0** |
| **Symlink escape** | `isAllowed()` (`electron/main.js:14-21`) resolves the target path with `path.resolve` (pure string manipulation) but never calls `fs.realpath`. A symlink created *inside* an allowed workspace folder (e.g. `ln -s /etc /workspace/escape`) has a path string that passes the prefix check, but the OS follows the link on actual `open()`/`read()`/`write()`/`unlink()` — silently escaping the sandboxed folder. | **P1** |
| **TOCTOU** | `exists` (`electron/main.js:140-148`) is a separate round-trip from any subsequent `read-file`/`write-file`/`delete-file` call on the same path — a file/symlink swapped in between is a real (if narrow) race. Lower priority than the symlink finding above since it requires a second actor with local filesystem write access at the right moment, but worth noting as the same underlying class of gap. | P2 |
| **Path traversal** | Checked and **not** currently exploitable: `path.resolve` collapses `..` segments before the prefix comparison, and the prefix check correctly appends `path.sep` (`root + path.sep`) before `startsWith`, which correctly rejects the classic `/allowed` vs. `/allowed-evil` sibling-prefix bug. No fix needed here — called out so it isn't mistakenly re-flagged later. | — (verified clean) |
| **Secure temp file creation** | N/A today (no temp files are created anywhere in the write path yet) — becomes relevant the moment §2's atomic-write pattern is implemented: the temp file name must be unpredictable (not just `.tmp`) and created with a mode that excludes other local users, to avoid a symlink-race or predictable-name attack against the temp file itself. | Design note for future work. |
| **Workspace boundary enforcement** | Otherwise well-enforced: every `read-dir`/`read-file`/`write-file`/`delete-file` handler calls `assertAllowed` before touching disk (`electron/main.js:125,131,136,141,151`). The boundary logic itself (aside from the two findings above) is sound. | — (verified clean, contingent on P0/P1 fixes) |

---

## 8. Resource Management & Error Handling

- **FD/memory leaks:** none found. Every filesystem operation is a one-shot
  `fs/promises` call (`readFile`, `writeFile`, `readdir`, `access`,
  `unlink`) — nothing holds a file descriptor open across IPC calls, so
  there's no leak surface to close. **Verified clean**, not a gap.
- **Error handling: generic and lossy.** Every IPC handler lets Node's raw
  `fs` errors propagate as-is; the renderer only ever sees
  `err.message` (`js/main.js:1197`: `Save failed: ${err.message}`). This
  collapses `EACCES` (permission denied — user needs to pick a different
  location), `ENOSPC` (disk full — nothing will help until space is freed),
  `EIO` (hardware/filesystem-level failure — data-loss-adjacent, deserves
  its own warning), and `ENOENT` (the file or its parent directory was
  deleted externally — a fundamentally different situation from every other
  case) into one undifferentiated toast string. None of these should crash
  the app (and none currently do — the `catch` blocks are consistently
  present), but none are handled *specifically* either. **Recommended
  fix, proportionate to this app's size:** a small `classifyFsError(err)`
  helper in the new persistence module (§1.2) mapping `err.code` to a short
  enum (`permission | full-disk | io-error | missing | unknown`), used to
  pick a more specific toast message and, for `missing` specifically, to
  offer "Save As" instead of retrying a write to a path that no longer
  exists.
- **Corrupted recovery cache:** already handled defensively today —
  `recovery.js`'s `readAll()` wraps the `JSON.parse` in try/catch and
  filters out malformed entries (`recovery.js:32-49`) rather than letting a
  bad `localStorage` value take down startup. This same defensiveness must
  carry over to the on-disk redesign (§4): a corrupted/partial recovery
  JSON file (itself a candidate for having been torn by the very crash it
  exists to protect against, if it isn't written atomically) must be
  skipped with a logged warning, never thrown as an unhandled rejection at
  startup.

---

## Architecture Assessment & Critical Issues Summary

| Priority | Issue | Section |
|---|---|---|
| **P0** | `reallow-folder` IPC handler grants arbitrary filesystem access with no path validation — defeats the allowlist security model entirely | §7 |
| **P0** | Real-file writes are non-atomic (`fs.writeFile` in place) — a crash mid-write truncates the user's actual document | §2, §3 |
| **P0** | No stale-overwrite / collision detection — external edits (git, vim, another process) are silently lost on the next in-app save | §4 |
| **P1** | Symlink inside an allowed workspace folder can escape the sandbox boundary (`isAllowed` never calls `realpath`) | §7 |
| **P1** | Recovery cache lives in `localStorage`, not a real on-disk cache directory — quota-bounded, invisible, and rewrites the entire snapshot list on every tick instead of just the changed document | §4, §5 |
| **P1** | No `fsync` anywhere in the write path — "Saved" doesn't currently guarantee durability against power loss | §2, §3 |
| **P2** | Generic error handling collapses `EACCES`/`ENOSPC`/`EIO`/`ENOENT` into one undifferentiated message | §8 |
| **P2** | `exists` + subsequent operation is a TOCTOU gap (same class as the symlink finding, narrower window) | §7 |
| **P2** | `main.js` (1,770 lines) has no module boundary between save/recovery orchestration and unrelated UI wiring, making the exact logic this review concerns hard to isolate and test | §1.2 |
| **P3** | `electronReopenFolder` re-trusts a remembered path on every launch without re-verifying it still exists | (noted in §7's table, not separately detailed) |
| **P3** | Recovery cache is count-bounded (20 entries), not size-bounded | §5 |

---

## ASCII Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│  Renderer process  (contextIsolation: true, nodeIntegration: false)  │
│                                                                       │
│   ┌───────────────┐   ┌────────────────────┐   ┌──────────────────┐ │
│   │   js/ui/*.js  │──▶│  js/main.js         │──▶│  js/state/       │ │
│   │  (DOM/events) │◀──│  (orchestration —    │◀──│  store.js        │ │
│   └───────────────┘   │   today: also owns   │   │  (doc/dirty      │ │
│                        │   save+recovery;     │   │   state)         │ │
│                        │   proposed: split    │   └──────────────────┘ │
│                        │   into a dedicated   │                        │
│                        │   persistence module)│                        │
│                        └──────────┬───────────┘                        │
│                                   │                                    │
│                   ┌───────────────┴────────────────┐                   │
│                   ▼                                ▼                   │
│        ┌─────────────────────┐          ┌────────────────────────┐    │
│        │ js/core/workspaceIO │          │ js/core/recovery.js    │    │
│        │ js/core/fileIO.js   │          │ (today: localStorage —  │   │
│        │  ↓ (adapter shape)  │          │  proposed: on-disk,      │   │
│        │ electronFsAdapter.js│          │  one file per document,  │  │
│        └──────────┬──────────┘          │  with stat-based         │  │
│                    │                     │  collision detection)    │  │
│                    ▼                     └────────────────────────┘    │
│        window.electronFS  (preload.js contextBridge — the ONLY        │
│        surface the renderer has toward the real filesystem)           │
└────────────────────┼───────────────────────────────────────────────────┘
                      │ ipcRenderer.invoke(...)
┌─────────────────────▼───────────────────────────────────────────────┐
│  Main process  (electron/main.js)                                    │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────┐     │
│   │  allowlist[]  (in-memory, per-launch — the security         │     │
│   │  boundary: every handler below calls assertAllowed() first) │     │
│   │                                                              │     │
│   │  ⚠ P0: reallow-folder adds to this list with NO validation  │     │
│   │  ⚠ P1: isAllowed() checks path.resolve(), never realpath()  │     │
│   │        — a symlink inside an allowed dir escapes the check  │     │
│   └────────────────────────────────────────────────────────────┘     │
│                                                                        │
│   pick-folder / pick-file / read-dir / read-file / exists /           │
│   delete-file / reallow-folder                                        │
│                                                                        │
│   write-file:                                                         │
│     TODAY:     fs.writeFile(target, content)  ⚠ P0 not atomic,        │
│                                                  no fsync              │
│     PROPOSED:  write(target.tmp) → fsync(fd) → close →                │
│                rename(tmp, target) → fsync(dir fd)                    │
└─────────────────────┬──────────────────────────────────────────────┘
                       ▼
              ┌─────────────────┐
              │   OS filesystem  │
              └─────────────────┘
```

---

## Recovery Cache & Reliability Model

This section states, as a single coherent model, what the app should
guarantee once §2–§5's proposals are implemented — the "if X happens, then Y
is what the user experiences" contract.

| Event | Guarantee |
|---|---|
| **App crash (SIGKILL) mid-edit, no save yet attempted** | The on-disk recovery cache's most recent debounced (≤1.5s-old) checkpoint of every dirty document is recoverable on next launch. The real source file is untouched (the app never writes it except via an explicit save). |
| **App crash mid-save (mid-write to the real file)** | The real file is **untouched** — the atomic temp→rename pattern guarantees the crash can only ever leave behind an orphaned `.tmp-*` file next to it, never a torn target file. The recovery cache still has the pre-crash content, so nothing is lost even though the save didn't complete. |
| **Power loss immediately after a "Saved" toast** | The write is durable — `fsync` was called on the temp file before the rename, and on the containing directory after, before the toast is shown. |
| **Disk full (`ENOSPC`) during save** | The temp-file write fails before ever touching the real file; the real file is provably untouched (the rename never happens). The user sees a specific "disk full" message, not a generic one, and the (failed, partial) temp file is cleaned up rather than left behind. |
| **File edited externally (git checkout, vim, another process) while open in the app** | Detected via a `stat()` comparison against the mtime/size recorded when the file was opened, checked again immediately before any save. The user is shown an explicit conflict choice rather than the app silently overwriting the external change. |
| **Recovery cache file itself is corrupted (e.g. torn by an unrelated crash)** | Skipped with a logged warning at startup, exactly as `recovery.js`'s existing `readAll()` already does for its `localStorage` blob today — this behavior must carry over unchanged to the on-disk format. |

---

## Production Test Matrix

| Category | Test | Expected outcome |
|---|---|---|
| **Normal** | Save a small document (<10KB) | File updated in place; recovery snapshot for it cleared. |
| **Normal** | Save a large document (multi-MB, e.g. a big generated changelog) | Same guarantee, no timeout, no truncation; verify temp file is same-filesystem as target (not `/tmp`, which may be a different mount). |
| **Normal** | Reopen the app after a clean quit with a workspace open | Workspace re-allowed, tree reloads, no stale recovery prompts for files that were actually saved. |
| **Failure** | Save to a path where the parent directory was deleted externally after the file was opened | Specific "location no longer exists" message; offer Save As; no crash. |
| **Failure** | Save with the disk at 0 bytes free (`ENOSPC`) | Real file untouched; temp file cleaned up; specific "disk full" message. |
| **Failure** | Save to a read-only file/directory (`EACCES`) | Specific "permission denied" message; real file untouched. |
| **Failure** | Malformed/corrupted recovery-cache file present at startup | Startup succeeds; corrupted entry skipped and logged; other valid entries still load. |
| **Crash** | `kill -9` the app mid-write (during the temp-file write, before rename) | On relaunch: real file has its pre-crash content, byte-for-byte; an orphaned `.tmp-*` file may exist and should be either ignored or swept on next successful save to the same path. |
| **Crash** | `kill -9` the app immediately after `rename()` but before the directory fsync | On relaunch: real file has the new content (POSIX rename durability characteristics — verify on the actual target filesystem, since exact guarantees are FS-dependent). |
| **Crash** | Power-cycle (hard reset, not `kill -9`) mid-write, on real hardware or a VM with disk write-back caching enabled | Same guarantee as the `kill -9` case — this is the test that actually exercises the fsync calls, which a plain process-kill does not. |
| **Concurrency** | Edit a file in the app; modify the same file externally (`vim`, `git checkout`) before saving in-app | Conflict detected via stat comparison; user is prompted, not silently overwritten. |
| **Concurrency** | Two workspaces open in the same app instance, one file in each being edited simultaneously | Each document's recovery snapshot is independent (verifies the one-file-per-document redesign — no cross-contamination between snapshot writes). |
| **Concurrency** | Symlink inside an allowed workspace folder pointing outside it | Read/write/delete through the symlink is rejected once `realpath` resolution is added (currently: **not rejected — known P1 gap**, this test should fail today and is the regression test for that fix). |
| **Concurrency** | Call `reallow-folder` via devtools console with an arbitrary path outside any previously-picked folder | Rejected once the P0 fix lands (currently: **succeeds — known P0 gap**, this is the regression test for that fix). |
| **Scale** | 500+ file workspace, recovery cache with 15-20 pending snapshots simultaneously | Explorer/tree rendering and recovery-cache writes stay responsive; verify the byte-size cap (once implemented) actually bounds total cache directory size. |
| **Scale** | Very large single document (10MB+ Markdown) with autosave enabled | Debounced autosave doesn't block the UI thread; textarea autosize (recently fixed) and recovery snapshotting both stay responsive while typing. |

---

## Architecture Decision Records

### ADR-001: Adapter-object pattern for filesystem backend abstraction
**Status:** Accepted (implemented, `js/core/electronFsAdapter.js`)
**Context:** The app needs to support both the browser File System Access
API and Electron's IPC-backed filesystem without duplicating
`workspaceIO.js`'s directory-walking/file-creation logic.
**Decision:** Construct plain objects shaped identically to the browser's
own `FileSystemDirectoryHandle`/`FileSystemFileHandle` (same method names,
same `NotFoundError`-named throw behavior), backed by IPC calls instead of
the real browser API.
**Consequences:** `workspaceIO.js`/`fileIO.js` needed only a small branch at
their entry points, not a rewrite or a formal strategy/DI abstraction. This
is the right amount of complexity for exactly two backends and should not be
generalized further (e.g. into a plugin system) without a third real backend
to justify it.

### ADR-002: Main-process allowlist as the sole security boundary
**Status:** Accepted, **implementation incomplete** (see P0/P1 findings, §7)
**Context:** A renderer with `nodeIntegration: false` has no direct
filesystem access; every read/write must cross the IPC bridge, which must
therefore be the enforcement point for "only what the user explicitly
opened."
**Decision:** An in-memory `allowlist` array in the main process, checked by
every IPC handler before touching disk, populated only by
`dialog.showOpenDialog` results (user-initiated) or the remembered
last-opened folder.
**Consequences:** Correct architectural placement of the boundary. Two
implementation gaps undermine it today: `reallow-folder` accepts any path
with no validation (P0), and path comparison doesn't resolve symlinks (P1).
Both are fixes *within* this decision, not reasons to reconsider it.

### ADR-003: Recovery cache storage location — localStorage (superseded) → on-disk XDG-style directory (proposed)
**Status:** Proposed supersession of the current implementation
**Context:** The recovery cache (`js/core/recovery.js`) was designed when
this app was browser-only and had no other persistence option.
`localStorage` is no longer the only — or the appropriate — choice now that
the app has real filesystem access via Electron.
**Decision (proposed):** Move to one JSON file per document identity under
`app.getPath('cache')` (or `userData`, pending the config-vs-cache
distinction noted in §4), with atomic writes and a byte-size-bounded LRU
eviction policy in place of the current count cap.
**Consequences:** Fixes the write-amplification (§5), quota, and durability
gaps. Requires a one-time migration path for any snapshots currently sitting
in a user's `localStorage` from the browser-only era (out of scope for this
review — flagged for the implementation plan).

### ADR-004: Atomic write pattern for real file saves
**Status:** Proposed, not yet implemented
**Context:** §2/§3 — `fs.writeFile` in place is not crash-safe.
**Decision (proposed):** temp file in the same directory → `fsync(fd)` →
close → `rename()` → `fsync` the directory. Applied to both the real-file
save path and the on-disk recovery cache (ADR-003).
**Consequences:** Eliminates the truncation-on-crash risk entirely (rename
is atomic on POSIX). Adds a small amount of complexity to `write-file`'s IPC
handler and requires cleanup of orphaned temp files on `ENOSPC`/other
mid-write failures (§3). No user-facing behavior change on the happy path.

### ADR-005: No external file-watching for v1
**Status:** Accepted (deliberate scope cut, not a gap in itself)
**Context:** Detecting external edits proactively (rather than only at
save-time) requires `fs.watch`/inotify, with the event-coalescing
complexity noted in §6.
**Decision:** Not implemented in this pass. The stat-at-save-time collision
check (ADR-003/§4) is the cheaper, correct minimum; a watcher is a proactive
*enhancement* on top of it, not a substitute for it.
**Consequences:** The app cannot warn about an external edit until the user
actually tries to save. Acceptable for now; revisit once the stat-based
check ships and its UX is validated. If/when built, must coalesce raw events
by path (§6) rather than react to each one individually.

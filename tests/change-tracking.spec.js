const { test, expect } = require('@playwright/test');

// js/core/changeTracking.js (extracted from main.js, #29) is pure, so it is
// exercised directly with explicit state instead of through the UI.
const run = (page, fn) => page.evaluate(async (src) => {
  const ct = await import('/js/core/changeTracking.js');
  const parser = await import('/js/markdown/parser.js');
  // eslint-disable-next-line no-new-func
  return new Function('ct', 'parser', `return (${src})(ct, parser);`)(ct, parser);
}, fn.toString());

test.beforeEach(async ({ page }) => { await page.goto('/index.html'); });

const BASE = '# T\n\n## A\n\none\n\n## B\n\ntwo\n';
const EDIT = '# T\n\n## A\n\none edited\n\n## B\n\ntwo\n';

test('counts changed sections; undiffable snapshot counts as 1; identical diffs to 0', async ({ page }) => {
  const out = await run(page, (ct) => ({
    edited: ct.countChangedSections({ markdown: '# T\n\n## A\n\none edited\n\n## B\n\ntwo\n', baselineMarkdown: '# T\n\n## A\n\none\n\n## B\n\ntwo\n' }),
    same: ct.countChangedSections({ markdown: '# T\n\n## A\n\none\n', baselineMarkdown: '# T\n\n## A\n\none\n' }),
    noBaseline: ct.countChangedSections({ markdown: '# T\n' }),
  }));
  expect(out).toEqual({ edited: 1, same: 0, noBaseline: 1 });
});

test('file dirtiness is per-file: active uses the live flag, others use pending snapshots', async ({ page }) => {
  const out = await run(page, (ct) => {
    const state = { doc: {}, dirty: false, fileName: 'a.md', workspaceRelPath: null, workspaceRootName: null };
    const snaps = [{ id: 'file::b.md' }];
    return {
      activeClean: ct.isFileDirty({ fileName: 'a.md' }, state, snaps),
      otherPending: ct.isFileDirty({ fileName: 'b.md' }, state, snaps),
      otherNone: ct.isFileDirty({ fileName: 'c.md' }, state, snaps),
      anyViaSnapshot: ct.hasAnyUnsavedChanges(state, snaps),
      anyNone: ct.hasAnyUnsavedChanges(state, []),
      anyViaActive: ct.hasAnyUnsavedChanges({ ...state, dirty: true }, []),
    };
  });
  expect(out).toEqual({ activeClean: false, otherPending: true, otherNone: false, anyViaSnapshot: true, anyNone: false, anyViaActive: true });
});

test('active-gap helpers only apply while the active edit has no snapshot yet', async ({ page }) => {
  const out = await run(page, (ct, parser) => {
    const doc = parser.parseMarkdown('# T\n\n## A\n\none edited\n\n## B\n\ntwo\n');
    const base = '# T\n\n## A\n\none\n\n## B\n\ntwo\n';
    const state = { doc, dirty: true, fileName: 'a.md', workspaceRelPath: null, workspaceRootName: null };
    return {
      gap: ct.activeGapChangedCount(state, base, []),
      covered: ct.activeGapChangedCount(state, base, [{ id: 'file::a.md' }]),
      noBaseline: ct.activeGapChangedCount(state, null, []),
      row: ct.activeGapSnapshot(state, [], 5)?.id,
      rowCovered: ct.activeGapSnapshot(state, [{ id: 'file::a.md' }], 5),
    };
  });
  expect(out).toEqual({ gap: 1, covered: 0, noBaseline: 0, row: 'file::a.md', rowCovered: null });
});

test('pendingWorkspacePaths lists only that workspace\'s snapshots; enrichSnapshot never throws', async ({ page }) => {
  const out = await run(page, (ct) => ({
    paths: [...ct.pendingWorkspacePaths({ rootName: 'W' }, [
      { workspaceRootName: 'W', workspaceRelPath: 'x.md' }, { workspaceRootName: 'Z', workspaceRelPath: 'y.md' }, { fileName: 'loose.md' },
    ])],
    none: [...ct.pendingWorkspacePaths(null, [])],
    enriched: ct.enrichSnapshot({ markdown: '# T\n\n## A\n\nx\n', baselineMarkdown: '# T\n\n## A\n\ny\n' }).changedSections.length,
    noBaseline: ct.enrichSnapshot({ markdown: '# T\n' }).changedSections,
  }));
  expect(out).toEqual({ paths: ['x.md'], none: [], enriched: 1, noBaseline: null });
});

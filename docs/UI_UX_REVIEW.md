# Minimalist UI Research — Findings & Application

A short, source-grounded look at what UX research actually says about
minimalist interface design, and how it maps onto MD.Orchestra's current UI
— what's already aligned (a lot of this session's earlier work turns out to
match established research directly), and what's worth doing next.

## What the research says

**Minimalism is a 30-year-old, well-studied usability heuristic, not a
visual trend.** Jakob Nielsen included "aesthetic and minimalist design" in
his original 1995 ten usability heuristics: every extra element on a screen
competes with the elements that actually matter and adds to what the user
has to visually parse before finding what they need ([NN/g — Aesthetic and
Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/)).
The underlying mechanism is cognitive load: fewer competing elements means
less to process before acting, which is why stripping an interface down to
what a task actually needs tends to make it measurably faster to use, not
just nicer to look at ([NN/g — The Roots of Minimalism in Web
Design](https://www.nngroup.com/articles/roots-minimalism-web-design/)).

**The aesthetic-usability effect is the reason this matters even before
someone tries the product.** Users perceive a more attractive design as
more usable — and, notably, this bias holds even when the prettier design
genuinely isn't more usable ([Wikipedia — Aesthetic–usability
effect](https://en.wikipedia.org/wiki/Aesthetic%E2%80%93usability_effect);
[LogRocket — How aesthetics impact
usability](https://blog.logrocket.com/ux-design/aesthetic-usability-effect-ux/)).
A clean first impression buys real goodwill, which is directly relevant to
a README's own hero screenshot/GIF, not just the running app.

**Minimalism has a well-documented failure mode: over-simplifying past the
point of removing necessary information also raises cognitive load, just
via a different path** — the user now has to *recall* or *hunt for* what
was hidden, instead of parsing what's visible ([NN/g — Aesthetic and
Minimalist Design](https://www.nngroup.com/articles/aesthetic-minimalist-design/)).
The fix research converges on is **progressive disclosure**: show only what
most users need for the primary task, and defer secondary/advanced
functionality to a click away (a menu, a settings panel, a modal) rather
than deleting it or leaving it visible all the time ([NN/g via IxDF —
Progressive Disclosure](https://ixdf.org/literature/topics/progressive-disclosure);
[Wikipedia — Progressive
disclosure](https://en.wikipedia.org/wiki/Progressive_disclosure)).

**For developer tools/editors specifically**, current UI guidance
emphasizes: a distraction-free editing canvas with visual breathing room;
contextual controls that appear only when relevant instead of a toolbar
that's always fully populated; status/state shown ambiently (save state,
word count) rather than requiring a click to check; and dark mode as a
baseline expectation, not a nice-to-have ([Velt — Rich Text Editor UI
Design Best
Practices](https://velt.dev/blog/rich-text-editor-ui-design-best-practices)).
For power users specifically, **keyboard-first interaction** — consistent,
discoverable shortcuts, ideally documented in one place the user can pull up
on demand — is the established pattern for tools whose users repeat the
same actions all day ([Microsoft Learn — Guidelines for Keyboard User
Interface
Design](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/dnacc/guidelines-for-keyboard-user-interface-design);
[Mobbin — Command Palette UI
Design](https://mobbin.com/glossary/command-palette)).

## Where MD.Orchestra already matches this

Several changes made earlier in this project's history turn out to be
textbook applications of the research above, not just taste:

- **Removing the header's "💾 Save" button** in favor of Ctrl/⌘+S
  (commit section) and Ctrl/⌘+Shift+S (write to disk) is progressive
  disclosure applied to an action-heavy tool: the control most users repeat
  constantly moved to muscle memory instead of a permanently-visible button
  competing for header space.
- **Consolidating "Open .md file"/"Open folder" into the sidebar's own
  icon toolbar**, next to File+/Section+/Changes, replaced two visually
  separate button groups with one coherent row — directly the "remove what
  competes with the essential content" heuristic, applied to chrome rather
  than content.
- **The "⌨ Keyboard shortcuts" entry living only in Settings** (the
  redundant header button was removed) is progressive disclosure for a
  secondary, occasional-use feature: available on demand, not permanently
  taking up header space for something most sessions never need to open.
- **The Workspace map's node-link tidy tree** (replacing a flatter,
  always-fully-expanded list) is minimalism applied to information density
  rather than chrome: collapsed by default, expanding only the branch
  you actually click into, so a large directory doesn't front-load more
  than the current task needs.
- **Dark mode as a first-class, remembered setting** (not an afterthought)
  matches the "table stakes for a modern editor" guidance directly.

## Concrete gaps worth addressing

Ranked by effort-to-value, grounded in the research above rather than
subjective preference:

1. **No visible keyboard-shortcut discoverability inline** — shortcuts live
   in Settings → Keyboard shortcuts and the `?` key, both of which require
   already knowing to look. A one-line hint the very first time a document
   loads (dismissible, shown once) would close the gap between "the
   shortcuts exist" and "a new user discovers them," without adding any
   permanent chrome — itself progressive disclosure, just at the *very*
   first session rather than a permanent fixture.
2. **The section-card toolbar (Undo / Add note / Delete section / AI
   insight) is fully visible on every card at all times**, whether or not
   the user is currently editing that section. A contextual toolbar that
   only fully appears on hover/focus of a card (already partially the
   pattern for the "regenerate from headings" action) would reduce the
   at-rest visual weight of a long document's card grid — the
   distraction-free-canvas principle applied to the one screen most time is
   actually spent on. This is a real trade-off against discoverability for
   new users, so it's a candidate to try, not a default to assume correct.
3. **No command palette.** Given the app already has a real, growing set of
   keyboard shortcuts and a keyboard-first power-user audience (its own
   README already frames it that way), a searchable command palette
   (`Ctrl/⌘+K`-style) is the single highest-leverage addition the research
   above points to for this specific category of tool — it turns "remember
   the shortcut" into "type roughly what you want," without adding any
   permanently-visible UI at all. Flagged here as a genuine feature
   proposal, not something to build unprompted in this pass.

Items 1 and 3 are additive (no existing behavior changes); item 2 is a
visual trade-off that changes today's default and should be tried and
looked at before committing to it, not assumed correct from research alone.

## Sources

- [NN/g — Aesthetic and Minimalist Design (Usability Heuristic #8)](https://www.nngroup.com/articles/aesthetic-minimalist-design/)
- [NN/g — The Roots of Minimalism in Web Design](https://www.nngroup.com/articles/roots-minimalism-web-design/)
- [Wikipedia — Aesthetic–usability effect](https://en.wikipedia.org/wiki/Aesthetic%E2%80%93usability_effect)
- [LogRocket — How do aesthetics impact usability in UX](https://blog.logrocket.com/ux-design/aesthetic-usability-effect-ux/)
- [Wikipedia — Progressive disclosure](https://en.wikipedia.org/wiki/Progressive_disclosure)
- [Interaction Design Foundation — What Is Progressive Disclosure?](https://ixdf.org/literature/topics/progressive-disclosure)
- [Velt — Rich Text Editor UI Design Best Practices](https://velt.dev/blog/rich-text-editor-ui-design-best-practices)
- [Microsoft Learn — Guidelines for Keyboard User Interface Design](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/dnacc/guidelines-for-keyboard-user-interface-design)
- [Mobbin — Command Palette UI Design](https://mobbin.com/glossary/command-palette)

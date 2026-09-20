package com.mdorchestra.app;

/**
 * A one-shot holder for a Markdown file MainActivity received via
 * ACTION_VIEW (opened directly, e.g. tapped in a file manager) or
 * ACTION_SEND (shared in from another app's own "Share" sheet) before the
 * JS side was ready to ask for it. There's no reliable way to call
 * straight into the WebView the moment the native Activity receives the
 * intent -- it may not have finished loading js/main.js yet on a cold
 * start -- so MainActivity just stashes it here, and the web app takes it
 * (see ShareReceiverPlugin) once, on its own startup.
 */
public class PendingSharedFile {
    public static class Entry {
        public final String name;
        public final String text;

        public Entry(String name, String text) {
            this.name = name;
            this.text = text;
        }
    }

    private static Entry pending;

    public static synchronized void set(String name, String text) {
        pending = new Entry(name, text);
    }

    /** Returns and clears whatever's pending, so a later, unrelated startup never replays a stale share. */
    public static synchronized Entry take() {
        Entry entry = pending;
        pending = null;
        return entry;
    }
}

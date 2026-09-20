package com.mdorchestra.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;

import com.getcapacitor.BridgeActivity;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ShareReceiverPlugin.class);
        super.onCreate(savedInstanceState);
        handleIncomingIntent(getIntent());
    }

    // launchMode="singleTask" (see AndroidManifest.xml) routes a file
    // opened/shared in while the app is already running here instead of
    // spinning up a second instance -- without overriding this too, only
    // the very first share of a session would ever be picked up.
    @Override
    public void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    /**
     * A .md file opened directly (ACTION_VIEW — tapped in a file manager,
     * or Android's own "Open with") or shared in from another app
     * (ACTION_SEND — that app's "Share" sheet): read its name and content
     * right away and stash it in PendingSharedFile for the JS side to
     * collect once it's actually loaded (see ShareReceiverPlugin) — there
     * is no reliable way to hand it straight to the WebView from here,
     * since js/main.js may not have run yet on a cold start.
     */
    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        Uri uri = null;
        if (Intent.ACTION_VIEW.equals(action)) {
            uri = intent.getData();
        } else if (Intent.ACTION_SEND.equals(action)) {
            uri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (uri == null) return;

        String text = readTextFrom(uri);
        if (text == null) return;
        String name = queryDisplayName(uri);
        PendingSharedFile.set(name != null ? name : "shared.md", text);
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null) return name;
                }
            }
        } catch (Exception ignored) {
            // Some providers don't support this query at all -- the URI's
            // own last path segment below is a reasonable fallback name.
        }
        return uri.getLastPathSegment();
    }

    private String readTextFrom(Uri uri) {
        ContentResolver resolver = getContentResolver();
        try (InputStream is = resolver.openInputStream(uri)) {
            if (is == null) return null;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(is, StandardCharsets.UTF_8))) {
                char[] buf = new char[8192];
                int n;
                while ((n = reader.read(buf)) != -1) sb.append(buf, 0, n);
            }
            return sb.toString();
        } catch (IOException e) {
            return null;
        }
    }
}

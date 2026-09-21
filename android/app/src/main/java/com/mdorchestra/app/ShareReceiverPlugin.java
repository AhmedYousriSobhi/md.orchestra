package com.mdorchestra.app;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The JS-facing half of "open MD.Orchestra with a .md file from another
 * app" (a file manager's own "Open with"/"Share", an email attachment,
 * etc.) — see PendingSharedFile for what actually captures the incoming
 * file, over in MainActivity's onCreate/onNewIntent.
 */
@CapacitorPlugin(name = "ShareReceiver")
public class ShareReceiverPlugin extends Plugin {
    @PluginMethod
    public void takePendingSharedFile(PluginCall call) {
        PendingSharedFile.Entry entry = PendingSharedFile.take();
        JSObject ret = new JSObject();
        if (entry != null) {
            ret.put("name", entry.name);
            ret.put("text", entry.text);
        } else {
            ret.put("name", JSObject.NULL);
            ret.put("text", JSObject.NULL);
        }
        call.resolve(ret);
    }
}

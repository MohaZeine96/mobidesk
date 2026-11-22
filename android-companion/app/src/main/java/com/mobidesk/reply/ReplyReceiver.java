package com.mobidesk.reply;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.util.Base64;

import java.nio.charset.StandardCharsets;

public final class ReplyReceiver extends BroadcastReceiver {
    private static final String ACTION_APP_LABELS = "com.mobidesk.reply.APP_LABELS";

    @Override
    public void onReceive(Context context, Intent intent) {
        String status;
        if (ACTION_APP_LABELS.equals(intent.getAction())) {
            status = appLabels(context, intent.getStringExtra("packages"));
        } else {
            try {
                String key = decode(intent.getStringExtra("key"));
                String text = decode(intent.getStringExtra("text"));
                status = key.isEmpty() || text.trim().isEmpty()
                        ? "invalid-request"
                        : NotificationReplyListener.sendReply(key, text);
            } catch (IllegalArgumentException exception) {
                status = "invalid-request";
            }
        }
        setResultCode("sent".equals(status) || status.startsWith("labels:") ? Activity.RESULT_OK : Activity.RESULT_CANCELED);
        setResultData(status);
    }

    private static String appLabels(Context context, String encodedPackages) {
        try {
            org.json.JSONArray packages = new org.json.JSONArray(decode(encodedPackages));
            org.json.JSONObject labels = new org.json.JSONObject();
            PackageManager packageManager = context.getPackageManager();
            for (int index = 0; index < packages.length(); index++) {
                String packageName = packages.optString(index);
                if (!packageName.matches("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+")) continue;
                try {
                    ApplicationInfo info = packageManager.getApplicationInfo(packageName, 0);
                    CharSequence label = packageManager.getApplicationLabel(info);
                    if (label != null && !label.toString().trim().isEmpty()) labels.put(packageName, label.toString());
                } catch (PackageManager.NameNotFoundException ignored) {
                }
            }
            return "labels:" + Base64.encodeToString(labels.toString().getBytes(StandardCharsets.UTF_8),
                    Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (org.json.JSONException | IllegalArgumentException exception) {
            return "invalid-label-request";
        }
    }

    private static String decode(String value) {
        if (value == null) return "";
        byte[] bytes = Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
        return new String(bytes, StandardCharsets.UTF_8);
    }
}

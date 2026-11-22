package com.mobidesk.reply;

import android.app.Notification;
import android.app.PendingIntent;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.content.Intent;
import android.os.Bundle;
import android.app.RemoteInput;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class NotificationReplyListener extends NotificationListenerService {
    private static final Map<String, ReplyAction> REPLY_ACTIONS = new ConcurrentHashMap<>();
    private static volatile NotificationReplyListener current;

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        current = this;
        for (StatusBarNotification notification : getActiveNotifications()) {
            rememberReplyAction(notification);
        }
    }

    @Override
    public void onListenerDisconnected() {
        current = null;
        REPLY_ACTIONS.clear();
        super.onListenerDisconnected();
        requestRebind(new android.content.ComponentName(this, NotificationReplyListener.class));
    }

    @Override
    public void onNotificationPosted(StatusBarNotification notification) {
        rememberReplyAction(notification);
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification notification) {
        REPLY_ACTIONS.remove(notification.getKey());
    }

    private void rememberReplyAction(StatusBarNotification statusBarNotification) {
        String key = statusBarNotification.getKey();
        Notification notification = statusBarNotification.getNotification();
        if (!isSupportedPackage(statusBarNotification.getPackageName()) || notification.actions == null) {
            REPLY_ACTIONS.remove(key);
            return;
        }

        ReplyAction selected = null;
        for (Notification.Action action : notification.actions) {
            if (action.actionIntent == null) continue;
            RemoteInput[] remoteInputs = freeformInputs(action.getRemoteInputs());
            if (remoteInputs.length == 0) continue;
            String title = action.title == null ? "" : action.title.toString().toLowerCase(Locale.ROOT);
            ReplyAction candidate = new ReplyAction(action.actionIntent, remoteInputs);
            if (selected == null || title.contains("reply")) selected = candidate;
            if (title.contains("reply")) break;
        }
        if (selected == null) REPLY_ACTIONS.remove(key);
        else REPLY_ACTIONS.put(key, selected);
    }

    private static RemoteInput[] freeformInputs(RemoteInput[] inputs) {
        if (inputs == null) return new RemoteInput[0];
        int count = 0;
        for (RemoteInput input : inputs) {
            if (input != null && input.getAllowFreeFormInput()) count++;
        }
        RemoteInput[] result = new RemoteInput[count];
        int index = 0;
        for (RemoteInput input : inputs) {
            if (input != null && input.getAllowFreeFormInput()) result[index++] = input;
        }
        return result;
    }

    private static boolean isSupportedPackage(String packageName) {
        return "com.whatsapp".equals(packageName)
                || "com.whatsapp.w4b".equals(packageName)
                || "org.telegram.messenger".equals(packageName)
                || "org.thunderdog.challegram".equals(packageName);
    }

    static String sendReply(String key, String text) {
        NotificationReplyListener listener = current;
        if (listener == null) return "listener-unavailable";
        ReplyAction action = REPLY_ACTIONS.get(key);
        if (action == null) return "no-reply-action";

        Bundle results = new Bundle();
        for (RemoteInput input : action.remoteInputs) {
            if (input.getResultKey() != null) results.putCharSequence(input.getResultKey(), text);
        }
        if (results.isEmpty()) return "no-reply-action";
        Intent fillInIntent = new Intent();
        RemoteInput.addResultsToIntent(action.remoteInputs, fillInIntent, results);
        try {
            action.pendingIntent.send(listener, 0, fillInIntent);
            return "sent";
        } catch (PendingIntent.CanceledException exception) {
            REPLY_ACTIONS.remove(key);
            return "reply-action-expired";
        }
    }

    private static final class ReplyAction {
        final PendingIntent pendingIntent;
        final RemoteInput[] remoteInputs;

        ReplyAction(PendingIntent pendingIntent, RemoteInput[] remoteInputs) {
            this.pendingIntent = pendingIntent;
            this.remoteInputs = remoteInputs;
        }
    }
}

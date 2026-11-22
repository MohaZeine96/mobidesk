package com.mobidesk.reply;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private TextView status;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        layout.setPadding(padding, padding, padding, padding);

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextSize(22);
        layout.addView(title);

        TextView explanation = new TextView(this);
        explanation.setText("MobiDesk uses Android notification reply actions for WhatsApp and Telegram, and can request display names for installed apps. "
                + "Enable notification access below. Reply actions are kept in memory and are not sent to a cloud service.");
        explanation.setTextSize(16);
        LinearLayout.LayoutParams explanationParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        explanationParams.topMargin = padding / 2;
        layout.addView(explanation, explanationParams);

        status = new TextView(this);
        status.setTextSize(14);
        LinearLayout.LayoutParams statusParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        statusParams.topMargin = padding / 2;
        layout.addView(status, statusParams);

        Button enableButton = new Button(this);
        enableButton.setText("Open notification access settings");
        enableButton.setOnClickListener(view ->
                startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        buttonParams.topMargin = padding / 2;
        layout.addView(enableButton, buttonParams);
        setContentView(layout);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (status == null) return;
        String enabledListeners = Settings.Secure.getString(
                getContentResolver(), "enabled_notification_listeners");
        String component = new ComponentName(this, NotificationReplyListener.class).flattenToString();
        status.setText(enabledListeners != null && enabledListeners.contains(component)
                ? "Notification access is enabled."
                : "Notification access is not enabled.");
    }
}

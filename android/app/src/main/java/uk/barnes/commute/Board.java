package uk.barnes.commute;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Fetches the board's plain-text summary (/api/text) and draws it on every copy of the widget. Call off the main thread. */
final class Board {
    private Board() {}

    static void refresh(Context context) {
        Context app = context.getApplicationContext();
        SharedPreferences prefs = app.getSharedPreferences("board", Context.MODE_PRIVATE);
        String text;
        try {
            text = fetch(app);
            prefs.edit().putString("last", text).apply();
        } catch (Exception e) {
            String last = prefs.getString("last", null);
            String why = e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "");
            text = last != null ? last + "\n(offline)" : "Barnes trains\nCan't reach the board\n" + why + "\n\nTap to retry\n";
        }
        draw(app, text);
    }

    static String fetch(Context c) throws Exception {
        URL url = new URL(c.getString(R.string.board_url) + "/api/text?key=" + c.getString(R.string.board_key));
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(15_000);
        conn.setRequestProperty("User-Agent", "BarnesTrainsWidget");
        try {
            int code = conn.getResponseCode();
            if (code != 200) throw new Exception("HTTP " + code);
            try (InputStream in = conn.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                return out.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            conn.disconnect();
        }
    }

    static void draw(Context c, String text) {
        String[] lines = text.trim().split("\n");
        boolean offline = lines.length > 0 && lines[lines.length - 1].equals("(offline)");
        int end = offline ? lines.length - 1 : lines.length;
        // title, trains…, barrier, updated
        String title = end > 0 ? lines[0] : "Barnes trains";
        String updated = end > 2 ? lines[end - 1] : "";
        String barrier = end > 3 ? lines[end - 2] : "";
        int trainsEnd = end > 3 ? end - 2 : end;
        String headline = trainsEnd > 1 ? lines[1] : "";
        StringBuilder more = new StringBuilder();
        for (int i = 2; i < trainsEnd; i++) more.append(more.length() > 0 ? "\n" : "").append(lines[i]);

        RemoteViews v = new RemoteViews(c.getPackageName(), R.layout.trains_widget);
        v.setTextViewText(R.id.title, title);
        v.setTextViewText(R.id.headline, headline);
        v.setTextViewText(R.id.more, more.toString());
        v.setTextViewText(R.id.barrier, barrier);
        v.setTextViewText(R.id.updated, updated.replace("Updated ", "") + (offline ? " · offline" : ""));
        int dot = barrier.contains("Closed") ? 0xFFFF6B6B : barrier.contains("Closing") ? 0xFFFFC857 : 0xFF7CE08A;
        v.setTextColor(R.id.barrier_dot, dot);

        PendingIntent open = PendingIntent.getActivity(c, 1,
                new Intent(Intent.ACTION_VIEW, OpenBoardActivity.boardUri(c)), PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.root, open);
        // Refreshing from a (briefly shown, invisible) activity always has internet access.
        PendingIntent refresh = PendingIntent.getActivity(c, 2, new Intent(c, RefreshActivity.class), PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.barrier, refresh);
        v.setOnClickPendingIntent(R.id.updated, refresh);

        AppWidgetManager m = AppWidgetManager.getInstance(c);
        m.updateAppWidget(new ComponentName(c, TrainsWidget.class), v);
    }
}

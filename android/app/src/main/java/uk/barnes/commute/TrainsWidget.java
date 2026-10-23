package uk.barnes.commute;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.widget.RemoteViews;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Home-screen widget. Shows the board's plain-text summary (/api/text): to Waterloo before 1pm, home after.
 * Lines: title, 1–3 trains, barrier, "Updated hh:mm". Refreshes every 5 minutes (Android may stretch that) and when
 * tapped on the barrier line; tapping anywhere else opens the full board.
 */
public class TrainsWidget extends AppWidgetProvider {
    static final String REFRESH = "uk.barnes.commute.REFRESH";
    private static final long EVERY_MS = 5 * 60_000L;

    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        schedule(context);
        refresh(context);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        super.onReceive(context, intent);
        if (REFRESH.equals(intent.getAction())) refresh(context);
    }

    @Override
    public void onDisabled(Context context) {
        alarms(context).cancel(refreshIntent(context));
    }

    private static AlarmManager alarms(Context c) {
        return (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
    }

    private static PendingIntent refreshIntent(Context c) {
        Intent i = new Intent(c, TrainsWidget.class).setAction(REFRESH);
        return PendingIntent.getBroadcast(c, 0, i, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private static void schedule(Context c) {
        alarms(c).setInexactRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + EVERY_MS, EVERY_MS, refreshIntent(c));
    }

    /** Fetch on a background thread (network isn't allowed on the main one), then redraw every copy of the widget. */
    private void refresh(Context context) {
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            SharedPreferences prefs = app.getSharedPreferences("board", Context.MODE_PRIVATE);
            String text;
            try {
                text = fetch(app);
                prefs.edit().putString("last", text).apply();
            } catch (Exception e) {
                String last = prefs.getString("last", null);
                text = last != null ? last + "\n(offline)" : "Barnes trains\nCan't reach the board\n\nTap to retry\n";
            }
            draw(app, text);
            pending.finish();
        }).start();
    }

    private static String fetch(Context c) throws Exception {
        URL url = new URL(c.getString(R.string.board_url) + "/api/text?key=" + c.getString(R.string.board_key));
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(15_000);
        try (InputStream in = conn.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            if (conn.getResponseCode() != 200) throw new Exception("HTTP " + conn.getResponseCode());
            return out.toString(StandardCharsets.UTF_8.name());
        } finally {
            conn.disconnect();
        }
    }

    private static void draw(Context c, String text) {
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
        int dot = barrier.contains("DOWN") ? 0xFFFF6B6B : barrier.contains("CLOSING") ? 0xFFFFC857 : 0xFF7CE08A;
        v.setTextColor(R.id.barrier_dot, dot);

        PendingIntent open = PendingIntent.getActivity(c, 1,
                new Intent(Intent.ACTION_VIEW, OpenBoardActivity.boardUri(c)), PendingIntent.FLAG_IMMUTABLE);
        v.setOnClickPendingIntent(R.id.root, open);
        v.setOnClickPendingIntent(R.id.barrier, refreshIntent(c));

        AppWidgetManager m = AppWidgetManager.getInstance(c);
        m.updateAppWidget(new ComponentName(c, TrainsWidget.class), v);
    }
}

package uk.barnes.commute;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.concurrent.TimeUnit;

import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.dnsoverhttps.DnsOverHttps;

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
            String at = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.UK).format(new java.util.Date());
            text = last != null ? last + "\n(offline)" : "Barnes trains\nCan't reach the board\n" + why + "\n\nTried " + at + " · tap to retry\n";
        }
        draw(app, text);
    }

    private static OkHttpClient client;

    /**
     * Looks addresses up the normal way, and if that fails asks Cloudflare over HTTPS (as Chrome's "Secure DNS"
     * does) – some home networks can't resolve *.vercel.app even though the browser can.
     */
    private static synchronized OkHttpClient client() {
        if (client != null) return client;
        OkHttpClient bootstrap = new OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).build();
        try {
            DnsOverHttps doh = new DnsOverHttps.Builder().client(bootstrap)
                    .url(HttpUrl.get("https://cloudflare-dns.com/dns-query"))
                    .bootstrapDnsHosts(InetAddress.getByName("1.1.1.1"), InetAddress.getByName("1.0.0.1"))
                    .build();
            Dns dns = hostname -> {
                try {
                    return Dns.SYSTEM.lookup(hostname);
                } catch (UnknownHostException e) {
                    return doh.lookup(hostname);
                }
            };
            client = bootstrap.newBuilder().dns(dns).readTimeout(15, TimeUnit.SECONDS).build();
        } catch (UnknownHostException e) { // IP literals never need a lookup; can't happen
            client = bootstrap;
        }
        return client;
    }

    /** The board directly, or if that can't be reached (some networks block *.vercel.app) via the barrier worker's relay. */
    static String fetch(Context c) throws Exception {
        String query = "?key=" + c.getString(R.string.board_key);
        try {
            return get(c.getString(R.string.board_url) + "/api/text" + query);
        } catch (java.io.IOException direct) {
            try {
                return get(c.getString(R.string.relay_url) + query);
            } catch (Exception relay) {
                direct.addSuppressed(relay);
                throw direct;
            }
        }
    }

    private static String get(String url) throws Exception {
        Request req = new Request.Builder().url(url).header("User-Agent", "BarnesTrainsWidget").build();
        try (Response res = client().newCall(req).execute()) {
            if (res.code() != 200 || res.body() == null) throw new java.io.IOException("HTTP " + res.code());
            return res.body().string();
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

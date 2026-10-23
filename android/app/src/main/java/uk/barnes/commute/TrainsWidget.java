package uk.barnes.commute;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;

/**
 * Home-screen widget showing the board's plain-text summary: to Waterloo before 1pm, home after, and the barrier.
 * Updates run as scheduled jobs (RefreshJob), which Android always lets use the internet – broadcasts and alarms can
 * be cut off for apps in the background. Tap the barrier line to refresh now; tap elsewhere to open the full board.
 */
public class TrainsWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        RefreshJob.schedule(context);
        RefreshJob.runNow(context);
    }

    @Override
    public void onDisabled(Context context) {
        RefreshJob.cancel(context);
    }
}

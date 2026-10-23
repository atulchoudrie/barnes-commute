package uk.barnes.commute;

import android.app.Activity;
import android.os.Bundle;

/** Invisible activity behind "tap to refresh": the app is in the foreground for a moment, so it can always fetch. */
public class RefreshActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        new Thread(() -> {
            Board.refresh(this);
            runOnUiThread(this::finish);
        }).start();
    }
}

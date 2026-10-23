package uk.barnes.commute;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

/** The app icon (and tapping the widget) opens the full board in the browser. */
public class OpenBoardActivity extends Activity {
    static Uri boardUri(android.content.Context c) {
        return Uri.parse(c.getString(R.string.board_url) + "/?key=" + c.getString(R.string.board_key));
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startActivity(new Intent(Intent.ACTION_VIEW, boardUri(this)));
        finish();
    }
}

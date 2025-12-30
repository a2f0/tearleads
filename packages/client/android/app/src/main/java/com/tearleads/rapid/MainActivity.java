package com.tearleads.rapid;

import android.os.Bundle;
import android.webkit.WebView;
import com.tearleads.rapid.BuildConfig;
import androidx.core.view.WindowCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        // Enable WebView debugging for Maestro devtools mode in debug builds only for security
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        // Enable accessibility for WebView to support UI testing tools like Maestro
        WebView webView = getBridge().getWebView();
        if (webView != null) {
            webView.setImportantForAccessibility(WebView.IMPORTANT_FOR_ACCESSIBILITY_YES);
            webView.getSettings().setJavaScriptEnabled(true);
        }
    }
}

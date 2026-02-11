package com.tearleads.app;

import android.os.Bundle;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.session.MediaSessionCompat;
import androidx.media.MediaBrowserServiceCompat;
import java.util.List;

public class TearleadsMediaBrowserService extends MediaBrowserServiceCompat {
    @Override
    public void onCreate() {
        super.onCreate();
        MediaSessionController mediaSessionController = MediaSessionController.getInstance();
        mediaSessionController.initialize(this);
        MediaSessionCompat.Token sessionToken = mediaSessionController.getSessionToken();
        if (sessionToken != null) {
            setSessionToken(sessionToken);
        }
    }

    @Override
    @Nullable
    public BrowserRoot onGetRoot(
        @NonNull String clientPackageName,
        int clientUid,
        @Nullable Bundle rootHints
    ) {
        return new BrowserRoot(MediaSessionController.ROOT_ID, null);
    }

    @Override
    public void onLoadChildren(
        @NonNull String parentId,
        @NonNull Result<List<MediaBrowserCompat.MediaItem>> result
    ) {
        MediaSessionController mediaSessionController = MediaSessionController.getInstance();
        result.sendResult(mediaSessionController.loadChildren(parentId));
    }
}

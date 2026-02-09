package com.tearleads.rapid;

import androidx.annotation.Nullable;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "MediaSessionBridge")
public class MediaSessionBridgePlugin extends Plugin {
    private MediaSessionController mediaSessionController;

    @Override
    public void load() {
        super.load();
        mediaSessionController = MediaSessionController.getInstance();
        mediaSessionController.initialize(getContext());
        mediaSessionController.setTransportActionListener(
            (action, positionMs, mediaId) -> emitTransportAction(action, positionMs, mediaId)
        );
    }

    @PluginMethod
    public void updatePlaybackState(PluginCall call) {
        boolean isPlaying = call.getBoolean("isPlaying", false);
        long positionMs = call.getLong("positionMs", 0L);

        if (mediaSessionController != null) {
            mediaSessionController.updatePlaybackState(isPlaying, positionMs);
        }
        call.resolve();
    }

    @PluginMethod
    public void updateMetadata(PluginCall call) {
        String title = call.getString("title", "");
        String artist = call.getString("artist", "");
        String album = call.getString("album", "");
        long durationMs = call.getLong("durationMs", 0L);

        if (mediaSessionController != null) {
            mediaSessionController.updateMetadata(title, artist, album, durationMs);
        }

        call.resolve();
    }

    @PluginMethod
    public void clearMetadata(PluginCall call) {
        if (mediaSessionController != null) {
            mediaSessionController.clearMetadata();
        }

        call.resolve();
    }

    @PluginMethod
    public void updateCatalog(PluginCall call) {
        if (mediaSessionController == null) {
            call.resolve();
            return;
        }

        JSONArray tracksArray = call.getArray("tracks");
        List<MediaSessionController.MediaCatalogTrack> tracks = new ArrayList<>();
        if (tracksArray != null) {
            for (int i = 0; i < tracksArray.length(); i += 1) {
                JSONObject trackObject = tracksArray.optJSONObject(i);
                if (trackObject == null) {
                    continue;
                }

                String id = trackObject.optString("id", "");
                String title = trackObject.optString("title", "");
                if (id.isBlank() || title.isBlank()) {
                    continue;
                }

                String artist = trackObject.optString("artist", "");
                String album = trackObject.optString("album", "");
                long durationMs = trackObject.optLong("durationMs", 0L);
                tracks.add(
                    new MediaSessionController.MediaCatalogTrack(
                        id,
                        title,
                        artist,
                        album,
                        durationMs
                    )
                );
            }
        }
        mediaSessionController.updateCatalogTracks(tracks);
        call.resolve();
    }

    private void emitTransportAction(
        String action,
        @Nullable Long positionMs,
        @Nullable String mediaId
    ) {
        JSObject payload = new JSObject();
        payload.put("action", action);
        if (positionMs != null) {
            payload.put("positionMs", positionMs);
        }
        if (mediaId != null) {
            payload.put("mediaId", mediaId);
        }
        notifyListeners("transportControl", payload, true);
    }

    @Override
    protected void handleOnDestroy() {
        if (mediaSessionController != null) {
            mediaSessionController.setTransportActionListener(null);
        }
    }
}

package com.tearleads.rapid;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.os.SystemClock;
import android.view.KeyEvent;
import androidx.annotation.Nullable;
import androidx.media.session.MediaButtonReceiver;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import java.util.ArrayList;
import java.util.List;

public final class MediaSessionController {
    public static final String ROOT_ID = "rapid.root";
    public static final String TRACKS_ID = "rapid.tracks";
    private static final long TRANSPORT_ACTIONS =
        PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
            | PlaybackStateCompat.ACTION_STOP
            | PlaybackStateCompat.ACTION_SEEK_TO;

    public interface TransportActionListener {
        void onTransportAction(
            String action,
            @Nullable Long positionMs,
            @Nullable String mediaId
        );
    }

    public static class MediaCatalogTrack {
        public final String id;
        public final String title;
        public final String artist;
        public final String album;
        public final long durationMs;

        public MediaCatalogTrack(
            String id,
            String title,
            String artist,
            String album,
            long durationMs
        ) {
            this.id = id;
            this.title = title;
            this.artist = artist;
            this.album = album;
            this.durationMs = durationMs;
        }
    }

    private static MediaSessionController instance;

    private MediaSessionCompat mediaSession;
    private int currentPlaybackState = PlaybackStateCompat.STATE_NONE;
    private TransportActionListener transportActionListener;
    private final List<MediaCatalogTrack> catalogTracks = new ArrayList<>();

    private MediaSessionController() {}

    public static synchronized MediaSessionController getInstance() {
        if (instance == null) {
            instance = new MediaSessionController();
        }
        return instance;
    }

    public synchronized void initialize(Context context) {
        if (mediaSession != null) {
            return;
        }

        Context appContext = context.getApplicationContext();
        mediaSession = new MediaSessionCompat(appContext, "RapidMediaSession");
        mediaSession.setFlags(
            MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS
                | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
        );
        mediaSession.setPlaybackToLocal(AudioManager.STREAM_MUSIC);

        Intent mediaButtonIntent = new Intent(Intent.ACTION_MEDIA_BUTTON);
        mediaButtonIntent.setClass(appContext, MediaButtonReceiver.class);
        PendingIntent mediaButtonPendingIntent = PendingIntent.getBroadcast(
            appContext,
            1001,
            mediaButtonIntent,
            PendingIntent.FLAG_IMMUTABLE
        );
        mediaSession.setMediaButtonReceiver(mediaButtonPendingIntent);
        mediaSession.setCallback(createCallback());
        mediaSession.setActive(true);
        publishPlaybackState(false, 0L);
    }

    public synchronized void setTransportActionListener(
        @Nullable TransportActionListener listener
    ) {
        transportActionListener = listener;
    }

    @Nullable
    public synchronized MediaSessionCompat.Token getSessionToken() {
        return mediaSession == null ? null : mediaSession.getSessionToken();
    }

    public synchronized void updatePlaybackState(boolean isPlaying, long positionMs) {
        publishPlaybackState(isPlaying, positionMs);
    }

    public synchronized void updateMetadata(
        String title,
        String artist,
        String album,
        long durationMs
    ) {
        if (mediaSession == null) {
            return;
        }

        MediaMetadataCompat.Builder metadataBuilder = new MediaMetadataCompat.Builder();
        metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_TITLE, title);

        if (!artist.isBlank()) {
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist);
        }

        if (!album.isBlank()) {
            metadataBuilder.putString(MediaMetadataCompat.METADATA_KEY_ALBUM, album);
        }

        if (durationMs > 0) {
            metadataBuilder.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, durationMs);
        }

        mediaSession.setMetadata(metadataBuilder.build());
        mediaSession.setActive(true);
    }

    public synchronized void updateCatalogTracks(List<MediaCatalogTrack> tracks) {
        catalogTracks.clear();
        catalogTracks.addAll(tracks);
    }

    public synchronized List<MediaBrowserCompat.MediaItem> loadChildren(String parentId) {
        List<MediaBrowserCompat.MediaItem> items = new ArrayList<>();
        if (ROOT_ID.equals(parentId)) {
            MediaDescriptionCompat description =
                new MediaDescriptionCompat.Builder()
                    .setMediaId(TRACKS_ID)
                    .setTitle("Tracks")
                    .build();
            items.add(
                new MediaBrowserCompat.MediaItem(
                    description,
                    MediaBrowserCompat.MediaItem.FLAG_BROWSABLE
                )
            );
            return items;
        }

        if (TRACKS_ID.equals(parentId)) {
            for (MediaCatalogTrack track : catalogTracks) {
                MediaDescriptionCompat description =
                    new MediaDescriptionCompat.Builder()
                        .setMediaId(track.id)
                        .setTitle(track.title)
                        .setSubtitle(track.artist.isBlank() ? null : track.artist)
                        .setDescription(track.album.isBlank() ? null : track.album)
                        .build();
                items.add(
                    new MediaBrowserCompat.MediaItem(
                        description,
                        MediaBrowserCompat.MediaItem.FLAG_PLAYABLE
                    )
                );
            }
        }
        return items;
    }

    public synchronized void clearMetadata() {
        if (mediaSession == null) {
            return;
        }

        mediaSession.setMetadata(null);
        currentPlaybackState = PlaybackStateCompat.STATE_NONE;
        mediaSession.setPlaybackState(
            new PlaybackStateCompat.Builder()
                .setActions(TRANSPORT_ACTIONS)
                .setState(
                    currentPlaybackState,
                    0L,
                    0f,
                    SystemClock.elapsedRealtime()
                )
                .build()
        );
        mediaSession.setActive(false);
    }

    private MediaSessionCompat.Callback createCallback() {
        return new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                emitTransportAction("play", null, null);
            }

            @Override
            public void onPause() {
                emitTransportAction("pause", null, null);
            }

            @Override
            public void onSkipToNext() {
                emitTransportAction("next", null, null);
            }

            @Override
            public void onSkipToPrevious() {
                emitTransportAction("previous", null, null);
            }

            @Override
            public void onStop() {
                emitTransportAction("stop", null, null);
            }

            @Override
            public void onSeekTo(long positionMs) {
                emitTransportAction("seekTo", positionMs, null);
            }

            @Override
            public void onPlayFromMediaId(String mediaId, @Nullable android.os.Bundle extras) {
                emitTransportAction("play", null, mediaId);
            }

            @Override
            public boolean onMediaButtonEvent(Intent mediaButtonEvent) {
                KeyEvent keyEvent = mediaButtonEvent.getParcelableExtra(Intent.EXTRA_KEY_EVENT);
                if (
                    keyEvent != null &&
                    keyEvent.getAction() == KeyEvent.ACTION_DOWN &&
                    keyEvent.getKeyCode() == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE
                ) {
                    emitTransportAction("togglePlayPause", null, null);
                    return true;
                }
                return super.onMediaButtonEvent(mediaButtonEvent);
            }
        };
    }

    private synchronized void publishPlaybackState(boolean isPlaying, long positionMs) {
        if (mediaSession == null) {
            return;
        }

        currentPlaybackState =
            isPlaying ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        float speed = isPlaying ? 1.0f : 0.0f;

        PlaybackStateCompat playbackState =
            new PlaybackStateCompat.Builder()
                .setActions(TRANSPORT_ACTIONS)
                .setState(
                    currentPlaybackState,
                    Math.max(positionMs, 0L),
                    speed,
                    SystemClock.elapsedRealtime()
                )
                .build();

        mediaSession.setPlaybackState(playbackState);
        mediaSession.setActive(true);
    }

    private synchronized void emitTransportAction(
        String action,
        @Nullable Long positionMs,
        @Nullable String mediaId
    ) {
        if (transportActionListener != null) {
            transportActionListener.onTransportAction(action, positionMs, mediaId);
        }
    }
}

package com.tearleads.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.os.SystemClock;
import android.support.v4.media.MediaBrowserCompat;
import android.support.v4.media.MediaDescriptionCompat;
import android.support.v4.media.session.MediaControllerCompat;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MediaSessionControllerInstrumentedTest {

    private Context context;
    private MediaSessionController mediaSessionController;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        mediaSessionController = MediaSessionController.getInstance();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            mediaSessionController.initialize(context);
        });
    }

    @After
    public void tearDown() {
        mediaSessionController.setTransportActionListener(null);
        mediaSessionController.clearMetadata();
        mediaSessionController.updateCatalogTracks(new ArrayList<>());
    }

    @Test
    public void transportControls_emitExpectedActions() throws Exception {
        final List<TransportEvent> events = new CopyOnWriteArrayList<>();
        CountDownLatch latch = new CountDownLatch(7);

        mediaSessionController.setTransportActionListener((action, positionMs, mediaId) -> {
            events.add(new TransportEvent(action, positionMs, mediaId));
            latch.countDown();
        });

        MediaControllerCompat mediaController =
            new MediaControllerCompat(context, mediaSessionController.getSessionToken());
        MediaControllerCompat.TransportControls controls = mediaController.getTransportControls();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> {
            controls.play();
            controls.pause();
            controls.skipToNext();
            controls.skipToPrevious();
            controls.stop();
            controls.seekTo(2345L);
            controls.playFromMediaId("track-2", null);
        });

        assertTrue(
            "Timed out waiting for media transport callbacks",
            latch.await(5, TimeUnit.SECONDS)
        );
        assertEquals(7, events.size());
        assertEquals("play", events.get(0).action);
        assertEquals("pause", events.get(1).action);
        assertEquals("next", events.get(2).action);
        assertEquals("previous", events.get(3).action);
        assertEquals("stop", events.get(4).action);
        assertEquals("seekTo", events.get(5).action);
        assertEquals(Long.valueOf(2345L), events.get(5).positionMs);
        assertEquals("play", events.get(6).action);
        assertEquals("track-2", events.get(6).mediaId);
    }

    @Test
    public void catalogAndPlaybackState_arePublishedToSession() throws Exception {
        List<MediaSessionController.MediaCatalogTrack> tracks = new ArrayList<>();
        tracks.add(
            new MediaSessionController.MediaCatalogTrack(
                "track-1",
                "Track One",
                "Artist One",
                "Album One",
                12345L
            )
        );
        tracks.add(
            new MediaSessionController.MediaCatalogTrack(
                "track-2",
                "Track Two",
                "",
                "",
                9876L
            )
        );
        mediaSessionController.updateCatalogTracks(tracks);

        List<MediaBrowserCompat.MediaItem> rootItems =
            mediaSessionController.loadChildren(MediaSessionController.ROOT_ID);
        assertEquals(1, rootItems.size());
        MediaDescriptionCompat rootDescription = rootItems.get(0).getDescription();
        assertEquals(MediaSessionController.TRACKS_ID, rootDescription.getMediaId());
        assertEquals(
            MediaBrowserCompat.MediaItem.FLAG_BROWSABLE,
            rootItems.get(0).getFlags()
        );

        List<MediaBrowserCompat.MediaItem> trackItems =
            mediaSessionController.loadChildren(MediaSessionController.TRACKS_ID);
        assertEquals(2, trackItems.size());
        assertEquals("track-1", trackItems.get(0).getDescription().getMediaId());
        assertEquals("Track One", String.valueOf(trackItems.get(0).getDescription().getTitle()));
        assertEquals(
            MediaBrowserCompat.MediaItem.FLAG_PLAYABLE,
            trackItems.get(0).getFlags()
        );
        assertEquals("track-2", trackItems.get(1).getDescription().getMediaId());

        MediaControllerCompat mediaController =
            new MediaControllerCompat(context, mediaSessionController.getSessionToken());

        mediaSessionController.updateMetadata("Now Playing", "Test Artist", "Test Album", 7777L);
        mediaSessionController.updatePlaybackState(true, 4567L);

        assertEventually(
            () -> {
                MediaMetadataCompat metadata = mediaController.getMetadata();
                PlaybackStateCompat playbackState = mediaController.getPlaybackState();
                return metadata != null &&
                    "Now Playing".equals(
                        metadata.getString(MediaMetadataCompat.METADATA_KEY_TITLE)
                    ) &&
                    playbackState != null &&
                    playbackState.getState() == PlaybackStateCompat.STATE_PLAYING &&
                    playbackState.getPosition() >= 4567L;
            },
            "Expected active metadata and playing state"
        );

        mediaSessionController.clearMetadata();

        assertEventually(
            () -> {
                PlaybackStateCompat playbackState = mediaController.getPlaybackState();
                return mediaController.getMetadata() == null &&
                    playbackState != null &&
                    playbackState.getState() == PlaybackStateCompat.STATE_NONE;
            },
            "Expected metadata cleared and state reset"
        );
    }

    private interface Condition {
        boolean check();
    }

    private static void assertEventually(Condition condition, String message) {
        long deadline = SystemClock.elapsedRealtime() + 5000L;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (condition.check()) {
                return;
            }
            SystemClock.sleep(50L);
        }
        assertTrue(message, condition.check());
    }

    private static final class TransportEvent {
        final String action;
        final Long positionMs;
        final String mediaId;

        TransportEvent(String action, Long positionMs, String mediaId) {
            this.action = action;
            this.positionMs = positionMs;
            this.mediaId = mediaId;
        }
    }
}

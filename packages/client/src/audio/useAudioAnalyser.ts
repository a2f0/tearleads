/**
 * Hook for analyzing audio frequency data using the Web Audio API.
 * Connects to an HTMLAudioElement and provides real-time frequency data
 * for audio visualization.
 *
 * IMPORTANT: Once an audio element is connected to the Web Audio API via
 * createMediaElementSource(), it MUST stay connected for audio to play.
 * We use a module-level singleton to persist the connection across
 * component mount/unmount cycles.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface AudioAnalyserState {
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  source: MediaElementAudioSourceNode | null;
  connectedElement: HTMLAudioElement | null;
}

// Module-level singleton to persist Web Audio API connection
const globalState: AudioAnalyserState = {
  audioContext: null,
  analyser: null,
  source: null,
  connectedElement: null
};

export function useAudioAnalyser(
  audioElementRef: React.RefObject<HTMLAudioElement | null>,
  isPlaying: boolean,
  barCount = 12
): Uint8Array {
  const [frequencyData, setFrequencyData] = useState<Uint8Array>(
    () => new Uint8Array(barCount)
  );

  const animationFrameRef = useRef<number | null>(null);

  const initializeAudioContext = useCallback(() => {
    const audioElement = audioElementRef.current;
    if (!audioElement) return;

    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;

      const source = audioContext.createMediaElementSource(audioElement);
      source.connect(analyser);
      analyser.connect(audioContext.destination);

      globalState.audioContext = audioContext;
      globalState.analyser = analyser;
      globalState.source = source;
      globalState.connectedElement = audioElement;
    } catch (error) {
      console.error('Failed to initialize audio analyser:', error);
    }
  }, [audioElementRef]);

  const updateFrequencyData = useCallback(() => {
    const { analyser, audioContext } = globalState;

    if (!analyser || !audioContext) {
      return;
    }

    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const barsData = new Uint8Array(barCount);
    const binSize = Math.floor(bufferLength / barCount);

    for (let i = 0; i < barCount; i++) {
      let sum = 0;
      const startBin = i * binSize;
      for (let j = 0; j < binSize; j++) {
        sum += dataArray[startBin + j] ?? 0;
      }
      barsData[i] = Math.floor(sum / binSize);
    }

    setFrequencyData(barsData);
    animationFrameRef.current = requestAnimationFrame(updateFrequencyData);
  }, [barCount]);

  useEffect(() => {
    if (!isPlaying) {
      setFrequencyData(new Uint8Array(barCount));
      return;
    }

    const audioElement = audioElementRef.current;
    if (
      audioElement &&
      globalState.connectedElement &&
      globalState.connectedElement !== audioElement
    ) {
      console.warn('Audio analyser already connected to a different element');
      return;
    }

    // Initialize Web Audio API connection if not already done
    if (!globalState.connectedElement) {
      initializeAudioContext();
    }

    animationFrameRef.current = requestAnimationFrame(updateFrequencyData);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, barCount, initializeAudioContext, updateFrequencyData]);

  return frequencyData;
}

import { useEffect, useRef, useState } from "react";

// Detects whether a MediaStream currently carries voice activity (someone
// talking) by sampling the waveform in the time domain. Returns a boolean that
// only flips after the signal has been consistently above/below the threshold
// for several consecutive frames, preventing rapid flicker.
const useVoiceActivity = (
  stream: MediaStream | null,
  threshold = 0.02,
): boolean => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  // Hysteresis: require N consecutive frames in the new state before toggling.
  const consecutiveFramesRef = useRef(0);
  const speakingRef = useRef(false);
  const FRAMES_REQUIRED = 5;

  useEffect(() => {
    if (!stream) {
      setIsSpeaking(false);
      speakingRef.current = false;
      consecutiveFramesRef.current = 0;
      return;
    }

    const AudioContextCtor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextCtor) return;

    const audioContext = new AudioContextCtor();
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    audioContextRef.current = audioContext;
    sourceRef.current = source;
    analyserRef.current = analyser;

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const checkVolume = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const value = (dataArray[i] - 128) / 128;
        sum += value * value;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const rawSpeaking = rms > threshold;

      if (rawSpeaking === speakingRef.current) {
        consecutiveFramesRef.current = 0;
      } else {
        consecutiveFramesRef.current++;
        if (consecutiveFramesRef.current >= FRAMES_REQUIRED) {
          speakingRef.current = rawSpeaking;
          setIsSpeaking(rawSpeaking);
          consecutiveFramesRef.current = 0;
        }
      }

      rafRef.current = requestAnimationFrame(checkVolume);
    };
    checkVolume();

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (sourceRef.current) {
        sourceRef.current.disconnect();
      }
      audioContext.close();
      audioContextRef.current = null;
    };
  }, [stream, threshold]);

  return isSpeaking;
};

export default useVoiceActivity;

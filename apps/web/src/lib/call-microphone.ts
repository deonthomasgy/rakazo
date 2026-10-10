import { LiveTranscription, voiceAudioLevel } from "@rakazo/core";
import type { MicVAD } from "@ricky0123/vad-web";
import { transcribeAudio } from "./dictation.js";

/** One echo-cancelled microphone stays open for the entire server-transcribed call. */
export class CallMicrophone {
  level = 0;
  private generation = 0;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private detector: MicVAD | null = null;
  private transcription: LiveTranscription | null = null;
  private controller = new AbortController();
  private hearing = false;
  private processing = false;
  private recordings: Float32Array[] = [];
  private text: string[] = [];
  private maxTurn: ReturnType<typeof setTimeout> | undefined;

  stop() {
    this.level = 0;
    this.generation += 1;
    this.controller.abort();
    this.transcription?.reset();
    this.transcription = null;
    clearTimeout(this.maxTurn);
    this.maxTurn = undefined;
    const detector = this.detector;
    this.detector = null;
    void detector?.destroy().catch(() => undefined);
    this.stream?.getTracks().forEach((track) => {
      track.stop();
    });
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.hearing = false;
    this.processing = false;
    this.recordings = [];
    this.text = [];
  }

  async start(callbacks: {
    onSpeechStart: () => void;
    onPreview: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (error: unknown) => void;
  }) {
    this.stop();
    const generation = this.generation;
    const live = () => this.generation === generation;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    try {
      // Resume in the call button's user gesture, before loading the detector.
      const context = new AudioContext();
      this.context = context;
      await context.resume();
      if (!live()) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!live()) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      this.stream = stream;
      const { MicVAD } = await import("@ricky0123/vad-web");
      if (!live()) return;
      const transcription = new LiveTranscription(
        (samples, requestSignal) => transcribeAudio(samplesWav(samples), requestSignal),
        (text) => {
          if (live()) callbacks.onPreview(text);
        },
      );
      this.transcription = transcription;
      const process = async () => {
        if (this.processing || !live()) return;
        this.processing = true;
        try {
          while (this.recordings.length && live()) {
            const samples = this.recordings.shift();
            if (!samples) break;
            const text = await transcription.finish(samples, signal);
            if (!live()) return;
            if (text.trim()) this.text.push(text.trim());
          }
          // A breath followed by more speech while STT was pending is one turn.
          if (this.hearing || !live()) return;
          const text = this.text.join(" ");
          this.text = [];
          callbacks.onFinal(text);
        } catch (error) {
          if (live() && !signal.aborted) callbacks.onError(error);
        } finally {
          if (live()) this.processing = false;
        }
      };
      const detector = await MicVAD.new({
        model: "v5",
        audioContext: context,
        startOnLoad: false,
        baseAssetPath: "/voice-assets/",
        onnxWASMBasePath: "/voice-assets/",
        ortConfig: (ort) => {
          ort.env.wasm.numThreads = 1;
        },
        getStream: async () => stream,
        pauseStream: async () => {},
        resumeStream: async () => stream,
        positiveSpeechThreshold: 0.65,
        negativeSpeechThreshold: 0.35,
        minSpeechMs: 256,
        preSpeechPadMs: 320,
        redemptionMs: 700,
        submitUserSpeechOnPause: true,
        onSpeechStart: () => {
          if (live()) transcription.begin();
        },
        onVADMisfire: () => {
          if (live()) transcription.discard();
        },
        onFrameProcessed: (probabilities, frame) => {
          if (live()) {
            this.level = probabilities.isSpeech >= 0.35 ? voiceAudioLevel(frame) : 0;
            transcription.frame(probabilities.isSpeech, frame);
          }
        },
        onSpeechRealStart: () => {
          if (!live()) return;
          this.hearing = true;
          transcription.confirm();
          callbacks.onSpeechStart();
          clearTimeout(this.maxTurn);
          this.maxTurn = setTimeout(() => {
            if (!live()) return;
            void detector
              .pause()
              .then(() => {
                if (live()) return detector.start();
              })
              .catch((error: unknown) => {
                if (live()) callbacks.onError(error);
              });
          }, 60_000);
        },
        onSpeechEnd: (samples) => {
          if (!live()) return;
          clearTimeout(this.maxTurn);
          this.hearing = false;
          transcription.end(samples);
          this.recordings.push(samples);
          void process();
        },
      });
      if (!live()) {
        await detector.destroy();
        return;
      }
      this.detector = detector;
      for (const track of stream.getTracks())
        track.onended = () => {
          if (live()) {
            this.stop();
            callbacks.onError(new Error("Microphone disconnected."));
          }
        };
      await detector.start();
    } catch (error) {
      if (live()) {
        this.stop();
        callbacks.onError(error);
      }
    }
  }
}

/** Silero frames are mono 16 kHz; Whisper receives a complete PCM WAV. */
export function samplesWav(samples: Float32Array): Blob {
  const data = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(data);
  const string = (at: number, value: string) => {
    [...value].forEach((character, index) => {
      view.setUint8(at + index, character.charCodeAt(0));
    });
  };
  string(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  string(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  string(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    view.setInt16(
      44 + index * 2,
      Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767),
      true,
    );
  });
  return new Blob([data], { type: "audio/wav" });
}

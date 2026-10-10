import type { MicVAD } from "@ricky0123/vad-web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CallMicrophone, samplesWav } from "./call-microphone.js";
import { transcribeAudio } from "./dictation.js";

const { createVAD } = vi.hoisted(() => ({ createVAD: vi.fn() }));
vi.mock("@ricky0123/vad-web", () => ({ MicVAD: { new: createVAD } }));
vi.mock("./dictation.js", () => ({ transcribeAudio: vi.fn() }));

const start = vi.fn(async () => undefined);
const pause = vi.fn(async () => undefined);
const destroy = vi.fn(async () => undefined);
const stopTrack = vi.fn();
const stream = { getTracks: () => [{ stop: stopTrack, onended: null }] };
const microphone = new CallMicrophone();
const callbacks = {
  onSpeechStart: vi.fn(),
  onPreview: vi.fn(),
  onFinal: vi.fn(),
  onError: vi.fn(),
};
type Options = NonNullable<Parameters<typeof MicVAD.new>[0]>;
const options = () => createVAD.mock.calls.at(-1)?.[0] as Options;
const settle = async () => {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal(
    "AudioContext",
    class {
      resume = vi.fn(async () => undefined);
      close = vi.fn(async () => undefined);
    },
  );
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn(async () => stream) } });
  createVAD.mockResolvedValue({ start, pause, destroy });
  vi.mocked(transcribeAudio).mockResolvedValue("Hello there.");
});
afterEach(() => {
  microphone.stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("meters speech without background noise and clears the meter on stop", async () => {
  await microphone.start(callbacks);
  const processFrame = options().onFrameProcessed!;
  processFrame({ isSpeech: 0.8, notSpeech: 0.2 }, new Float32Array([0.1, -0.1]));
  expect(microphone.level).toBeCloseTo(0.7);
  processFrame({ isSpeech: 0.1, notSpeech: 0.9 }, new Float32Array([0.2, -0.2]));
  expect(microphone.level).toBe(0);
  microphone.stop();
  processFrame({ isSpeech: 0.8, notSpeech: 0.2 }, new Float32Array([0.1, -0.1]));
  expect(microphone.level).toBe(0);
});

it("keeps one echo-cancelled stream through successive spoken turns", async () => {
  await microphone.start(callbacks);
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const detector = options();
  for (let i = 0; i < 2; i += 1) {
    detector.onSpeechStart?.();
    detector.onSpeechRealStart?.();
    detector.onSpeechEnd?.(new Float32Array(16000));
    await settle();
  }
  expect(callbacks.onFinal).toHaveBeenCalledTimes(2);
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  expect(stopTrack).not.toHaveBeenCalled();
});

it("combines segments when speech resumes while transcription is pending", async () => {
  let finish: (text: string) => void = () => undefined;
  vi.mocked(transcribeAudio).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await microphone.start(callbacks);
  const detector = options();
  detector.onSpeechStart?.();
  detector.onSpeechRealStart?.();
  detector.onSpeechEnd?.(new Float32Array(16000));
  await settle();
  detector.onSpeechStart?.();
  detector.onSpeechRealStart?.();
  finish("Hello");
  await settle();
  expect(callbacks.onFinal).not.toHaveBeenCalled();
  vi.mocked(transcribeAudio).mockResolvedValueOnce("there.");
  detector.onSpeechEnd?.(new Float32Array(16000));
  await settle();
  expect(callbacks.onFinal).toHaveBeenCalledWith("Hello there.");
});

it("cancels pending transcription and closes the microphone on hang-up", async () => {
  let finish: (text: string) => void = () => undefined;
  vi.mocked(transcribeAudio).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await microphone.start(callbacks);
  const detector = options();
  detector.onSpeechEnd?.(new Float32Array(16000));
  const signal = vi.mocked(transcribeAudio).mock.calls[0]?.[1];
  microphone.stop();
  expect(signal?.aborted).toBe(true);
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(destroy).toHaveBeenCalledOnce();
  finish("Discard this late transcript.");
  await settle();
  expect(callbacks.onFinal).not.toHaveBeenCalled();
});

it("closes a microphone permission request that finishes after hang-up", async () => {
  let finish: (stream: MediaStream) => void = () => undefined;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const opening = microphone.start(callbacks);
  await settle();
  microphone.stop();
  finish(stream as unknown as MediaStream);
  await opening;
  expect(stopTrack).toHaveBeenCalledOnce();
  expect(createVAD).not.toHaveBeenCalled();
});

it("encodes mono sixteen kHz PCM WAV with bounded sample values", async () => {
  const blob = samplesWav(new Float32Array([-2, 0, 2]));
  const view = new DataView(await blob.arrayBuffer());
  expect(blob.type).toBe("audio/wav");
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint32(40, true)).toBe(6);
  expect(view.getInt16(44, true)).toBe(-32768);
  expect(view.getInt16(48, true)).toBe(32767);
});

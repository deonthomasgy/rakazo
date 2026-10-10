import { describe, expect, it } from "vitest";
import { voiceAudioLevel, voiceAvatarMode, voiceOrbFrame } from "./voice-avatar.js";

describe("voice avatar activity", () => {
  it("still shows an audible bot reply when only the caller's microphone is muted", () => {
    expect(voiceAvatarMode("speaking", true)).toBe("output");
    expect(voiceAvatarMode("listening", true)).toBe("muted");
    expect(voiceAvatarMode("thinking", false)).toBe("idle");
  });

  it("bounds RMS levels and treats missing or corrupt audio as silence", () => {
    expect(voiceAudioLevel(new Float32Array([0.1, -0.1]), 5)).toBeCloseTo(0.5);
    expect(voiceAudioLevel(new Float32Array([1, -1]))).toBe(1);
    expect(voiceAudioLevel(new Float32Array())).toBe(0);
    expect(voiceAudioLevel(new Float32Array([Number.NaN]))).toBe(0);
  });

  it("keeps reduced motion still even while audio changes", () => {
    expect(voiceOrbFrame("output", 0.9, 12, true)).toEqual(voiceOrbFrame("output", 0, 0, true));
  });
});

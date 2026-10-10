// Adapted from Pithagoras's VoiceOrb.tsx; see NOTICE (Apache-2.0).

import { GROK_COLOR_LIST } from "./bot-avatar-colors.js";

export type VoiceAvatarMode = "idle" | "input" | "output" | "muted";

/** Read directly by the animation; audio frames never need a React render. */
export interface VoiceAvatarLevels {
  input: number;
  output: number;
}

export interface VoiceAvatarActivity {
  mode: VoiceAvatarMode;
  /** Native recognition and browser dictation can show the phase without a raw audio meter. */
  levels?: VoiceAvatarLevels;
}

export function voiceOrbColor(color: string, mode: VoiceAvatarMode, mutedColor: string): string {
  if (mode === "muted") return mutedColor;
  if (mode === "input") return GROK_COLOR_LIST.find((entry) => entry.id === "cyan")!.light;
  return color;
}

export function voiceAvatarMode(
  phase: "listening" | "thinking" | "speaking",
  muted: boolean,
): VoiceAvatarMode {
  // Muting the microphone does not mute the bot's reply.
  if (phase === "speaking") return "output";
  if (muted) return "muted";
  return phase === "listening" ? "input" : "idle";
}

export function voiceAudioLevel(samples: Float32Array, gain = 7): number {
  if (!samples.length) return 0;
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  const level = Math.sqrt(energy / samples.length) * gain;
  return Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
}

/** Balanced Pithagoras orb proportions, in a 100 × 100 drawing space. */
export function voiceOrbFrame(
  mode: VoiceAvatarMode,
  audioLevel: number | undefined,
  seconds: number,
  reducedMotion = false,
) {
  "worklet";
  const time = reducedMotion ? 0 : seconds * 0.55;
  const fallback = mode === "output" ? 0.3 + Math.sin(time * 9) * 0.15 : 0;
  const level = reducedMotion ? 0 : Math.max(0, Math.min(1, audioLevel ?? fallback));
  const radius = 30 + level * 5;
  const wide = mode === "input" ? 1 : 0;
  const talk = mode === "output" ? 1 : 0;
  const gazeX = reducedMotion ? 0 : Math.sin(time * 0.9) * (mode === "idle" ? 0.9 : 0.35);
  const gazeY = reducedMotion ? 0 : Math.cos(time * 0.6) * 0.4 * (1 - wide) - 0.45 * wide;
  const blinkTime = seconds % 4.5;
  const blink =
    !reducedMotion && seconds > 4.5 && blinkTime < 0.16
      ? Math.abs(Math.cos((blinkTime / 0.16) * Math.PI))
      : 1;
  return {
    time,
    level,
    radius,
    gazeX,
    gazeY,
    eyeX: radius * 0.36,
    eyeY: -radius * 0.06 - wide * radius * 0.04 - talk * level * radius * 0.06,
    eyeWidth: radius * 0.22 * (1 + 0.18 * wide) * 0.58,
    eyeHeight:
      radius *
      0.22 *
      (1 + 0.18 * wide) *
      0.78 *
      (1 + talk * level * 0.32 + wide * 0.08) *
      (mode === "muted" ? 0.12 : blink),
    glow: mode === "muted" ? 0.08 : 0.25 + level * 0.18,
  };
}

export function voiceOrbPath(radius: number, level: number, time: number): string {
  "worklet";
  let path = "";
  for (let index = 0; index <= 64; index++) {
    const angle = (index / 64) * Math.PI * 2;
    const edge =
      radius +
      Math.sin(angle * 3 + time * 1.3) * (0.65 + level * 1.5) +
      Math.sin(angle * 5 - time * 2) * level * 2.2;
    path += `${index === 0 ? "M" : "L"}${(Math.cos(angle) * edge).toFixed(3)},${(Math.sin(angle) * edge).toFixed(3)}`;
  }
  return `${path}Z`;
}

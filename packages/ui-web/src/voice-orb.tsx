// Adapted from Pithagoras's VoiceOrb.tsx; see NOTICE (Apache-2.0).
import type { VoiceAvatarActivity } from "@rakazo/core";
import { voiceOrbColor, voiceOrbFrame, voiceOrbPath } from "@rakazo/core";
import { tokens } from "@rakazo/ui-tokens";
import { useEffect, useRef } from "react";
import { cn } from "./lib/utils.js";

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const full =
    hex.length === 4
      ? hex
          .slice(1)
          .split("")
          .map((value) => value + value)
          .join("")
      : hex.slice(1);
  return [0, 2, 4].map((index) => Number.parseInt(full.slice(index, index + 2), 16)) as Rgb;
}

function tint(color: Rgb, alpha = 1, shade = 1) {
  return `rgba(${color.map((value) => Math.round(value * shade)).join(",")},${alpha})`;
}

export function VoiceOrb({
  color,
  size,
  voice,
  className,
}: {
  color: string;
  size: number;
  voice: VoiceAvatarActivity;
  className?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ color, voice, size });
  current.current = { color, voice, size };

  useEffect(() => {
    const element = canvas.current;
    const ctx = element?.getContext("2d");
    if (!element || !ctx) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = true;
    let last = 0;
    const started = performance.now();
    let level = 0;
    let shade = rgb(current.current.color);
    let pose = voiceOrbFrame(current.current.voice.mode, 0, 0);

    const draw = (now: number) => {
      const { color: base, voice: activity, size: shown } = current.current;
      const reduced = media.matches;
      // Thumbnail avatars share the same activity but do less drawing.
      if (last && now - last < (reduced ? 100 : shown < 80 ? 66 : 16)) return;
      const elapsed = last ? Math.min(100, now - last) : 16;
      last = now;
      const pixels = Math.round(shown * Math.min(window.devicePixelRatio || 1, 2));
      if (element.width !== pixels) element.width = element.height = pixels;
      ctx.setTransform(pixels / 100, 0, 0, pixels / 100, 0, 0);
      const target = rgb(voiceOrbColor(base, activity.mode, tokens.mutedForeground));
      const ease = reduced ? 1 : 1 - Math.exp(-elapsed / 150);
      shade = shade.map((value, index) => value + ((target[index] ?? value) - value) * ease) as Rgb;
      const measured = activity.levels?.[activity.mode === "input" ? "input" : "output"];
      const sound = activity.mode === "input" || activity.mode === "output" ? measured : 0;
      const next = voiceOrbFrame(activity.mode, sound, (now - started) / 1000, reduced);
      level += (next.level - level) * (1 - Math.exp(-elapsed / (next.level > level ? 45 : 175)));
      pose = {
        ...next,
        level: reduced ? 0 : level,
        radius: pose.radius + (next.radius - pose.radius) * ease,
        eyeWidth: pose.eyeWidth + (next.eyeWidth - pose.eyeWidth) * ease,
        eyeHeight: pose.eyeHeight + (next.eyeHeight - pose.eyeHeight) * ease,
        eyeY: pose.eyeY + (next.eyeY - pose.eyeY) * ease,
      };
      const { radius: r, time, gazeX, gazeY } = pose;
      ctx.clearRect(0, 0, 100, 100);
      ctx.save();
      ctx.translate(50, 50);
      const halo = ctx.createRadialGradient(0, 0, r * 0.65, 0, 0, r * 1.65);
      halo.addColorStop(0, tint(shade, pose.glow));
      halo.addColorStop(1, tint(shade, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(-50, -50, 100, 100);
      for (let ring = 0; ring < 2; ring++) {
        ctx.beginPath();
        ctx.ellipse(
          0,
          0,
          r + 5 + ring * 4 + level,
          r + 4 + ring * 4,
          Math.sin(time) * 0.12,
          0,
          Math.PI * 2,
        );
        ctx.strokeStyle = tint(shade, 0.2 + level * 0.15 - ring * 0.05);
        ctx.lineWidth = 0.3;
        ctx.stroke();
      }
      const outline = new Path2D(voiceOrbPath(r, pose.level, time));
      const sphere = ctx.createRadialGradient(
        -r * 0.32,
        -r * 0.45,
        0.2,
        r * 0.12,
        r * 0.1,
        r * 1.32,
      );
      sphere.addColorStop(0, tint(shade, 0.98));
      sphere.addColorStop(0.32, tint(shade, 0.95));
      sphere.addColorStop(0.7, tint(shade, 1, 0.62));
      sphere.addColorStop(1, tint(shade, 1, 0.34));
      ctx.fillStyle = sphere;
      ctx.fill(outline);
      ctx.save();
      ctx.clip(outline);
      // Ribbons move at two depths inside the sphere, as in Pithagoras.
      for (let band = 0; band < 10; band++) {
        const y = -r + band * r * 0.22;
        const bend = Math.sin(time + band * 0.27) * 8 + level * 5;
        ctx.beginPath();
        ctx.moveTo(-r * 1.3, y);
        ctx.bezierCurveTo(-r * 0.45, y - 14 + bend, r * 0.35, y + 15 + bend, r * 1.3, y - 4);
        ctx.bezierCurveTo(r * 0.3, y + 19 + bend, -r * 0.4, y - 9 + bend, -r * 1.3, y + 2);
        ctx.fillStyle = tint(
          shade.map((value) => value + (255 - value) * 0.5) as Rgb,
          band % 2 ? 0.16 : 0.08,
        );
        ctx.fill();
      }
      const shine = ctx.createRadialGradient(
        -r * 0.33,
        -r * 0.55,
        0,
        -r * 0.33,
        -r * 0.55,
        r * 0.85,
      );
      shine.addColorStop(0, "rgba(255,255,255,0.45)");
      shine.addColorStop(0.35, "rgba(255,255,255,0.08)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shine;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.restore();
      ctx.strokeStyle = tint(shade, 0.6);
      ctx.lineWidth = 0.4;
      ctx.stroke(outline);
      for (const side of [-1, 1]) {
        const x = side * pose.eyeX + gazeX * r * 0.25;
        const y = pose.eyeY + gazeY * r * 0.1;
        ctx.beginPath();
        ctx.ellipse(x, y, pose.eyeWidth, Math.max(0.6, pose.eyeHeight), 0, 0, Math.PI * 2);
        ctx.fillStyle = tokens.background;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.lineWidth = 0.35;
        ctx.stroke();
        if (pose.eyeHeight > 1.5) {
          ctx.beginPath();
          ctx.ellipse(
            x - pose.eyeWidth * 0.27,
            y - pose.eyeHeight * 0.3,
            pose.eyeWidth * 0.3,
            pose.eyeHeight * 0.25,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = "rgba(255,255,255,0.9)";
          ctx.fill();
        }
      }
      ctx.restore();
    };
    const render = (now: number) => {
      draw(now);
      frame = visible && !document.hidden ? requestAnimationFrame(render) : 0;
    };
    const resume = () => {
      if (visible && !document.hidden && !frame) frame = requestAnimationFrame(render);
    };
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false;
      resume();
    });
    seen.observe(element);
    document.addEventListener("visibilitychange", resume);
    frame = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      document.removeEventListener("visibilitychange", resume);
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      aria-hidden="true"
      tabIndex={-1}
      data-voice-mode={voice.mode}
      className={cn("rakazo-voice-orb shrink-0", className)}
      style={{ width: size, height: size }}
    />
  );
}

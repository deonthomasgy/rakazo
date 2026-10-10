// Native rendering of Pithagoras's orb motion; see NOTICE (Apache-2.0).
import type { VoiceAvatarActivity } from "@rakazo/core";
import { voiceOrbColor, voiceOrbFrame, voiceOrbPath } from "@rakazo/core";
import { useEffect, useId } from "react";
import Animated, {
  useAnimatedProps,
  useFrameCallback,
  useReducedMotion,
  useSharedValue,
} from "react-native-reanimated";
import Svg, { Defs, Ellipse, G, Path, RadialGradient, Stop } from "react-native-svg";
import { useMobileTokens } from "../lib/native";

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

export function VoiceOrb({
  color,
  size,
  voice,
}: {
  color: string;
  size: number;
  voice: VoiceAvatarActivity;
}) {
  const tokens = useMobileTokens();
  const reduced = useReducedMotion();
  const seconds = useSharedValue(0);
  const id = useId().replace(/[^a-zA-Z0-9-_]/g, "");
  const fill = voiceOrbColor(color, voice.mode, tokens.mutedForeground);
  // Native recognition does not expose PCM: motion follows the actual call phase.
  const mode = voice.mode;
  const clock = useFrameCallback((frame) => {
    seconds.value = (frame.timeSinceFirstFrame ?? 0) / 1000;
  }, !reduced);
  useEffect(() => {
    clock.setActive(!reduced);
    return () => clock.setActive(false);
  }, [clock, reduced]);
  const body = useAnimatedProps(() => {
    const pose = voiceOrbFrame(mode, undefined, seconds.value, reduced);
    return { d: voiceOrbPath(pose.radius, pose.level, pose.time) };
  });
  const ring = useAnimatedProps(() => {
    const pose = voiceOrbFrame(mode, undefined, seconds.value, reduced);
    return { rx: pose.radius + 6 + pose.level, ry: pose.radius + 5, opacity: pose.glow };
  });
  const leftEye = useAnimatedProps(() => {
    const pose = voiceOrbFrame(mode, undefined, seconds.value, reduced);
    return {
      cx: -pose.eyeX + pose.gazeX * pose.radius * 0.25,
      cy: pose.eyeY + pose.gazeY * pose.radius * 0.1,
      rx: pose.eyeWidth,
      ry: Math.max(0.6, pose.eyeHeight),
    };
  });
  const rightEye = useAnimatedProps(() => {
    const pose = voiceOrbFrame(mode, undefined, seconds.value, reduced);
    return {
      cx: pose.eyeX + pose.gazeX * pose.radius * 0.25,
      cy: pose.eyeY + pose.gazeY * pose.radius * 0.1,
      rx: pose.eyeWidth,
      ry: Math.max(0.6, pose.eyeHeight),
    };
  });
  return (
    <Svg width={size} height={size} viewBox="-50 -50 100 100" accessible={false}>
      <Defs>
        <RadialGradient id={`${id}-body`} cx="35%" cy="25%" r="80%">
          <Stop offset="0" stopColor={fill} />
          <Stop offset="0.45" stopColor={fill} />
          <Stop offset="1" stopColor={tokens.background} />
        </RadialGradient>
        <RadialGradient id={`${id}-halo`}>
          <Stop offset="0.35" stopColor={fill} stopOpacity={0.25} />
          <Stop offset="1" stopColor={fill} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Ellipse rx={48} ry={48} fill={`url(#${id}-halo)`} />
      <AnimatedEllipse animatedProps={ring} stroke={fill} strokeWidth={0.4} fill="none" />
      <AnimatedPath
        animatedProps={body}
        fill={`url(#${id}-body)`}
        stroke={fill}
        strokeWidth={0.4}
      />
      <G
        fill={tokens.background}
        stroke={tokens.foreground}
        strokeOpacity={0.15}
        strokeWidth={0.35}
      >
        <AnimatedEllipse animatedProps={leftEye} />
        <AnimatedEllipse animatedProps={rightEye} />
      </G>
    </Svg>
  );
}

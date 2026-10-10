import { voiceAvatarMode } from "@rakazo/core";
import { useKeepAwake } from "expo-keep-awake";
import { useRouter } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { endCall, toggleMute, toggleTranscript, useCallSession } from "../lib/call-session";
import { useI18n } from "../lib/i18n";
import { useMobileTokens } from "../lib/native";
import { BotAvatar } from "./bot-avatar";
import { GlassIconButton } from "./glass-icon-button";
import { GlassSurface } from "./glass-surface";
import type { NativeSymbol } from "./native-symbol";

const TRANSCRIPT_LINES = 4;

/**
 * A call lives in the foreground: once the screen locks, Android pauses the app and the
 * microphone, recognition, and reply feed stop until it is unlocked. Mounted only while a
 * call is up, so the screen sleeps normally the rest of the time.
 */
function KeepScreenOnDuringCall() {
  useKeepAwake("rakazo-call");
  return null;
}

export function CallCard() {
  const call = useCallSession();
  const { t } = useI18n();
  const tokens = useMobileTokens();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  if (!call) return null;
  return (
    <GlassSurface
      shape="roundedRectangle"
      style={[styles.card, { top: insets.top + 52 }]}
      fallbackStyle={[
        styles.cardFallback,
        {
          backgroundColor: tokens.card,
          borderColor: tokens.border,
          shadowColor: tokens.foreground,
        },
      ]}
    >
      <KeepScreenOnDuringCall />
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("On a call with {name}", { name: call.botName })}
          onPress={() =>
            router.push({ pathname: "/thread", params: { botId: call.botId, name: call.botName } })
          }
        >
          <Text numberOfLines={1} style={[styles.name, { color: tokens.foreground }]}>
            {call.botName}
          </Text>
        </Pressable>
        <BotAvatar
          color={call.botColor}
          identity={call.botId}
          size={128}
          voice={{ mode: voiceAvatarMode(call.phase, call.muted) }}
        />
      </View>
      <View style={styles.actions}>
        <RoundButton
          label={t("Settings")}
          ios="gearshape"
          android="settings-outline"
          color={tokens.foreground}
          border={tokens.border}
          onPress={() => router.push("/voice")}
        />
        <RoundButton
          label={t("Transcript")}
          ios="captions.bubble"
          android="chatbox-outline"
          selected={call.transcriptOpen}
          color={tokens.foreground}
          border={tokens.border}
          onPress={toggleTranscript}
        />
        <RoundButton
          label={call.muted ? t("Unmute") : t("Mute")}
          ios={call.muted ? "mic.slash" : "mic"}
          android={call.muted ? "mic-off-outline" : "mic-outline"}
          selected={call.muted}
          color={call.muted ? tokens.mutedForeground : tokens.foreground}
          border={tokens.border}
          onPress={toggleMute}
        />
        <RoundButton
          label={t("Hang up")}
          ios="phone.down.fill"
          android="call-outline"
          color={tokens.destructiveForeground}
          border={tokens.destructive}
          background={tokens.destructive}
          onPress={endCall}
        />
      </View>
      {call.transcriptOpen ? (
        <View style={[styles.transcript, { borderTopColor: tokens.border }]}>
          {call.exchanges.slice(-TRANSCRIPT_LINES).map((exchange, index) => (
            <Text
              key={`${exchange.role}-${index + 1}-${exchange.text.slice(0, 24)}`}
              numberOfLines={1}
              style={[
                styles.line,
                { color: exchange.role === "bot" ? tokens.foreground : tokens.mutedForeground },
              ]}
            >
              {exchange.text}
            </Text>
          ))}
          {call.caption || call.heard ? (
            <Text numberOfLines={1} style={[styles.line, { color: tokens.mutedForeground }]}>
              {call.caption || call.heard}
            </Text>
          ) : null}
        </View>
      ) : null}
    </GlassSurface>
  );
}

function RoundButton({
  label,
  ios,
  android,
  color,
  border,
  background,
  selected,
  onPress,
}: {
  label: string;
  ios: string;
  android: ComponentProps<typeof NativeSymbol>["android"];
  color: string;
  border: string;
  background?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <GlassIconButton
      accessibilityLabel={label}
      ios={ios}
      android={android}
      size={44}
      color={color}
      tint={background}
      selected={selected}
      onPress={onPress}
      fallbackStyle={[
        styles.buttonFallback,
        { borderColor: border, backgroundColor: background ?? "transparent" },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    alignSelf: "center",
    width: 280,
    padding: 12,
    zIndex: 50,
  },
  cardFallback: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  row: { alignItems: "center" },
  name: { fontSize: 15, fontWeight: "500", maxWidth: 256, writingDirection: "auto" },
  actions: { flexDirection: "row", justifyContent: "center", gap: 12, marginTop: 12 },
  buttonFallback: { borderWidth: StyleSheet.hairlineWidth },
  transcript: { marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, gap: 5 },
  line: { fontSize: 13, writingDirection: "auto" },
});

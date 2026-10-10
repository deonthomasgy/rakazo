import type { VoiceAvatarMode } from "@rakazo/core";
import { DEFAULT_GROK_BOT_COLOR } from "@rakazo/core";
import { tokens } from "@rakazo/ui-tokens";
import { BotAvatar } from "@rakazo/ui-web";
import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";

function Fixture() {
  const [mode, setMode] = useState<VoiceAvatarMode>("input");
  const levels = useRef({ input: 0, output: 0 });
  return (
    <div style={{ background: tokens.card, color: tokens.foreground, padding: 24 }}>
      <div
        data-testid="orb-stage"
        style={{ width: 240, display: "flex", justifyContent: "center" }}
      >
        <BotAvatar
          color={DEFAULT_GROK_BOT_COLOR}
          size={180}
          voice={{ mode, levels: levels.current }}
        />
      </div>
      {(["input", "output", "idle", "muted"] as const).map((state) => (
        <button key={state} type="button" onClick={() => setMode(state)}>
          {state}
        </button>
      ))}
      <label>
        Volume
        <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          defaultValue="0"
          onChange={(event) => {
            levels.current.input = levels.current.output = Number(event.target.value);
          }}
        />
      </label>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);

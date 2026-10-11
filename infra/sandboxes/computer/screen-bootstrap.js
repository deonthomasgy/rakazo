// Selkies runs inside the existing opaque, capability-protected screen iframe.
// Its preferences are temporary and its socket stays under that capability's path.
(() => {
  window.audio_enabled = false;
  const postMessage = window.postMessage.bind(window);
  window.postMessage = (message, targetOrigin, transfer) =>
    postMessage(message, targetOrigin === location.origin ? "*" : targetOrigin, transfer);
  for (const name of ["localStorage", "sessionStorage"]) {
    try {
      window[name].getItem("screen");
    } catch {
      const values = new Map();
      Object.defineProperty(window, name, {
        value: {
          get length() {
            return values.size;
          },
          key: (index) => [...values.keys()][index] ?? null,
          getItem: (key) => values.get(String(key)) ?? null,
          setItem: (key, value) => values.set(String(key), String(value)),
          removeItem: (key) => values.delete(String(key)),
          clear: () => values.clear(),
        },
      });
    }
  }
  const NativeWebSocket = window.WebSocket;
  let screenSocket;
  let canControl = false;
  let reconnect;
  window.WebSocket = class extends NativeWebSocket {
    constructor(_url, protocols) {
      const path = new URL(location.href).searchParams.get("path") || "websockify";
      const target = new URL(path, location.href);
      target.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      super(target.href, protocols);
      screenSocket = this;
      canControl = false;
      this.addEventListener("open", () => clearTimeout(reconnect));
      this.addEventListener("message", ({ data }) => {
        if (typeof data === "string" && data.startsWith("AUTH_SUCCESS,")) {
          canControl = JSON.parse(data.slice("AUTH_SUCCESS,".length)).role === "controller";
        }
        if (typeof data === "string" && data.startsWith("MK_ACCESS,")) {
          canControl = data === "MK_ACCESS,1";
        }
      });
      this.addEventListener("close", () => {
        if (screenSocket !== this) return;
        canControl = false;
        // Renew an expired/revoked capability in the host, or reload a dropped stream.
        window.parent?.postMessage({ type: "rakazo-screen-disconnected" }, "*");
        window.ReactNativeWebView?.postMessage("rakazo-screen-disconnected");
        clearTimeout(reconnect);
        reconnect = setTimeout(() => {
          if (screenSocket?.readyState !== NativeWebSocket.OPEN) location.reload();
        }, 1500);
      });
    }
  };

  // Preserve the native mobile keyboard contract using the stream's X11 keysyms.
  const named = {
    Escape: 65307,
    Tab: 65289,
    Return: 65293,
    Backspace: 65288,
    ArrowLeft: 65361,
    ArrowUp: 65362,
    ArrowRight: 65363,
    ArrowDown: 65364,
  };
  const tap = (keysym, control) => {
    if (!canControl || screenSocket?.readyState !== NativeWebSocket.OPEN) return;
    if (control) screenSocket.send("kd,65507");
    screenSocket.send(`kd,${keysym}`);
    screenSocket.send(`ku,${keysym}`);
    if (control) screenSocket.send("ku,65507");
  };
  window.rakazoComputerKeyboard = {
    run(command) {
      if (!command || !canControl) return;
      if (command.type === "key" && named[command.name]) tap(named[command.name], command.control);
      else if (command.type === "backspace") {
        for (let i = 0; i < Math.min(1000, Math.max(0, command.count)); i++) tap(named.Backspace);
      } else if (
        (command.type === "text" || command.type === "char") &&
        typeof command.text === "string"
      ) {
        for (const character of command.text) {
          const code = character.codePointAt(0);
          tap(
            character === "\n" ? named.Return : code <= 255 ? code : 0x01000000 | code,
            command.control,
          );
        }
      }
    },
  };
})();

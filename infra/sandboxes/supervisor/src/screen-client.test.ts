import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it } from "vitest";

const bootstrap = readFileSync(
  new URL("../../computer/screen-bootstrap.js", import.meta.url),
  "utf8",
);

function client() {
  const pending: Array<() => void> = [];
  let reloads = 0;
  class Socket {
    static OPEN = 1;
    readyState = 1;
    messages: string[] = [];
    handlers = new Map<string, (event: { data: string }) => void>();
    constructor(public url: string) {}
    addEventListener(name: string, handler: (event: { data: string }) => void) {
      this.handlers.set(name, handler);
    }
    send(message: string) {
      this.messages.push(message);
    }
    receive(message: string) {
      this.handlers.get("message")?.({ data: message });
    }
  }
  const window = {
    WebSocket: Socket,
    postMessage() {},
    get localStorage() {
      throw new Error("opaque origin");
    },
    get sessionStorage() {
      throw new Error("opaque origin");
    },
  };
  const context = createContext({
    window,
    URL,
    location: Object.assign(
      new URL("https://example.test/novnc/session/view/sealed/embed.html?path=websockify"),
      { reload: () => reloads++ },
    ),
    setTimeout: (callback: () => void) => {
      pending.push(callback);
      return 1;
    },
    clearTimeout() {},
  });
  runInContext(bootstrap, context);
  return {
    window,
    context,
    socket: new window.WebSocket("wss://example.test/websockets"),
    pending,
    reloads: () => reloads,
  };
}

describe("sandboxed streaming client", () => {
  it("reloads a dropped stream but preserves one that already reconnected", () => {
    const state = client();
    state.socket.readyState = 3;
    state.socket.handlers.get("close")?.({ data: "" });
    state.pending.pop()?.();
    expect(state.reloads()).toBe(1);
    state.socket.handlers.get("close")?.({ data: "" });
    state.socket.readyState = 1;
    state.pending.pop()?.();
    expect(state.reloads()).toBe(1);
  });
  it("keeps the socket under its screen capability", () => {
    expect(client().socket.url).toBe("wss://example.test/novnc/session/view/sealed/websockify");
  });

  it("provides temporary storage in an opaque iframe", () => {
    const { context } = client();
    expect(
      runInContext(
        'window.localStorage.setItem("zoom", 2); window.localStorage.getItem("zoom")',
        context,
      ),
    ).toBe("2");
    expect(runInContext('window.sessionStorage.getItem("zoom")', context)).toBeNull();
  });

  it("sends native mobile keysyms only while the server grants input", () => {
    const { context, socket } = client();
    runInContext('window.rakazoComputerKeyboard.run({type:"text",text:"A"})', context);
    expect(socket.messages).toEqual([]);
    socket.receive('AUTH_SUCCESS,{"role":"controller"}');
    runInContext(
      'window.rakazoComputerKeyboard.run({type:"key",name:"Return",control:true})',
      context,
    );
    expect(socket.messages).toEqual(["kd,65507", "kd,65293", "ku,65293", "ku,65507"]);
    socket.receive("MK_ACCESS,0");
    runInContext('window.rakazoComputerKeyboard.run({type:"text",text:"B"})', context);
    expect(socket.messages).toHaveLength(4);
  });
});

import { afterEach, expect, it, vi } from "vitest";
import { transcribeWhisper } from "./whisper-transcription.js";

afterEach(() => vi.unstubAllGlobals());
it("posts a WAV to the deployment transcription endpoint without a hosted credential", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ text: " Hello there. " })));
  vi.stubGlobal("fetch", fetchMock);
  const result = await transcribeWhisper(
    "http://speech.test:8080/inference",
    {
      audio: new Uint8Array([82, 73, 70, 70]),
      mimeType: "audio/wav",
    },
    {
      operationId: "voice",
      traceId: "voice",
      spaceId: "space",
      userId: "user",
      signal: new AbortController().signal,
    },
  );
  expect(result).toEqual({ text: "Hello there." });
  const options = fetchMock.mock.calls[0]?.[1];
  expect(options.redirect).toBe("error");
  expect(options.body.get("file").type).toBe("audio/wav");
  expect(options.body.get("response_format")).toBe("json");
  expect(options.headers).toBeUndefined();
});

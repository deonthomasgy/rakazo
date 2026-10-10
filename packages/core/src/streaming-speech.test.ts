import { describe, expect, it } from "vitest";
import { StreamingSpeech } from "./streaming-speech.js";

describe("streamed call speech", () => {
  it("speaks stable sentences during a run and only flushes the remaining tail at completion", () => {
    const speech = new StreamingSpeech();
    expect(speech.observe("run", "I can help with that. Let me", false)).toEqual([
      "I can help with that.",
    ]);
    expect(speech.observe("run", "I can help with that. Let me check", false)).toEqual([]);
    expect(speech.observe("run", "I can help with that. Let me check", true)).toEqual([
      "Let me check",
    ]);
    expect(speech.observe("run", "I can help with that. Let me check", true)).toEqual([]);
  });
  it("does not repeat a final message or a stale refreshed snapshot", () => {
    const speech = new StreamingSpeech();
    speech.observe("run", "I have checked the schedule. Next", false);
    expect(speech.observe("run", "I have checked", false)).toEqual([]);
    expect(speech.observe("run", "I have checked the schedule. Next Friday works.", true)).toEqual([
      "Next Friday works.",
    ]);
  });
  it("keeps decimals, abbreviations, links and unfinished code out of partial phrases", () => {
    const speech = new StreamingSpeech();
    expect(speech.observe("run", "Dr. Smith paid 3.14 dollars. Next", false)).toEqual([
      "Dr. Smith paid 3.14 dollars.",
    ]);
    expect(speech.observe("code", "```ts\nconst value = 1.\n", false)).toEqual([]);
    expect(
      speech.observe("link", "Read [this useful guide](https://example.test/a.b). Next", false),
    ).toEqual(["Read this useful guide."]);
  });
  it("flushes short final replies and suppresses interrupted runs", () => {
    const speech = new StreamingSpeech();
    expect(speech.observe("yes", "Yes.", true)).toEqual(["Yes."]);
    speech.ignore("old");
    expect(speech.observe("old", "This is a late old reply.", true)).toEqual([]);
    expect(speech.observe("new", "This is the new reply.", true)).toEqual([
      "This is the new reply.",
    ]);
  });
});

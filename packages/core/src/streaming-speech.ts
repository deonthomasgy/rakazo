// Phrase detection adapted from Pithagoras, Copyright 2026 Anirban Kar and Contributors.
// Apache-2.0. The run reconciliation below handles Rakazo's transient progress messages.
import { toUtterances } from "./speech-text.js";

/** Read stable phrases once, even when a final message replaces a live progress message. */
export class StreamingSpeech {
  private consumed = new Map<string, string>();
  private ignored = new Set<string>();

  ignore(key: string) {
    this.ignored.add(key);
  }

  clear() {
    this.consumed.clear();
    this.ignored.clear();
  }

  observe(key: string, text: string, done: boolean): string[] {
    if (this.ignored.has(key)) return [];
    const previous = this.consumed.get(key) ?? "";
    // A refreshed snapshot can lag behind text already spoken. Never replay it.
    if (previous.startsWith(text)) return [];
    if (!text.startsWith(previous)) return [];
    let offset = previous.length;
    const result: string[] = [];
    while (offset < text.length) {
      const tail = text.slice(offset);
      let end = phraseBoundary(tail);
      if (!end && done) end = tail.length;
      if (!end) break;
      const phrase = tail.slice(0, end);
      const words =
        toUtterances(phrase)
          .join(" ")
          .match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
      // Very short non-final phrases wait for the next sentence.
      if (words <= 3 && !done) {
        const next = phraseBoundary(tail.slice(end));
        if (!next) break;
        end += next;
      }
      result.push(...toUtterances(tail.slice(0, end)));
      offset += end;
    }
    this.consumed.set(key, text.slice(0, offset));
    return result;
  }
}

function phraseBoundary(text: string): number {
  let fence = false;
  let inline = false;
  let brackets = 0;
  let link = false;
  for (let i = 0; i < text.length; i += 1) {
    if (text.startsWith("```", i) || text.startsWith("~~~", i)) {
      fence = !fence;
      i += 2;
      continue;
    }
    if (fence) continue;
    if (text[i] === "`") {
      inline = !inline;
      continue;
    }
    if (inline) continue;
    if (text[i] === "[") brackets += 1;
    if (text[i] === "]") {
      brackets = Math.max(0, brackets - 1);
      if (text[i + 1] === "(") link = true;
    }
    if (link) {
      if (text[i] === ")") link = false;
      continue;
    }
    if (brackets) continue;
    const character = text[i] ?? "";
    const punctuation = /[.!?。！？]/.test(character);
    const boundary = punctuation && (/[。！？]/.test(character) || /\s/.test(text[i + 1] ?? ""));
    const abbreviation =
      character === "." &&
      /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc)|\b[A-Za-z])\.$/i.test(text.slice(0, i + 1));
    if ((boundary && !abbreviation) || character === "\n" || (i >= 240 && /\s/.test(character)))
      return i + 1;
  }
  return 0;
}

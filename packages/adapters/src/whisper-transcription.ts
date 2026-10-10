import type { AdapterContext, VoiceTranscribeRequest } from "@rakazo/adapter-kit";
import { readVoiceJson, speechUploadName, voiceDeadline, voiceHttpError } from "./voice-http.js";

/** whisper.cpp accepts mono WAV at /inference; the deployment owns the endpoint. */
export async function transcribeWhisper(
  url: string,
  request: Omit<VoiceTranscribeRequest, "apiKey">,
  context: AdapterContext,
): Promise<{ text: string }> {
  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:")
    throw new Error("Transcription URL must use HTTP(S).");
  const form = new FormData();
  form.set(
    "file",
    new Blob([new Uint8Array(request.audio)], { type: request.mimeType }),
    speechUploadName(request.mimeType),
  );
  form.set("response_format", "json");
  form.set("temperature", "0");
  const response = await fetch(target, {
    method: "POST",
    body: form,
    redirect: "error",
    signal: voiceDeadline(request.signal ?? context.signal, 60_000),
  });
  const body = await readVoiceJson(response, { requireValid: response.ok });
  if (!response.ok)
    throw new Error(voiceHttpError(response.status, "Transcription server", "transcribing", body));
  const text = (body as { text?: unknown } | null)?.text;
  return { text: typeof text === "string" ? text.trim() : "" };
}

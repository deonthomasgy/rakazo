import type {
  AdapterContext,
  AdapterDescriptor,
  SpeechClip,
  VoiceCapabilities,
  VoiceInfo,
  VoiceProvider,
  VoiceSynthesizeRequest,
  VoiceTranscribeRequest,
  VoiceVerifyResult,
} from "@rakazo/adapter-kit";
import {
  readVoiceAudio,
  readVoiceJson,
  requireOk,
  speechUploadName,
  verifyVoiceHttpGet,
  voiceDeadline,
  voiceHttpError,
} from "./voice-http.js";

const API = "https://api.openai.com/v1";
const TTS_MODEL = "gpt-4o-mini-tts";
const STT_MODEL = "gpt-4o-mini-transcribe";

export interface CompatibleVoiceOptions {
  baseUrl?: string;
  model?: string;
  voice?: string;
}

const OPENAI_VOICES: VoiceInfo[] = [
  { id: "alloy", label: "Alloy", description: "Neutral" },
  { id: "ash", label: "Ash", description: "Clear" },
  { id: "ballad", label: "Ballad", description: "Warm" },
  { id: "coral", label: "Coral", description: "Bright" },
  { id: "echo", label: "Echo", description: "Even" },
  { id: "fable", label: "Fable", description: "Narrative" },
  { id: "onyx", label: "Onyx", description: "Deep" },
  { id: "nova", label: "Nova", description: "Energetic" },
  { id: "sage", label: "Sage", description: "Calm" },
  { id: "shimmer", label: "Shimmer", description: "Soft" },
  { id: "verse", label: "Verse", description: "Expressive" },
];

export class OpenAIVoiceProvider implements VoiceProvider {
  private baseUrl: string;
  constructor(private options: CompatibleVoiceOptions = {}) {
    this.baseUrl = (options.baseUrl?.trim() || API).replace(/\/+$/, "");
    const url = new URL(this.baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error("Speech URL must use HTTP(S).");
  }
  describe(): AdapterDescriptor<VoiceCapabilities> {
    return {
      id: "openai",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { catalog: true, synthesize: true, transcribe: this.baseUrl === API },
    };
  }

  async verify(apiKey: string, context: AdapterContext): Promise<VoiceVerifyResult> {
    return verifyVoiceHttpGet({
      url: `${this.baseUrl}/models`,
      headers: { authorization: `Bearer ${apiKey}` },
      signal: context.signal,
      provider: "OpenAI",
    });
  }

  async listVoices(apiKey: string, context: AdapterContext): Promise<VoiceInfo[]> {
    if (this.baseUrl !== API) {
      const response = await fetch(`${this.baseUrl}/audio/voices`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: voiceDeadline(context.signal, 20_000),
      });
      await requireOk(response, "Speech server", "listing voices");
      const body = (await readVoiceJson(response, { requireValid: true })) as {
        voices?: unknown[];
      };
      const voices: VoiceInfo[] = [];
      for (const item of body.voices ?? []) {
        const id = typeof item === "string" ? item : (item as { id?: unknown } | null)?.id;
        if (typeof id === "string" && id.trim()) voices.push({ id, label: id });
      }
      if (this.options.voice && !voices.some((voice) => voice.id === this.options.voice)) {
        voices.unshift({ id: this.options.voice, label: this.options.voice });
      }
      return voices.sort(
        (a, b) => Number(b.id === this.options.voice) - Number(a.id === this.options.voice),
      );
    }
    return OPENAI_VOICES;
  }

  async synthesize(request: VoiceSynthesizeRequest, context: AdapterContext): Promise<SpeechClip> {
    const signal = voiceDeadline(request.signal ?? context.signal, 60_000);
    const res = await fetch(`${this.baseUrl}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${request.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: request.model || this.options.model || TTS_MODEL,
        voice: request.voiceId,
        input: request.text,
        response_format: "mp3",
      }),
      signal,
    });
    await requireOk(res, "OpenAI", "speaking");
    return { bytes: await readVoiceAudio(res, signal), mimeType: "audio/mpeg" };
  }

  async transcribe(
    request: VoiceTranscribeRequest,
    context: AdapterContext,
  ): Promise<{ text: string }> {
    if (this.baseUrl !== API) {
      throw new Error("This speech server needs a separate transcription service.");
    }
    const form = new FormData();
    form.set("model", STT_MODEL);
    form.set(
      "file",
      new Blob([new Uint8Array(request.audio)], { type: request.mimeType || "audio/webm" }),
      speechUploadName(request.mimeType),
    );
    const res = await fetch(`${API}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${request.apiKey}` },
      body: form,
      signal: voiceDeadline(request.signal ?? context.signal, 60_000),
    });
    const body = await readVoiceJson(res, { requireValid: res.ok });
    if (!res.ok) throw new Error(voiceHttpError(res.status, "OpenAI", "transcribing", body));
    return { text: String((body as { text?: unknown } | null)?.text ?? "").trim() };
  }
}

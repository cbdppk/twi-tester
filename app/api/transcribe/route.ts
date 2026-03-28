import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

const GHANA_NLP_KEY = process.env.GHANA_NLP_API_KEY ?? "";
const BASE = "https://translation-api.ghananlp.org";
const ASR_TIMEOUT_MS = 20_000;

// POST with FormData  → ASR (audio → Twi transcript)
// POST with JSON { translate: string } → Translate Twi → English
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  // ── Translate mode ────────────────────────────────────────────
  if (contentType.includes("application/json")) {
    const body = await req.json();
    const sentence: string = body.translate ?? "";

    if (!sentence) {
      return NextResponse.json({ error: "No text provided for translation" }, { status: 400 });
    }

    try {
      const res = await fetch(`${BASE}/v1/translate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "Ocp-Apim-Subscription-Key": GHANA_NLP_KEY,
        },
        body: JSON.stringify({ in: sentence, lang: "tw-en" }),
      });

      const raw = await res.text();
      console.log("[GhanaNLP Translate] status:", res.status, "body:", raw);

      if (!res.ok) {
        return NextResponse.json(
          { error: `GhanaNLP translate error ${res.status}: ${raw}` },
          { status: 502 }
        );
      }

      let translation: string;
      try {
        const data = JSON.parse(raw);
        translation = data.translatedText ?? data.translation ?? data.output ?? (typeof data === "string" ? data : raw);
      } catch {
        translation = raw; // API returned plain string
      }
      return NextResponse.json({ translation });
    } catch (e) {
      console.error("[GhanaNLP Translate] error:", e);
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // ── ASR mode ─────────────────────────────────────────────────
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // GhanaNLP ASR requires raw binary body (not multipart)
    const audioBuffer = await file.arrayBuffer();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ASR_TIMEOUT_MS);

    try {
      const res = await fetch(`${BASE}/asr/v1/transcribe?language=tw`, {
        method: "POST",
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "no-cache",
          "Ocp-Apim-Subscription-Key": GHANA_NLP_KEY,
        },
        body: audioBuffer,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const raw = await res.text();
      console.log("[GhanaNLP ASR] status:", res.status, "body:", raw);

      if (!res.ok) {
        return NextResponse.json(
          { error: `GhanaNLP ASR error ${res.status}: ${raw}` },
          { status: 502 }
        );
      }

      let transcript: string;
      try {
        const data = JSON.parse(raw);
        transcript = data.transcript ?? data.text ?? (typeof data === "string" ? data : "");
      } catch {
        transcript = raw; // plain string response
      }
      return NextResponse.json({ transcript });
    } catch (e) {
      clearTimeout(timer);
      if (e instanceof Error && e.name === "AbortError") {
        console.error("[GhanaNLP ASR] timed out after", ASR_TIMEOUT_MS, "ms");
        return NextResponse.json(
          { error: `GhanaNLP ASR timed out after ${ASR_TIMEOUT_MS / 1000}s — service may be unavailable` },
          { status: 504 }
        );
      }
      console.error("[GhanaNLP ASR] error:", e);
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  } catch (e) {
    console.error("[GhanaNLP ASR] error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

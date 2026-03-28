"use client";

import { useState, useRef } from "react";

type Step = {
  label: string;
  status: "idle" | "loading" | "done" | "error";
  result?: string;
  error?: string;
};

const INITIAL_STEPS: Step[] = [
  { label: "1. Record / type Twi input", status: "idle" },
  { label: "2. GhanaNLP — transcribe audio", status: "idle" },
  { label: "3. Anthropic — parse trip details", status: "idle" },
  { label: "4. GhanaNLP — translate to English", status: "idle" },
  { label: "5. Anthropic — generate Twi summary", status: "idle" },
];

export default function Home() {
  const [steps, setSteps] = useState<Step[]>(INITIAL_STEPS);
  const [recording, setRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [manualText, setManualText] = useState("");
  const [running, setRunning] = useState(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  function updateStep(index: number, patch: Partial<Step>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s))
    );
  }

  const audioCtxRef = useRef<AudioContext | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);

  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Capture raw PCM via Web Audio API so we can encode as WAV (GhanaNLP requires wav/flac/mp3)
    const ctx = new AudioContext({ sampleRate: 16000 });
    audioCtxRef.current = ctx;
    pcmChunksRef.current = [];
    const source = ctx.createMediaStreamSource(stream);
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      pcmChunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    source.connect(processor);
    processor.connect(ctx.destination);
    // Keep stream ref for stopping tracks
    (processor as unknown as { _stream: MediaStream })._stream = stream;
    mediaRef.current = processor as unknown as MediaRecorder;
    setRecording(true);
  }

  function stopRecording() {
    const processor = mediaRef.current as unknown as AudioNode & { _stream?: MediaStream };
    if (processor) {
      processor.disconnect();
      processor._stream?.getTracks().forEach((t) => t.stop());
    }
    audioCtxRef.current?.close();
    setRecording(false);

    // Encode captured PCM chunks as a 16-bit mono WAV blob
    const sampleRate = 16000;
    const allChunks = pcmChunksRef.current;
    const totalLen = allChunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(totalLen);
    let offset = 0;
    for (const chunk of allChunks) { pcm.set(chunk, offset); offset += chunk.length; }

    const numSamples = pcm.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);
    for (let i = 0; i < numSamples; i++) {
      view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
    }
    setAudioBlob(new Blob([buffer], { type: "audio/wav" }));
  }

  async function runTest() {
    setRunning(true);
    setSteps(INITIAL_STEPS);

    const inputText = manualText.trim();
    let transcript = inputText;

    // ── Step 2: GhanaNLP ASR ──────────────────────────────────────
    if (audioBlob && !inputText) {
      updateStep(1, { status: "loading" });
      try {
        const form = new FormData();
        form.append("file", audioBlob, "audio.webm");
        form.append("language", "tw");
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        transcript = data.transcript;
        updateStep(1, { status: "done", result: transcript });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "ASR failed";
        updateStep(1, { status: "error", error: msg });
        setRunning(false);
        return;
      }
    } else {
      updateStep(1, { status: "done", result: inputText || "— skipped (using text input)" });
    }

    // ── Step 3: Anthropic parse ───────────────────────────────────
    updateStep(2, { status: "loading" });
    let parsed: { amount: number; route: string; confidence: string } | null = null;
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      parsed = data;
      updateStep(2, {
        status: "done",
        result: `Route: ${data.route} · Amount: GHS ${data.amount} · Confidence: ${data.confidence}`,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Parse failed";
      updateStep(2, { status: "error", error: msg });
    }

    // ── Step 4: GhanaNLP translate → English ──────────────────────
    updateStep(3, { status: "loading" });
    let translated = "";
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ translate: transcript }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      translated = data.translation;
      updateStep(3, { status: "done", result: translated });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Translation failed";
      updateStep(3, { status: "error", error: msg });
      translated = transcript; // fallback: use original
    }

    // ── Step 5: Anthropic Twi summary ────────────────────────────
    updateStep(4, { status: "loading" });
    try {
      const context = parsed
        ? `Route: ${parsed.route}, Amount: GHS ${parsed.amount}`
        : `Trip info: ${transcript}`;
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summarize: context }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      updateStep(4, { status: "done", result: data.summary });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Summary failed";
      updateStep(4, { status: "error", error: msg });
    }

    setRunning(false);
  }

  const statusColors = {
    idle: "bg-gray-800 border-gray-700",
    loading: "bg-blue-950 border-blue-700",
    done: "bg-green-950 border-green-700",
    error: "bg-red-950 border-red-700",
  };

  const statusDot = {
    idle: "bg-gray-600",
    loading: "bg-blue-400 animate-pulse",
    done: "bg-green-400",
    error: "bg-red-400",
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🇬🇭</span>
          <h1 className="text-2xl font-bold tracking-tight">Twi API Tester</h1>
        </div>
        <p className="text-gray-400 text-sm">
          Test GhanaNLP + Anthropic with real Twi input · MateCheck hackathon prep
        </p>
      </div>

      {/* Input area */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
        <p className="text-sm font-medium text-gray-300 mb-3">
          Step 1 — Record audio or type Twi text
        </p>

        {/* Mic button */}
        <div className="flex items-center gap-4 mb-4">
          <button
            onClick={recording ? stopRecording : startRecording}
            className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl transition-all ${
              recording
                ? "bg-red-600 hover:bg-red-700 ring-4 ring-red-500/30 animate-pulse"
                : "bg-green-700 hover:bg-green-600"
            }`}
          >
            {recording ? "⏹" : "🎙"}
          </button>
          <div>
            <p className="text-sm font-medium">
              {recording ? "Recording... tap to stop" : "Tap to record Twi"}
            </p>
            {audioBlob && !recording && (
              <p className="text-xs text-green-400 mt-0.5">
                ✓ Audio ready ({(audioBlob.size / 1024).toFixed(1)} KB)
              </p>
            )}
          </div>
        </div>

        {/* Text fallback */}
        <div className="relative">
          <p className="text-xs text-gray-500 mb-1.5">Or type Twi text directly (skips ASR):</p>
          <textarea
            value={manualText}
            onChange={(e) => setManualText(e.target.value)}
            placeholder='e.g. "Circle fi Madina, Ghana cedi aduonu"'
            rows={2}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 resize-none focus:outline-none focus:border-green-600"
          />
        </div>
      </div>

      {/* Run button */}
      <button
        onClick={runTest}
        disabled={running || (!audioBlob && !manualText.trim())}
        className="w-full py-3 rounded-xl font-semibold text-sm bg-green-700 hover:bg-green-600 disabled:bg-gray-800 disabled:text-gray-600 disabled:cursor-not-allowed transition-colors mb-6"
      >
        {running ? "Running pipeline..." : "▶ Run full pipeline"}
      </button>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map((step, i) => (
          <div
            key={i}
            className={`border rounded-xl p-4 transition-all ${statusColors[step.status]}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusDot[step.status]}`} />
              <span className="text-sm font-medium">{step.label}</span>
              {step.status === "loading" && (
                <span className="text-xs text-blue-400 ml-auto">processing...</span>
              )}
            </div>
            {step.result && (
              <p className="text-xs text-gray-300 mt-1 pl-4 leading-relaxed">{step.result}</p>
            )}
            {step.error && (
              <p className="text-xs text-red-400 mt-1 pl-4">{step.error}</p>
            )}
          </div>
        ))}
      </div>

      {/* Footer hint */}
      <p className="text-center text-xs text-gray-700 mt-8">
        Check browser console for raw API responses
      </p>
    </main>
  );
}

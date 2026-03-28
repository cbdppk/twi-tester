import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST { text: string }      → parse trip details from Twi/English text
// POST { summarize: string } → generate a short Twi driver summary
export async function POST(req: NextRequest) {
  const body = await req.json();

  // ── Summary mode ──────────────────────────────────────────────
  if (body.summarize) {
    const context: string = body.summarize;

    try {
      const msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 256,
        messages: [
          {
            role: "user",
            content: `You are a helpful assistant for trotro (minibus) drivers in Ghana.
Write a SHORT 1-sentence encouraging summary of this driver's trip in Twi (Akan language).
Keep it natural, warm, and brief — like something a dispatcher would say.

Trip info: ${context}

Respond with ONLY the Twi sentence. Nothing else.`,
          },
        ],
      });

      const summary =
        msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
      console.log("[Anthropic Summary]", summary);
      return NextResponse.json({ summary });
    } catch (e) {
      console.error("[Anthropic Summary] error:", e);
      return NextResponse.json({ error: String(e) }, { status: 500 });
    }
  }

  // ── Parse mode ────────────────────────────────────────────────
  const text: string = body.text ?? "";
  if (!text) {
    return NextResponse.json({ error: "No text provided" }, { status: 400 });
  }

  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      messages: [
        {
          role: "user",
          content: `You are a trip log parser for trotro (minibus) drivers in Ghana.
Extract the trip route and amount from this text. The text may be in Twi, pidgin English, or English.

Text: "${text}"

Rules:
- route: the origin and destination (e.g. "Circle–Madina"). If unclear use "Unknown route".
- amount: the number in GHS (Ghana cedis). If unclear use 0.
- confidence: "high" if both are clear, "medium" if one is unclear, "low" if both are guesses.

Respond with ONLY valid JSON. No explanation. No markdown. Example:
{"route":"Circle–Madina","amount":20,"confidence":"high"}`,
        },
      ],
    });

    const raw = msg.content[0].type === "text" ? msg.content[0].text.trim() : "{}";
    console.log("[Anthropic Parse] raw:", raw);

    // Strip any accidental markdown fences
    const clean = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);
    return NextResponse.json(parsed);
  } catch (e) {
    console.error("[Anthropic Parse] error:", e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

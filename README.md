# Twi API Tester

A simple Next.js app to test the GhanaNLP + Anthropic pipeline before the MateCheck hackathon build.

## What it tests

1. **GhanaNLP ASR** — Record Twi audio → get transcript
2. **Anthropic parse** — Extract route + amount from Twi/English text
3. **GhanaNLP Translate** — Translate Twi → English
4. **Anthropic summary** — Generate a short Twi driver summary

## Setup

```bash
cp .env.local.example .env.local
# Fill in your API keys in .env.local

npm install
npm run dev
```

Open http://localhost:3000

## API keys needed

| Key | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `GHANA_NLP_API_KEY` | translation.ghananlp.org/apis |

## Testing without GhanaNLP key

Just type text in the input box. Steps 2 and 4 (GhanaNLP) will be skipped.
Anthropic parse and summary still run.

## What to look for

- Does Anthropic correctly extract route + amount from Twi text?
- Does the Twi summary sound natural?
- Does GhanaNLP ASR return a transcript from real voice?
- Does GhanaNLP translate Twi → English correctly?

Check browser console for raw API responses from each step.

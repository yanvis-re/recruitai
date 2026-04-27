// api/_videoTranscription.js
//
// Replaces the old _loom.js scraper, which is gone now that Loom auth-gates
// transcripts and video-file URLs (8 strategies tried, all hit the same wall).
// New flow:
//   1. Candidates paste their transcript directly (Loom UI → CC → Copy
//      transcript). That's the ground truth and works for 100% of cases.
//   2. If they ALSO upload the MP4 to Drive / Dropbox, we run AssemblyAI on
//      the audio for paralinguistic features (sentiment, auto-highlights,
//      diction confidence). Optional but materially improves the IA's
//      ability to evaluate "how" they communicate, not just "what".
//
// Filename prefix `_` keeps Vercel from counting this as a serverless
// function (no default export anyway), so we stay under the 12-function
// Hobby cap.

// ─── URL transformer for AssemblyAI ─────────────────────────────────────────
//
// AssemblyAI accepts a public URL and downloads the audio itself. The catch:
// the "share" URLs candidates copy from Drive / Dropbox don't point at the
// file — they point at an HTML viewer page. AssemblyAI would download the
// HTML and fail silently with "no audio detected". This helper rewrites
// share-style URLs to direct-download URLs.
//
// Supported hosts:
//   - drive.google.com   (file/d/{id}/view AND open?id={id})
//   - dropbox.com        (?dl=0 → ?dl=1; appends dl=1 if absent)
// Anything else passes through unchanged. WeTransfer is intentionally NOT
// supported because its links expire after 7 days, which would silently
// break re-evaluations weeks after the original submission.
export function transformMp4Url(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  // Google Drive — share format: /file/d/{ID}/view?...
  const driveFile = trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveFile) return `https://drive.google.com/uc?export=download&id=${driveFile[1]}`;

  // Google Drive — older share format: /open?id={ID}
  const driveOpen = trimmed.match(/drive\.google\.com\/open\?(?:[^=]*=[^&]*&)*id=([a-zA-Z0-9_-]+)/);
  if (driveOpen) return `https://drive.google.com/uc?export=download&id=${driveOpen[1]}`;

  // Dropbox — flip dl=0 to dl=1 (forces direct download instead of HTML viewer).
  if (/dropbox\.com/i.test(trimmed)) {
    if (/[?&]dl=1\b/i.test(trimmed)) return trimmed; // already direct
    if (/[?&]dl=0\b/i.test(trimmed)) return trimmed.replace(/([?&])dl=0\b/i, "$1dl=1");
    return trimmed + (trimmed.includes("?") ? "&dl=1" : "?dl=1");
  }

  // Unknown host — pass through and let AssemblyAI try directly. If it's a
  // raw .mp4 URL on someone's S3 / R2 / etc., it'll work.
  return trimmed;
}

// ─── AssemblyAI client ──────────────────────────────────────────────────────
//
// Submit + poll. Returns a rich object with the text + paralinguistic
// metadata when sentiment_analysis / auto_highlights were requested.
// Returns null on any failure (key missing, submit error, polling timeout,
// transcription error). Caller is expected to fall back to the
// candidate-pasted transcript in that case.
//
// Cost note: with universal-2 + sentiment + highlights → ~$0.014/min.
// At 50 candidates × 5 min/month that's ~$3.50/month.
export async function transcribeWithAssemblyAI(audioUrl, options = {}) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    console.warn("[transcription] ASSEMBLYAI_API_KEY not set — skipping AssemblyAI");
    return null;
  }
  const transformedUrl = transformMp4Url(audioUrl);
  if (!transformedUrl) {
    console.warn("[transcription] empty / invalid audio URL");
    return null;
  }
  console.warn(`[transcription] submitting: ${transformedUrl.slice(0, 100)}${transformedUrl.length > 100 ? "…" : ""}`);

  try {
    const submitRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "Authorization": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url: transformedUrl,
        language_code: options.languageCode || "es",
        speech_model: options.speechModel || "universal-2",
        sentiment_analysis: options.sentimentAnalysis !== false,
        auto_highlights: options.autoHighlights !== false,
      }),
    });
    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      console.warn(`[transcription] submit failed: ${submitRes.status} ${errText.slice(0, 200)}`);
      return null;
    }
    const submitJson = await submitRes.json();
    const transcriptId = submitJson.id;
    if (!transcriptId) {
      console.warn("[transcription] submit returned no id");
      return null;
    }
    console.warn(`[transcription] submitted, id: ${transcriptId}`);

    // Poll. 45s ceiling leaves ~15s of margin under Vercel Hobby's 60s
    // function timeout (the rest of /api/evaluate also takes time).
    const start = Date.now();
    const maxMs = 45_000;
    while (Date.now() - start < maxMs) {
      await new Promise(r => setTimeout(r, 2000));
      const pollRes = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
        headers: { "Authorization": apiKey },
      });
      if (!pollRes.ok) continue;
      const pollJson = await pollRes.json();
      if (pollJson.status === "completed") {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        const text = (pollJson.text || "").trim();
        console.warn(`[transcription] completed in ${elapsed}s, ${text.length} chars`);
        return {
          text,
          sentimentAnalysis: pollJson.sentiment_analysis_results || null,
          autoHighlights: pollJson.auto_highlights_result?.results || null,
          confidence: typeof pollJson.confidence === "number" ? pollJson.confidence : null,
          audioDuration: typeof pollJson.audio_duration === "number" ? pollJson.audio_duration : null,
          languageCode: pollJson.language_code || options.languageCode || "es",
        };
      }
      if (pollJson.status === "error") {
        console.warn(`[transcription] error: ${pollJson.error || "(no detail)"}`);
        return null;
      }
      // status is "queued" or "processing" — keep polling.
    }
    console.warn(`[transcription] polling timed out after ${maxMs}ms`);
    return null;
  } catch (e) {
    console.warn(`[transcription] unexpected error: ${e.message}`);
    return null;
  }
}

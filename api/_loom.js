// api/_loom.js
//
// Shared Loom transcript fetcher. The previous version scraped the share
// page's __NEXT_DATA__ blob, which started failing silently when Loom
// moved the transcript render to the client side — the raw HTML we get
// server-side no longer contains it.
//
// This version tries a sequence of strategies in order of reliability,
// stopping at the first one that returns usable text. Each strategy logs
// what it attempted so we can inspect Vercel function logs when a video
// still fails.
//
// Order of attempts:
//   1. Loom oEmbed (`/v1/oembed`) — public metadata, sometimes includes
//      transcript in the `html` iframe or as a `transcript` field.
//   2. Extract the session UUID from the share URL and try known internal
//      API paths (transcript, captions, subtitles). These are best-effort:
//      Loom rewrites them occasionally, so we try several.
//   3. Fetch the share HTML with browser-grade headers and try to extract
//      the transcript from __NEXT_DATA__ + fallback recursive walk through
//      any inline JSON blob. (The previous approach, kept as safety net.)
//
// Filename prefixed with underscore so Vercel treats this as a shared
// module, not a serverless function.

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

function extractVideoId(loomUrl) {
  if (!loomUrl) return null;
  // Matches /share/{uuid} and /embed/{uuid} with various id formats.
  const m = loomUrl.match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9_-]+)/i);
  return m ? m[1] : null;
}

// Strip query params (especially ?sid=…) and force the /share/ path. Loom
// sometimes serves a different A/B variant of the page depending on the
// session id, and our bot-headers combo may trigger the lighter SSR variant.
function canonicalUrl(videoId, original) {
  if (videoId) return `https://www.loom.com/share/${videoId}`;
  try { const u = new URL(original); u.search = ""; return u.toString(); }
  catch { return original; }
}

// Joins an array of { raw_text | text | content | value } objects into a
// single space-separated string. Used by every extractor below.
function joinSegments(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out = arr
    .map(x => {
      if (!x) return "";
      if (typeof x === "string") return x;
      return x.raw_text || x.text || x.content || x.value || x.body || "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return out.length > 20 ? out : null;
}

// Walk a JSON tree looking for any array-of-sentences that matches the
// shape of a transcript.
function walkForTranscript(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 40) return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = walkForTranscript(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const arrayKeys = ["sentences", "transcript_sentences", "transcriptSentences", "captions", "transcript", "segments", "cues"];
  for (const key of arrayKeys) {
    const val = node[key];
    if (Array.isArray(val) && val.length > 0) {
      const first = val[0];
      if (first && typeof first === "object" && (first.raw_text || first.text || first.content || first.value || first.body)) {
        const joined = joinSegments(val);
        if (joined) return joined;
      }
    }
  }
  for (const k of Object.keys(node)) {
    const hit = walkForTranscript(node[k], depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Strategy 1: Loom oEmbed. May or may not include transcript depending on
// the video's privacy + captions settings. Fast, so always worth trying.
async function tryOembed(loomUrl) {
  try {
    const url = `https://www.loom.com/v1/oembed?url=${encodeURIComponent(loomUrl)}&format=json`;
    const res = await fetch(url, { headers: { "User-Agent": BROWSER_HEADERS["User-Agent"], "Accept": "application/json" } });
    if (!res.ok) {
      console.warn(`[loom] oembed non-ok: ${res.status}`);
      return null;
    }
    const data = await res.json();
    // Debug log: oEmbed top-level keys. Helps us learn what Loom currently
    // exposes without logging (potentially sensitive) values.
    console.warn(`[loom] oembed keys: ${Object.keys(data || {}).join(", ") || "(empty)"}`);
    // oEmbed sometimes exposes a transcript field directly.
    if (data.transcript) {
      if (typeof data.transcript === "string" && data.transcript.length > 20) {
        console.warn("[loom] transcript found via oembed.transcript (string)");
        return data.transcript.trim();
      }
      const walked = walkForTranscript(data.transcript);
      if (walked) {
        console.warn("[loom] transcript found via oembed.transcript (nested)");
        return walked;
      }
    }
    // Final attempt: recursive walk across the entire oEmbed response.
    const walkedAll = walkForTranscript(data);
    if (walkedAll) {
      console.warn("[loom] transcript found via oembed recursive walk");
      return walkedAll;
    }
    return null;
  } catch (e) {
    console.warn(`[loom] oembed error: ${e.message}`);
    return null;
  }
}

// Strategy 2: probe a list of Loom API endpoints that may return transcript
// data given a video UUID. Speculative — we log which one worked so we can
// learn which paths Loom keeps functional over time.
async function tryApiEndpoints(videoId) {
  if (!videoId) return null;
  const endpoints = [
    `https://www.loom.com/api/campaigns/sessions/${videoId}/transcript`,
    `https://www.loom.com/api/campaigns/sessions/${videoId}/transcoded-text`,
    `https://www.loom.com/api/videos/${videoId}/transcript`,
    `https://www.loom.com/api/videos/${videoId}/captions`,
    `https://www.loom.com/api/sessions/${videoId}/captions`,
    `https://cdn.loom.com/sessions/${videoId}/transcript.json`,
    `https://www.loom.com/captions/${videoId}.vtt`,
    `https://cdn.loom.com/sessions/${videoId}/captions.vtt`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: {
          ...BROWSER_HEADERS,
          "Accept": "application/json, text/vtt, text/plain",
          "Referer": `https://www.loom.com/share/${videoId}`,
        },
      });
      // Log the status for every endpoint so we can see at a glance which
      // returned something promising (200s) vs dead-end (404/403/500).
      console.warn(`[loom] api ${res.status} ← ${url}`);
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        console.warn(`[loom] api json keys (${url.split("/").slice(-1)[0]}): ${Object.keys(data || {}).join(", ") || "(empty)"}`);
        const walked = walkForTranscript(data);
        if (walked) {
          console.warn(`[loom] transcript found via JSON endpoint: ${url}`);
          return walked;
        }
        if (typeof data === "string" && data.length > 20) return data;
      } else if (ct.includes("text/vtt") || url.endsWith(".vtt")) {
        const text = await res.text();
        // Strip VTT markers and timecodes, keep only the cue text.
        const cleaned = text
          .replace(/^WEBVTT.*$/gm, "")
          .replace(/^\d+\s*$/gm, "")
          .replace(/^\d\d:\d\d[:.\d]* --> \d\d:\d\d[:.\d]*.*$/gm, "")
          .replace(/<[^>]+>/g, "")
          .replace(/\s+/g, " ")
          .trim();
        if (cleaned.length > 20) {
          console.warn(`[loom] transcript found via VTT endpoint: ${url}`);
          return cleaned;
        }
      } else {
        const text = await res.text();
        if (text.length > 20 && !text.trim().startsWith("<")) {
          console.warn(`[loom] transcript found via text endpoint: ${url}`);
          return text;
        }
      }
    } catch (e) {
      console.warn(`[loom] api error ${e.message} ← ${url}`);
    }
  }
  return null;
}

// Strategy 3: the original __NEXT_DATA__ HTML scrape, with recursive walk.
async function tryHtmlScrape(loomUrl) {
  try {
    const res = await fetch(loomUrl, { headers: BROWSER_HEADERS });
    if (!res.ok) {
      console.warn(`[loom] html fetch non-ok: ${res.status}`);
      return null;
    }
    const html = await res.text();
    console.warn(`[loom] html length: ${html.length}`);

    // Primary: __NEXT_DATA__ script blob.
    const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const data = JSON.parse(nextMatch[1]);
        // Log top-level + pageProps keys so we can see the current Loom
        // structure without reading the full blob.
        const topKeys = Object.keys(data || {}).join(", ");
        const ppKeys = Object.keys(data?.props?.pageProps || {}).join(", ");
        console.warn(`[loom] __NEXT_DATA__ top keys: ${topKeys || "(empty)"}`);
        console.warn(`[loom] __NEXT_DATA__ pageProps keys: ${ppKeys || "(empty)"}`);
        const walked = walkForTranscript(data);
        if (walked) {
          console.warn(`[loom] transcript found via __NEXT_DATA__`);
          return walked;
        }
      } catch (e) {
        console.warn(`[loom] __NEXT_DATA__ parse failed: ${e.message}`);
      }
    } else {
      console.warn(`[loom] no __NEXT_DATA__ block in html`);
    }

    // Fallback: walk every inline JSON script tag.
    const jsonScripts = html.match(/<script[^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/g) || [];
    console.warn(`[loom] inline json scripts: ${jsonScripts.length}`);
    for (const raw of jsonScripts) {
      const inner = raw.replace(/<script[^>]*>\s*/, "").replace(/\s*<\/script>$/, "");
      try {
        const data = JSON.parse(inner);
        const hit = walkForTranscript(data);
        if (hit) {
          console.warn(`[loom] transcript found via inline json scan`);
          return hit;
        }
      } catch { /* skip non-JSON */ }
    }

    // Last resort: look for `"transcript":"..."` or similar string-form
    // transcript fields embedded in the HTML.
    const strMatch = html.match(/"transcript"\s*:\s*"((?:[^"\\]|\\.){200,})"/);
    if (strMatch) {
      try {
        // Decode JSON string escapes inline.
        const decoded = JSON.parse(`"${strMatch[1]}"`);
        if (decoded.length > 20) {
          console.warn(`[loom] transcript found via inline string match`);
          return decoded;
        }
      } catch { /* ignore */ }
    }

    return null;
  } catch (e) {
    console.error(`[loom] html scrape error: ${e.message}`);
    return null;
  }
}

// Strategy 4: fetch the /embed/{id} page (the URL Loom's oEmbed iframe
// loads from). Embed pages sometimes SSR more transcript-related data than
// the share page because the player needs to be self-contained on third-
// party sites that may not run the same auth.
async function tryEmbedPage(videoId) {
  if (!videoId) return null;
  try {
    const url = `https://www.loom.com/embed/${videoId}`;
    const res = await fetch(url, { headers: BROWSER_HEADERS });
    console.warn(`[loom] embed fetch ${res.status} ${url}`);
    if (!res.ok) return null;
    const html = await res.text();
    console.warn(`[loom] embed html length: ${html.length}`);

    // Try __NEXT_DATA__ + recursive walk + inline JSON in this page too.
    const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const data = JSON.parse(nextMatch[1]);
        console.warn(`[loom] embed __NEXT_DATA__ pageProps keys: ${Object.keys(data?.props?.pageProps || {}).join(", ") || "(empty)"}`);
        const walked = walkForTranscript(data);
        if (walked) {
          console.warn(`[loom] transcript found via embed __NEXT_DATA__`);
          return walked;
        }
      } catch (e) { console.warn(`[loom] embed __NEXT_DATA__ parse failed: ${e.message}`); }
    }
    const jsonScripts = html.match(/<script[^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/g) || [];
    console.warn(`[loom] embed inline json scripts: ${jsonScripts.length}`);
    for (const raw of jsonScripts) {
      const inner = raw.replace(/<script[^>]*>\s*/, "").replace(/\s*<\/script>$/, "");
      try {
        const data = JSON.parse(inner);
        const hit = walkForTranscript(data);
        if (hit) {
          console.warn(`[loom] transcript found via embed inline json`);
          return hit;
        }
      } catch { /* skip non-JSON */ }
    }
    return null;
  } catch (e) {
    console.warn(`[loom] embed error: ${e.message}`);
    return null;
  }
}

// Strategy 5: AssemblyAI fallback. Loom is now actively gating their
// official transcript endpoints (the cdn.loom.com 403s in production
// confirmed it). Once scraping fails we hand the underlying video file URL
// to AssemblyAI, wait for its transcription, and return that. Costs
// ~$0.0017/min, polled at 2s intervals capped at 45s total to stay under
// Vercel Hobby's 60s function timeout.
//
// Requires ASSEMBLYAI_API_KEY in the environment. Skipped silently if
// not configured (with a clear log so Yan knows what's missing).

// Reject thumbnail-style URLs. Loom serves a 1-2s animated MP4 preview
// at /sessions/thumbnails/{id}-{hash}.mp4 — picking that as the audio
// source for AssemblyAI gives us no transcript (no/little audio in the
// preview clip). The real recording lives elsewhere.
function isThumbnailUrl(u) {
  return /\/sessions\/thumbnails\//i.test(u);
}

// Try a couple of dedicated "give me the video URL" endpoints on Loom.
// These are speculative — Loom's player calls one of these internally
// from JS at load time; if they're public we can replicate.
async function tryFetchVideoUrlEndpoint(videoId) {
  const endpoints = [
    `https://www.loom.com/api/campaigns/sessions/${videoId}/transcoded-url`,
    `https://www.loom.com/api/v1/campaigns/sessions/${videoId}/transcoded-url`,
    `https://www.loom.com/api/sessions/${videoId}/transcoded-url`,
    `https://www.loom.com/api/sessions/${videoId}/source-url`,
    `https://www.loom.com/api/videos/${videoId}/transcoded-url`,
  ];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        headers: { ...BROWSER_HEADERS, Accept: "application/json", Referer: `https://www.loom.com/share/${videoId}` },
      });
      console.warn(`[loom] video-url endpoint ${res.status} ← ${url}`);
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        // Look for a top-level url-like field. Different Loom revisions
        // have used different names.
        for (const key of ["url", "video_url", "source_url", "transcodedUrl", "videoUrl"]) {
          if (typeof data[key] === "string" && /\.mp4|\.m3u8/.test(data[key]) && !isThumbnailUrl(data[key])) {
            console.warn(`[loom] video URL via api endpoint (${key}): ${data[key].slice(0, 100)}…`);
            return data[key];
          }
        }
      }
    } catch (e) {
      console.warn(`[loom] video-url endpoint error: ${e.message} ← ${url}`);
    }
  }
  return null;
}

// Pull the actual MP4 URL out of /embed/{id}'s HTML so AssemblyAI has
// something it can stream. Loom embeds need to play on third-party sites
// (no auth cookies available), so the video src has to be public.
async function extractVideoFileUrl(videoId) {
  if (!videoId) return null;

  // Try dedicated Loom endpoints first — they return a JSON with the URL
  // and are fast (one round-trip). If any works, we're done.
  const fromApi = await tryFetchVideoUrlEndpoint(videoId);
  if (fromApi) return fromApi;

  // Fallback: scrape the embed page HTML for any non-thumbnail mp4/m3u8.
  try {
    const res = await fetch(`https://www.loom.com/embed/${videoId}`, { headers: BROWSER_HEADERS });
    if (!res.ok) {
      console.warn(`[loom] embed fetch for video URL non-ok: ${res.status}`);
      return null;
    }
    const html = await res.text();
    const candidates = [
      /https:\/\/cdn\.loom\.com\/sessions\/[^"'\s]+?\.mp4(?:\?[^"'\s]*)?/g,
      /https:\/\/cdn\.loom\.com\/[^"'\s]+?\.m3u8(?:\?[^"'\s]*)?/g,
      /https:\/\/[^"'\s]*loom\.com\/[^"'\s]*\.mp4(?:\?[^"'\s]*)?/g,
    ];
    for (const rx of candidates) {
      const matches = (html.match(rx) || []).filter(u => !isThumbnailUrl(u));
      if (matches.length) {
        // Prefer the longest URL (usually the highest-quality variant).
        const best = matches.sort((a, b) => b.length - a.length)[0];
        console.warn(`[loom] extracted video URL (scrape): ${best.slice(0, 100)}…`);
        return best;
      }
    }
    // If we only got thumbnails, surface that explicitly so the next
    // log lines explain why AssemblyAI is being skipped.
    const allMp4 = html.match(/https:\/\/cdn\.loom\.com\/[^"'\s]+?\.mp4/g) || [];
    if (allMp4.length) {
      console.warn(`[loom] only thumbnail URLs found in embed html (${allMp4.length} matches, all under /thumbnails/)`);
    } else {
      console.warn(`[loom] no video URL of any kind in embed html (length: ${html.length})`);
    }
    return null;
  } catch (e) {
    console.warn(`[loom] extractVideoFileUrl error: ${e.message}`);
    return null;
  }
}

async function tryAssemblyAI(videoId) {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    console.warn(`[loom] ASSEMBLYAI_API_KEY not set — skipping AssemblyAI fallback. Add it in Vercel env vars to enable automatic transcription when scrape fails.`);
    return null;
  }
  const audioUrl = await extractVideoFileUrl(videoId);
  if (!audioUrl) return null;

  try {
    // Submit transcription request. language_code="es" because RecruitAI is
    // a Spanish-first product; AssemblyAI auto-detects but biasing to ES
    // gives better diarisation for the typical recruiting use case.
    // AssemblyAI now requires speech_model in the body. Their error message
    // says "non-empty list … one or more of universal-3-pro, universal-2"
    // but the actual field is the singular speech_model with a single
    // string value. universal-2 is the cheap default; universal-3-pro is
    // higher accuracy at higher cost. Going with universal-2 — accuracy
    // on Spanish recruiting clips is already very good and we're cost-
    // sensitive in beta.
    const submitRes = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { "Authorization": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url: audioUrl,
        language_code: "es",
        speech_model: "universal-2",
      }),
    });
    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => "");
      console.warn(`[loom] assemblyai submit failed: ${submitRes.status} ${errText.slice(0, 200)}`);
      return null;
    }
    const submitJson = await submitRes.json();
    const transcriptId = submitJson.id;
    if (!transcriptId) {
      console.warn(`[loom] assemblyai submit returned no id`);
      return null;
    }
    console.warn(`[loom] assemblyai submitted, id: ${transcriptId}`);

    // Poll. Max 45s total — this leaves ~15s for the rest of the
    // /api/evaluate request before Vercel Hobby's 60s ceiling. Very long
    // videos will fall through to manual paste.
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
        console.warn(`[loom] assemblyai completed in ${elapsed}s, ${text.length} chars`);
        return text || null;
      }
      if (pollJson.status === "error") {
        console.warn(`[loom] assemblyai transcript error: ${pollJson.error || "(no detail)"}`);
        return null;
      }
      // status is "queued" or "processing" — keep polling.
    }
    console.warn(`[loom] assemblyai polling timed out after ${maxMs}ms`);
    return null;
  } catch (e) {
    console.warn(`[loom] assemblyai unexpected error: ${e.message}`);
    return null;
  }
}

export async function fetchLoomTranscript(loomUrl) {
  if (!loomUrl) return null;
  const videoId = extractVideoId(loomUrl);
  const canonical = canonicalUrl(videoId, loomUrl);
  console.warn(`[loom] fetching transcript for ${loomUrl} → canonical ${canonical} (videoId: ${videoId || "—"})`);

  // Strategy 1: oEmbed first (quickest).
  const oembed = await tryOembed(canonical);
  if (oembed) return oembed;

  // Strategy 2: API endpoints keyed by video UUID.
  const api = await tryApiEndpoints(videoId);
  if (api) return api;

  // Strategy 3: HTML scrape (legacy path) — use the canonical URL so sid
  // session params don't push us into a stripped SSR variant.
  const html = await tryHtmlScrape(canonical);
  if (html) return html;

  // Strategy 4: try the /embed/{id} variant. Embeds sometimes carry more
  // SSR'd data because they need to play on third-party sites without
  // the auth cookies the /share/ player relies on.
  const embed = await tryEmbedPage(videoId);
  if (embed) return embed;

  // Strategy 5: AssemblyAI fallback. Pulls the public MP4 URL out of
  // /embed/{id}, hands it to AssemblyAI, polls until done. Free unless
  // ASSEMBLYAI_API_KEY is set; logs cleanly when skipped.
  const assembly = await tryAssemblyAI(videoId);
  if (assembly) return assembly;

  console.warn(`[loom] all strategies failed for ${canonical}`);
  return null;
}

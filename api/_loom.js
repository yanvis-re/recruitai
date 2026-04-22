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
    console.log(`[loom] oembed keys: ${Object.keys(data || {}).join(", ") || "(empty)"}`);
    // oEmbed sometimes exposes a transcript field directly.
    if (data.transcript) {
      if (typeof data.transcript === "string" && data.transcript.length > 20) {
        console.log("[loom] transcript found via oembed.transcript (string)");
        return data.transcript.trim();
      }
      const walked = walkForTranscript(data.transcript);
      if (walked) {
        console.log("[loom] transcript found via oembed.transcript (nested)");
        return walked;
      }
    }
    // Final attempt: recursive walk across the entire oEmbed response.
    const walkedAll = walkForTranscript(data);
    if (walkedAll) {
      console.log("[loom] transcript found via oembed recursive walk");
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
      console.log(`[loom] api ${res.status} ← ${url}`);
      if (!res.ok) continue;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        console.log(`[loom] api json keys (${url.split("/").slice(-1)[0]}): ${Object.keys(data || {}).join(", ") || "(empty)"}`);
        const walked = walkForTranscript(data);
        if (walked) {
          console.log(`[loom] transcript found via JSON endpoint: ${url}`);
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
          console.log(`[loom] transcript found via VTT endpoint: ${url}`);
          return cleaned;
        }
      } else {
        const text = await res.text();
        if (text.length > 20 && !text.trim().startsWith("<")) {
          console.log(`[loom] transcript found via text endpoint: ${url}`);
          return text;
        }
      }
    } catch (e) {
      console.log(`[loom] api error ${e.message} ← ${url}`);
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
    console.log(`[loom] html length: ${html.length}`);

    // Primary: __NEXT_DATA__ script blob.
    const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const data = JSON.parse(nextMatch[1]);
        // Log top-level + pageProps keys so we can see the current Loom
        // structure without reading the full blob.
        const topKeys = Object.keys(data || {}).join(", ");
        const ppKeys = Object.keys(data?.props?.pageProps || {}).join(", ");
        console.log(`[loom] __NEXT_DATA__ top keys: ${topKeys || "(empty)"}`);
        console.log(`[loom] __NEXT_DATA__ pageProps keys: ${ppKeys || "(empty)"}`);
        const walked = walkForTranscript(data);
        if (walked) {
          console.log(`[loom] transcript found via __NEXT_DATA__`);
          return walked;
        }
      } catch (e) {
        console.warn(`[loom] __NEXT_DATA__ parse failed: ${e.message}`);
      }
    } else {
      console.log(`[loom] no __NEXT_DATA__ block in html`);
    }

    // Fallback: walk every inline JSON script tag.
    const jsonScripts = html.match(/<script[^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/g) || [];
    console.log(`[loom] inline json scripts: ${jsonScripts.length}`);
    for (const raw of jsonScripts) {
      const inner = raw.replace(/<script[^>]*>\s*/, "").replace(/\s*<\/script>$/, "");
      try {
        const data = JSON.parse(inner);
        const hit = walkForTranscript(data);
        if (hit) {
          console.log(`[loom] transcript found via inline json scan`);
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
          console.log(`[loom] transcript found via inline string match`);
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

export async function fetchLoomTranscript(loomUrl) {
  if (!loomUrl) return null;
  const videoId = extractVideoId(loomUrl);
  const canonical = canonicalUrl(videoId, loomUrl);
  console.log(`[loom] fetching transcript for ${loomUrl} → canonical ${canonical} (videoId: ${videoId || "—"})`);

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

  console.warn(`[loom] all strategies failed for ${canonical}`);
  return null;
}

// api/_loom.js
//
// Shared Loom transcript fetcher, used by /api/evaluate (manual, recruiter-
// triggered) and /api/autoEvaluate (candidate-triggered, fire-and-forget).
//
// Loom rewrites their Next.js bundle structure periodically. A path that
// worked six months ago (`props.pageProps.video.transcript.sentences`)
// silently started returning undefined and our previous parser just
// gave up. This module:
//   1. Tries a list of known paths that Loom has historically used.
//   2. Falls back to a recursive walk of the __NEXT_DATA__ tree looking
//      for any `sentences[]` / `transcript[]` / `captions[]` array whose
//      first item has a `raw_text` or `text` field. Robust against
//      Loom renaming the containing objects as long as the shape of
//      transcript items themselves stays similar.
//   3. Uses a browser-grade User-Agent so Loom doesn't short-circuit
//      the page into a bot-friendly empty shell.
//
// Filename starts with underscore so Vercel doesn't count this as a
// serverless function (stays at 11/12 on Hobby).

// Recursively walk a JSON object looking for a transcript-shaped array.
// Capped depth prevents runaway loops if Loom ever ships a cyclic blob.
function walkForTranscript(node, depth = 0) {
  if (!node || typeof node !== "object" || depth > 30) return null;

  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = walkForTranscript(child, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  // If this object directly carries a sentence-like array, use it.
  const arrayKeys = ["sentences", "transcript_sentences", "transcriptSentences", "captions", "transcript", "segments"];
  for (const key of arrayKeys) {
    const val = node[key];
    if (Array.isArray(val) && val.length > 0) {
      const first = val[0];
      if (first && typeof first === "object" && (first.raw_text || first.text || first.content || first.value)) {
        const joined = val
          .map(x => x.raw_text || x.text || x.content || x.value || "")
          .filter(Boolean)
          .join(" ")
          .trim();
        if (joined.length > 20) return joined;
      }
    }
  }

  // Recurse into children.
  for (const k of Object.keys(node)) {
    const hit = walkForTranscript(node[k], depth + 1);
    if (hit) return hit;
  }
  return null;
}

// Attempt the handful of paths Loom has used historically before resorting
// to the recursive walk. Cheap, avoids a full tree traversal in the common
// case.
function tryKnownPaths(data) {
  const pp = data?.props?.pageProps;
  const candidates = [
    pp?.video?.transcript?.sentences,
    pp?.oembed?.transcript?.sentences,
    pp?.transcriptData?.sentences,
    pp?.video?.transcriptData?.sentences,
    pp?.initialVideoData?.transcript?.sentences,
    pp?.videoData?.transcript?.sentences,
    pp?.videoCaptions?.sentences,
    pp?.captions?.sentences,
  ];
  for (const arr of candidates) {
    if (Array.isArray(arr) && arr.length > 0) {
      const joined = arr
        .map(x => x.raw_text || x.text || x.content || "")
        .filter(Boolean)
        .join(" ")
        .trim();
      if (joined.length > 20) return joined;
    }
  }
  return null;
}

export async function fetchLoomTranscript(loomUrl) {
  if (!loomUrl) return null;
  try {
    const res = await fetch(loomUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      console.warn("Loom fetch non-ok:", res.status);
      return null;
    }
    const html = await res.text();

    // 1. Try __NEXT_DATA__ (Next.js pages router — Loom's historical pattern).
    const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const data = JSON.parse(nextMatch[1]);
        const known = tryKnownPaths(data);
        if (known) return known;
        const walked = walkForTranscript(data);
        if (walked) return walked;
      } catch (e) {
        console.warn("Loom __NEXT_DATA__ parse failed:", e.message);
      }
    }

    // 2. Fallback: look for any inline JSON script tags that might contain
    //    the transcript (App Router / React Server Components patterns).
    const jsonScripts = html.match(/<script[^>]*>\s*(\{[\s\S]*?\})\s*<\/script>/g) || [];
    for (const raw of jsonScripts) {
      const inner = raw.replace(/<script[^>]*>\s*/, "").replace(/\s*<\/script>$/, "");
      try {
        const data = JSON.parse(inner);
        const hit = walkForTranscript(data);
        if (hit) return hit;
      } catch { /* skip non-JSON */ }
    }

    return null;
  } catch (e) {
    console.error("fetchLoomTranscript error:", e.message);
    return null;
  }
}

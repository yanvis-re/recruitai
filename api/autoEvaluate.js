// api/autoEvaluate.js
//
// Triggered server-side right after a candidate submits an application.
// Runs the IA evaluation against EVERY exercise in the process using the
// recruiter's custom criteria + brand manual, then writes the aggregated
// result back into the application document. By the time the recruiter
// opens the dashboard and imports, the candidate already has scores.
//
// Fire-and-forget from the client; errors are swallowed so candidate-side
// UX is never blocked by IA latency.
//
// Required Vercel env vars:
//   ANTHROPIC_API_KEY
//   FIREBASE_SERVICE_ACCOUNT_KEY   (admin SDK — read brand manual from
//                                   private recruiter doc)

import Anthropic from "@anthropic-ai/sdk";
import admin from "firebase-admin";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) {
    try {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    } catch (e) {
      console.error("Failed to initialize firebase-admin in autoEvaluate:", e.message);
    }
  }
}

// Position labels mirror the frontend POSITIONS array.
const POSITION_LABELS = {
  media_buyer: "Media Buyer",
  copywriter: "Copywriter",
  automatizador: "Automatizador",
  estratega: "Estratega / Funnel Builder",
  asistente_virtual: "Asistente Virtual",
  project_manager: "Project Manager",
  estratega_creativo: "Estratega Creativo",
  creativo_editor: "Creativo / Editor",
  redes_sociales: "Social Media Manager",
};
function getPositionTitle(position) {
  if (!position) return "Posición";
  if (position.positionType === "otro") return position.customTitle || "Otro";
  const base = POSITION_LABELS[position.positionType] || position.positionType || "Posición";
  return position.specialty ? `${base} — ${position.specialty}` : base;
}

async function fetchLoomTranscript(loomUrl) {
  if (!loomUrl) return null;
  try {
    const res = await fetch(loomUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; RecruitAI/1.0)" } });
    const html = await res.text();
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) return null;
    const data = JSON.parse(match[1]);
    const sentences =
      data?.props?.pageProps?.video?.transcript?.sentences ||
      data?.props?.pageProps?.oembed?.transcript?.sentences;
    if (!sentences || sentences.length === 0) return null;
    return sentences.map((s) => s.raw_text || s.text || "").join(" ");
  } catch (e) {
    return null;
  }
}

function buildExercisePrompt({ exerciseTitle, exerciseDescription, writtenResponse, videoTranscript, position, brandManual, companyName, criteria }) {
  const rubric = Array.isArray(criteria) && criteria.length > 0
    ? criteria.map((c, i) => `${i + 1}. **${c.area || `Criterio ${i + 1}`}** (máx. ${c.maxScore || 5} puntos) — ${c.indicators || "Sin indicadores definidos."}`).join("\n")
    : `1. **Claridad y estructura** (máx. 5) — La respuesta está bien organizada.
2. **Calidad del contenido** (máx. 5) — Las ideas son sólidas.
3. **Profundidad** (máx. 5) — El candidato justifica sus decisiones.`;

  const jsonSkeleton = Array.isArray(criteria) && criteria.length > 0
    ? criteria.map(c => `    {"name": "${(c.area || "Criterio").replace(/"/g, "\\\"")}", "score": 0, "maxScore": ${c.maxScore || 5}, "feedback": "..."}`).join(",\n")
    : `    {"name": "Claridad y estructura", "score": 0, "maxScore": 5, "feedback": "..."},
    {"name": "Calidad del contenido", "score": 0, "maxScore": 5, "feedback": "..."},
    {"name": "Profundidad", "score": 0, "maxScore": 5, "feedback": "..."}`;

  return `Eres un auditor externo riguroso evaluando a un candidato para el puesto de ${position} en ${companyName || "la agencia"}.

MANUAL DE MARCA / VALORES DE LA AGENCIA:
${brandManual || "No proporcionado. Evalúa basándote en criterios generales de profesionalismo y calidad."}

EJERCICIO PLANTEADO: ${exerciseTitle}
${exerciseDescription}

RESPUESTA ESCRITA DEL CANDIDATO:
${writtenResponse || "No proporcionada."}

TRANSCRIPCIÓN DEL VÍDEO DE DEFENSA:
${videoTranscript || "No proporcionada."}

INSTRUCCIONES: Actúa con mentalidad de auditor externo. Objetividad total, feedback accionable, nada de adular. Ten en cuenta respuesta escrita y defensa oral.

CRITERIOS DE EVALUACIÓN (definidos por el reclutador):
${rubric}

Devuelve ÚNICAMENTE el siguiente JSON (sin markdown):
{
  "criteria": [
${jsonSkeleton}
  ],
  "overall": 0,
  "strengths": ["...", "..."],
  "gaps": ["...", "..."],
  "recommendation": "AVANZAR",
  "summary": "..."
}

Notas: "overall" es 0-100 (normaliza). "recommendation" ∈ {AVANZAR, REVISAR, DESCARTAR}. strengths/gaps 2-4 bullets. summary 2-3 frases.`;
}

async function evaluateOneExercise(params) {
  const prompt = buildExercisePrompt(params);
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2500,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = message.content?.[0]?.text?.trim() || "";
  try {
    return JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { raw };
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!admin.apps.length) {
    return res.status(200).json({ success: false, skipped: true, reason: "admin_sdk_not_initialized" });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(200).json({ success: false, skipped: true, reason: "anthropic_key_missing" });
  }

  const { processId, applicationId } = req.body || {};
  if (!processId || !applicationId) return res.status(400).json({ error: "Missing processId or applicationId" });

  try {
    const db = admin.firestore();

    // 1. Process config
    const procSnap = await db.collection("publicProcesses").doc(processId).get();
    if (!procSnap.exists) return res.status(404).json({ error: "Process not found" });
    const proc = procSnap.data();
    const exercises = proc.exercises || [];
    if (exercises.length === 0) {
      return res.status(200).json({ success: true, skipped: true, reason: "no_exercises_defined" });
    }

    // 2. Brand manual from private recruiter doc
    let brandManual = "";
    if (proc.recruiterUid) {
      const recSnap = await db.collection("recruiters").doc(proc.recruiterUid).get();
      if (recSnap.exists) brandManual = recSnap.data()?.settings?.brandManual || "";
    }

    // 3. Application responses
    const appRef = db.collection("publicProcesses").doc(processId).collection("applications").doc(applicationId);
    const appSnap = await appRef.get();
    if (!appSnap.exists) return res.status(404).json({ error: "Application not found" });
    const application = appSnap.data();
    const responses = application.responses || [];

    // 4. Evaluate each exercise sequentially
    const position = getPositionTitle(proc.position);
    const companyName = proc.company?.name || "";
    const perExercise = [];

    for (const exercise of exercises) {
      const response = responses.find(r => r.exerciseId === exercise.id) || {};
      const loomTranscript = response.loomUrl ? await fetchLoomTranscript(response.loomUrl) : null;

      const evaluation = await evaluateOneExercise({
        exerciseTitle: exercise.title || "Ejercicio",
        exerciseDescription: exercise.description || "",
        criteria: exercise.criteria || [],
        writtenResponse: response.response || "",
        videoTranscript: loomTranscript,
        position,
        brandManual,
        companyName,
      });
      perExercise.push({
        exerciseId: exercise.id,
        exerciseTitle: exercise.title,
        loomTranscriptFetched: !!loomTranscript,
        ...evaluation,
      });
    }

    // 5. Aggregate same way the manual panel does (for UI consistency)
    const valid = perExercise.filter(e => e && typeof e.overall === "number");
    const aggOverall = valid.length > 0
      ? Math.round(valid.reduce((s, e) => s + (e.overall || 0), 0) / valid.length)
      : 0;
    const recWeight = { AVANZAR: 2, REVISAR: 1, DESCARTAR: 0 };
    const worstRec = valid.map(e => e.recommendation).filter(r => r in recWeight)
      .sort((a, b) => recWeight[a] - recWeight[b])[0] || "REVISAR";
    const strengths = [...new Set(perExercise.flatMap(e => e.strengths || []))].slice(0, 6);
    const gaps = [...new Set(perExercise.flatMap(e => e.gaps || []))].slice(0, 6);
    const summary = perExercise.map(e => `${e.exerciseTitle}: ${e.summary || "—"}`).join(" · ");

    const aggregate = {
      overall: aggOverall,
      recommendation: worstRec,
      strengths,
      gaps,
      summary,
      exercises: perExercise,
    };

    // 6. Persist back onto the application document
    await appRef.update({
      exerciseEvaluation: aggregate,
      autoEvaluatedAt: new Date().toISOString(),
    });

    return res.status(200).json({ success: true, evaluatedCount: perExercise.length });
  } catch (err) {
    console.error("autoEvaluate error:", err);
    return res.status(500).json({ error: err.message || "Internal error" });
  }
}

import Anthropic from "@anthropic-ai/sdk";
import admin from "firebase-admin";
import { reserveEvaluation } from "./_quota.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Admin SDK is used only to verify the recruiter's ID token and charge the
// evaluation against their monthly quota. Safe to init lazily — the quota
// helper does the same guard inside its own module.
if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) { try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); } catch (e) { console.error("firebase-admin init (evaluate):", e.message); } }
}

// ─── Fetch Loom transcript from URL ───────────────────────────────────────────
async function fetchLoomTranscript(loomUrl) {
  try {
    const res = await fetch(loomUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; RecruitAI/1.0)" },
    });
    const html = await res.text();
    const match = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
    );
    if (!match) return null;
    const data = JSON.parse(match[1]);
    const sentences =
      data?.props?.pageProps?.video?.transcript?.sentences ||
      data?.props?.pageProps?.oembed?.transcript?.sentences;
    if (!sentences || sentences.length === 0) return null;
    return sentences.map((s) => s.raw_text || s.text || "").join(" ");
  } catch (e) {
    console.error("Error fetching Loom transcript:", e);
    return null;
  }
}

// ─── Build exercise evaluation prompt ────────────────────────────────────────
// Criteria list comes from the process's exercise definition — each recruiter
// defines their own {area, indicators, maxScore} list when designing the
// process. The IA now evaluates against THOSE, not the old hardcoded six.
function buildExercisePrompt({ exerciseTitle, exerciseDescription, writtenResponse, videoTranscript, position, brandManual, companyName, criteria }) {
  const rubric = Array.isArray(criteria) && criteria.length > 0
    ? criteria.map((c, i) => `${i + 1}. **${c.area || `Criterio ${i + 1}`}** (máx. ${c.maxScore || 5} puntos) — ${c.indicators || "Sin indicadores definidos."}`).join("\n")
    : `1. **Claridad y estructura** (máx. 5) — La respuesta está bien organizada y es fácil de seguir.
2. **Calidad del contenido** (máx. 5) — Las ideas expuestas son sólidas y aportan valor.
3. **Profundidad** (máx. 5) — El candidato justifica sus decisiones y aporta detalle suficiente.`;

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

INSTRUCCIONES DE EVALUACIÓN:
Actúa con mentalidad de auditor externo. Principios:
- Objetividad total: juicios rigurosos, sin suavizar conclusiones
- Evalúa como si el cliente fuera a cancelar o un inversor estuviera por retirarse
- Feedback accionable: mejoras específicas con impacto esperado
- Prioriza el impacto: detecta errores críticos y riesgos potenciales
- Nada de adular: reconocer brevemente lo bueno, enfocar en lo que puede mejorar
- Ten en cuenta tanto la respuesta escrita como la defensa oral del candidato

CRITERIOS DE EVALUACIÓN (los definió el reclutador al crear este proceso — úsalos exactamente):
${rubric}

Devuelve ÚNICAMENTE el siguiente JSON (sin texto adicional, sin markdown). Usa los mismos nombres de criterio que arriba, y respeta el maxScore:
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

Instrucciones sobre los campos:
- "overall" es la puntuación global sobre 100 (normaliza: suma de scores / suma de maxScores * 100).
- "recommendation" solo admite: AVANZAR, REVISAR, DESCARTAR.
- "strengths" y "gaps": 2-4 bullets concretos cada uno.
- "summary": 2-3 frases con el veredicto narrativo.`;
}

// ─── Build interview evaluation prompt ───────────────────────────────────────
function buildInterviewPrompt({ transcript, position, brandManual, companyName }) {
  return `Eres un auditor externo riguroso evaluando una entrevista para el puesto de ${position} en ${companyName || "la agencia"}.

MANUAL DE MARCA / VALORES DE LA AGENCIA:
${brandManual || "No proporcionado. Evalúa basándote en criterios generales de profesionalismo y cultura de empresa."}

GUÍA OFICIAL DE ENTREVISTA (estructura a seguir):
1. Introducción y contexto
2. Expertise técnico y experiencia previa
3. Organización y proactividad
4. Compatibilidad con la agencia
5. Cierre y percepción general

TRANSCRIPCIÓN DE LA ENTREVISTA:
${transcript}

INSTRUCCIONES:
Actúa con mentalidad de auditor externo. Realiza DOS análisis completamente separados.

Marco de evaluación:
- Objetividad total: juicios rigurosos, sin suavizar conclusiones
- Feedback accionable con impacto esperado
- Nada de adular: enfocar en lo que puede y debe mejorar
- Tono formal pero accesible, directo y sin tecnicismos innecesarios

ANÁLISIS DEL CANDIDATO - ponderación oficial:
- Valores y cultura de empresa: 40%
- Actitud y proactividad: 30%
- Conocimientos técnicos y estratégicos: 25%
- Comunicación: 5%

ANÁLISIS DEL ENTREVISTADOR - evalúa:
- Alineación con la guía oficial de entrevista
- Claridad y profundidad de las preguntas
- Escucha activa y seguimiento de respuestas
- Cierre y manejo de tiempos

Devuelve ÚNICAMENTE el siguiente JSON (sin texto adicional, sin markdown):
{
  "candidate": {
    "sections": [
      {"name": "Introducción y contexto", "feedback": "..."},
      {"name": "Expertise técnico y experiencia previa", "feedback": "..."},
      {"name": "Organización y proactividad", "feedback": "..."},
      {"name": "Compatibilidad con la agencia", "feedback": "..."},
      {"name": "Cierre y percepción general", "feedback": "..."}
    ],
    "weights": [
      {"name": "Valores y cultura de empresa", "weight": 40, "score": 0, "feedback": "..."},
      {"name": "Actitud y proactividad", "weight": 30, "score": 0, "feedback": "..."},
      {"name": "Conocimientos técnicos y estratégicos", "weight": 25, "score": 0, "feedback": "..."},
      {"name": "Comunicación", "weight": 5, "score": 0, "feedback": "..."}
    ],
    "overall": 0,
    "strengths": ["...", "..."],
    "gaps": ["...", "..."],
    "recommendation": "CONTRATAR",
    "summary": "..."
  },
  "interviewer": {
    "strengths": ["...", "..."],
    "improvements": ["...", "..."],
    "overall_score": 0,
    "summary": "..."
  }
}
Valores válidos para recommendation del candidato: CONTRATAR, SEGUNDA_ENTREVISTA, EN_CARTERA, DESCARTAR`;
}

// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    // Identify the recruiter so the evaluation gets charged against their
    // monthly quota. Bearer token is optional for backward compatibility —
    // if missing we fail open (quota helper returns skipped:true). Once the
    // frontend is fully auth'd we can harden this to require the token.
    let recruiterUid = null;
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (token && admin.apps.length) {
      try { const decoded = await admin.auth().verifyIdToken(token); recruiterUid = decoded.uid; }
      catch (e) { return res.status(401).json({ error: "Invalid token" }); }
    }

    // Reserve one unit of quota BEFORE calling Claude. If the recruiter is
    // over the monthly cap we bail with 429 and a clear payload the UI can
    // render ("te quedan 0/50 evaluaciones este mes, resetea el 1 de MM").
    const quota = await reserveEvaluation(recruiterUid);
    if (!quota.ok) {
      return res.status(429).json({
        error: "quota_exceeded",
        used: quota.used,
        limit: quota.limit,
        period: quota.period,
        message: `Has alcanzado el límite mensual de evaluaciones IA (${quota.used}/${quota.limit}). Se resetea el 1 del próximo mes.`,
      });
    }

    const { type, data } = req.body;

    let prompt;
    let loomTranscript = null;

    if (type === "exercise") {
      // Try to fetch Loom transcript automatically
      if (data.loomUrl) {
        loomTranscript = await fetchLoomTranscript(data.loomUrl);
      }
      prompt = buildExercisePrompt({
        ...data,
        videoTranscript: loomTranscript || data.videoTranscript || null,
      });
    } else if (type === "interview") {
      prompt = buildInterviewPrompt(data);
    } else {
      return res.status(400).json({ error: "type must be 'exercise' or 'interview'" });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0].text.trim();

    // Parse JSON — Claude should return clean JSON but handle edge cases
    let evaluation;
    try {
      evaluation = JSON.parse(raw);
    } catch {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      evaluation = jsonMatch ? JSON.parse(jsonMatch[0]) : { raw };
    }

    res.status(200).json({ evaluation, loomTranscriptFetched: !!loomTranscript });
  } catch (e) {
    console.error("Evaluation error:", e);
    res.status(500).json({ error: e.message || "Error interno del servidor" });
  }
}

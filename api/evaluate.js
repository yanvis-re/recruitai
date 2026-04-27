import Anthropic from "@anthropic-ai/sdk";
import admin from "firebase-admin";
import { reserveEvaluation } from "./_quota.js";
import { transcribeWithAssemblyAI } from "./_videoTranscription.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Admin SDK is used only to verify the recruiter's ID token and charge the
// evaluation against their monthly quota. Safe to init lazily — the quota
// helper does the same guard inside its own module.
if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) { try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); } catch (e) { console.error("firebase-admin init (evaluate):", e.message); } }
}

// Build the paralinguistic context block for the prompt. Only fires when
// videoMetadata is present — i.e. the candidate uploaded an MP4 to Drive /
// Dropbox and AssemblyAI returned sentiment + highlights + confidence.
// Returns "" when there's nothing extra to add (so the prompt stays
// identical to the legacy text-only evaluation in that case).
function buildParalinguisticBlock(videoMetadata) {
  if (!videoMetadata) return "";

  const { sentimentAnalysis, autoHighlights, confidence, audioDuration } = videoMetadata;

  // Sentiment: AssemblyAI returns a sentence-level array. Roll it up to
  // percentages so the prompt is concise and the IA doesn't drown in detail.
  let sentimentLine = "";
  if (Array.isArray(sentimentAnalysis) && sentimentAnalysis.length > 0) {
    const counts = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 };
    for (const s of sentimentAnalysis) if (counts[s.sentiment] !== undefined) counts[s.sentiment]++;
    const total = counts.POSITIVE + counts.NEUTRAL + counts.NEGATIVE;
    if (total > 0) {
      const pct = (n) => Math.round((n / total) * 100);
      sentimentLine = `- Sentimiento general detectado en la voz: ${pct(counts.POSITIVE)}% positivo · ${pct(counts.NEUTRAL)}% neutro · ${pct(counts.NEGATIVE)}% negativo.`;
    }
  }

  // Highlights: keyword-style bullets AssemblyAI extracts as recurring topics.
  let highlightsLine = "";
  if (Array.isArray(autoHighlights) && autoHighlights.length > 0) {
    const topPhrases = autoHighlights
      .sort((a, b) => (b.rank || 0) - (a.rank || 0))
      .slice(0, 6)
      .map(h => h.text)
      .filter(Boolean);
    if (topPhrases.length) highlightsLine = `- Temas/conceptos clave detectados: ${topPhrases.join(", ")}.`;
  }

  let confidenceLine = "";
  if (typeof confidence === "number") {
    const pct = Math.round(confidence * 100);
    const label = pct >= 90 ? "muy clara" : pct >= 75 ? "clara" : pct >= 60 ? "aceptable" : "baja";
    confidenceLine = `- Claridad de dicción (confianza promedio del transcriptor): ${pct}% (${label}).`;
  }

  let durationLine = "";
  if (typeof audioDuration === "number" && audioDuration > 0) {
    durationLine = `- Duración del vídeo: ${Math.round(audioDuration)} segundos.`;
  }

  const lines = [sentimentLine, highlightsLine, confidenceLine, durationLine].filter(Boolean);
  if (!lines.length) return "";

  return `\nANÁLISIS PARALINGÜÍSTICO DEL VÍDEO (disponible solo cuando el candidato subió el archivo de vídeo):
${lines.join("\n")}

Cuando tengas estos datos, evalúa también CÓMO comunica el candidato — no solo qué dice:
- Claridad y ritmo del discurso
- Energía, convicción y confianza transmitidas
- Coherencia entre el contenido (qué dice) y la entrega (cómo lo dice)
Pondera estos aspectos especialmente para puestos comerciales o de cara al cliente.
`;
}

// ─── Build exercise evaluation prompt ────────────────────────────────────────
// Criteria list comes from the process's exercise definition — each recruiter
// defines their own {area, indicators, maxScore} list when designing the
// process. The IA now evaluates against THOSE, not the old hardcoded six.
function buildExercisePrompt({ exerciseTitle, exerciseDescription, writtenResponse, videoTranscript, position, brandManual, companyName, criteria, videoMetadata }) {
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
${buildParalinguisticBlock(videoMetadata)}
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
    let videoMetadata = null;

    if (type === "exercise") {
      // Transcript priority (final order):
      //   1. data.videoMp4Url + AssemblyAI ⟶ rich transcript + sentiment +
      //      auto_highlights + confidence. Best evaluation: includes
      //      paralinguistic signals (how the candidate communicates).
      //   2. data.videoTranscript pasted by the candidate (or by the
      //      recruiter as fallback). Same content quality as #1 minus the
      //      paralinguistic data.
      //   3. No transcript ⟶ IA evaluates with the written answer only.
      //
      // If both #1 and #2 are present, #1 wins for the IA prompt (richer
      // signal) but #2 is kept as a safety net if AssemblyAI fails midway.
      if (data.videoMp4Url) {
        const result = await transcribeWithAssemblyAI(data.videoMp4Url);
        if (result?.text) {
          loomTranscript = result.text;
          videoMetadata = {
            sentimentAnalysis: result.sentimentAnalysis,
            autoHighlights: result.autoHighlights,
            confidence: result.confidence,
            audioDuration: result.audioDuration,
            languageCode: result.languageCode,
            source: "assemblyai_mp4",
          };
        }
      }
      // Fall back to the candidate-pasted transcript if AssemblyAI didn't
      // give us anything (key missing, MP4 not accessible, polling timeout
      // …). The prompt stays the same shape, just without the
      // paralinguistic block.
      if (!loomTranscript && data.videoTranscript && data.videoTranscript.trim()) {
        loomTranscript = data.videoTranscript.trim();
      }
      prompt = buildExercisePrompt({
        ...data,
        videoTranscript: loomTranscript || null,
        videoMetadata,
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

    // videoMetadata stays null in F1; F2 will populate it when AssemblyAI
    // runs against data.videoMp4Url. Wire-format placeholder kept now so
    // the recruiter UI can be built against the final shape.
    res.status(200).json({ evaluation, loomTranscriptFetched: !!loomTranscript, videoMetadata });
  } catch (e) {
    console.error("Evaluation error:", e);
    res.status(500).json({ error: e.message || "Error interno del servidor" });
  }
}

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
function buildExercisePrompt({ exerciseTitle, exerciseDescription, writtenResponse, videoTranscript, position, brandManual, companyName }) {
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

Evalúa con base en 6 criterios (puntuación 0-10 cada uno):
1. Diagnóstico estratégico
2. Funnel y planificación táctica
3. Estimaciones y métricas
4. Propuesta operativa y responsabilidades
5. Identificación de riesgos
6. Justificación estratégica y comunicación con cliente

Devuelve ÚNICAMENTE el siguiente JSON (sin texto adicional, sin markdown):
{
  "criteria": [
    {"name": "Diagnóstico estratégico", "score": 0, "feedback": "..."},
    {"name": "Funnel y planificación táctica", "score": 0, "feedback": "..."},
    {"name": "Estimaciones y métricas", "score": 0, "feedback": "..."},
    {"name": "Propuesta operativa y responsabilidades", "score": 0, "feedback": "..."},
    {"name": "Identificación de riesgos", "score": 0, "feedback": "..."},
    {"name": "Justificación estratégica y comunicación con cliente", "score": 0, "feedback": "..."}
  ],
  "overall": 0,
  "strengths": ["...", "..."],
  "gaps": ["...", "..."],
  "recommendation": "AVANZAR",
  "summary": "..."
}
Valores válidos para recommendation: AVANZAR, REVISAR, DESCARTAR`;
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

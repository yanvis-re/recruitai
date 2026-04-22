// api/parseExerciseDocument.js
//
// Parses a document that contains a single exercise statement (+ optional
// evaluation criteria) into the {title, description, criteria[]} shape the
// RecruiterSetupScreen uses for each exercise in the process.
//
// Called from the exercises step: the recruiter can upload a PDF/DOCX/TXT
// with the exercise they already have prepared (often a Notion export or a
// briefing doc) and the IA structures it into a process-ready exercise.
//
// Required Vercel env var: ANTHROPIC_API_KEY

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt(text) {
  return `Eres un asistente que extrae ejercicios prácticos de procesos de selección a partir de documentos en castellano.

DOCUMENTO PROPORCIONADO:
"""
${text.slice(0, 10000)}
"""

TAREA: Extrae UN ejercicio (el principal descrito en el documento) y devuélvelo como JSON:

{
  "title": "",          // Título breve (3-8 palabras). Si el documento lo trae, úsalo; si no, sintetiza uno a partir del contenido.
  "description": "",    // Enunciado completo que el candidato debe leer para resolver el ejercicio. Texto narrativo, no bullets. Incluye el contexto, la tarea y cualquier restricción (deadline, formato, longitud, etc.)
  "criteria": [
    {
      "area": "",        // Área evaluada (ej. "Diagnóstico estratégico")
      "indicators": "",  // Qué se mide concretamente en esa área
      "maxScore": 5      // Puntuación máxima, generalmente 5 o 10
    }
  ]
}

REGLAS:

1. title — si el documento tiene un título propio del ejercicio, cópialo. Si no, genera uno descriptivo y corto.

2. description — redacta el enunciado completo tal y como un candidato necesitaría leerlo para resolverlo. Conserva el contexto y la tarea. Si hay varias partes o preguntas, inclúyelas. Si el documento tiene secciones ("Contexto", "Tarea", "Entregables"), unifícalas en un texto fluido que siga un orden lógico.

3. criteria — esta es la parte clave:
   - Si el documento LISTA criterios explícitos de evaluación (rúbrica, "se valorará", "criterios", "qué se evalúa", etc.), EXTRÁELOS TAL CUAL con su area + indicators + maxScore.
   - Si el documento menciona aspectos evaluables pero SIN formato de rúbrica, estructúralos como criterios con area + indicators coherentes.
   - Si el documento NO menciona criterios, INFIERE 3-5 criterios razonables basándote en el enunciado (ej. si el ejercicio pide una estrategia de paid media, los criterios pueden incluir "Diagnóstico", "Funnel y táctica", "Métricas", "Riesgos").
   - maxScore por defecto es 5. Si el documento especifica puntuaciones diferentes (sobre 10, sobre 20…), normaliza a 5 o 10. Si dice "sobre 100", usa 10.

4. Formato: devuelve ÚNICAMENTE el JSON, sin markdown, sin texto adicional.

Si el documento NO contiene ningún ejercicio (es puramente una oferta de empleo, un CV, un manual de marca, etc.), devuelve:
{
  "title": "",
  "description": "",
  "criteria": [],
  "error": "El documento no parece contener un ejercicio práctico."
}`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada." });
  }

  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length < 50) {
      return res.status(400).json({ error: "El documento no contiene suficiente texto (mínimo 50 caracteres)." });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2500,
      messages: [{ role: "user", content: buildPrompt(text) }],
    });

    const raw = message.content?.[0]?.text?.trim() || "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("La IA devolvió una respuesta que no pude parsear como JSON.");
      parsed = JSON.parse(match[0]);
    }

    if (parsed.error) {
      return res.status(200).json({ error: parsed.error });
    }

    // Normalize criteria to ensure maxScore is numeric.
    const criteria = Array.isArray(parsed.criteria) && parsed.criteria.length > 0
      ? parsed.criteria.map(c => ({
          area: c.area || "",
          indicators: c.indicators || "",
          maxScore: typeof c.maxScore === "number" ? c.maxScore : parseInt(c.maxScore) || 5,
        }))
      : [{ area: "Calidad general", indicators: "Revisión global del ejercicio", maxScore: 5 }];

    return res.status(200).json({
      exercise: {
        title: parsed.title || "Ejercicio",
        description: parsed.description || "",
        criteria,
      },
    });
  } catch (err) {
    console.error("parseExerciseDocument error:", err);
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}

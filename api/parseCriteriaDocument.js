// api/parseCriteriaDocument.js
//
// Parses a document that contains ONLY evaluation criteria (rubric) for an
// existing exercise. Separate endpoint so the recruiter can attach a rubric
// to an exercise they already wrote manually.
//
// Required Vercel env var: ANTHROPIC_API_KEY

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt(text) {
  return `Eres un asistente que extrae criterios de evaluación de documentos de rúbricas en castellano.

DOCUMENTO PROPORCIONADO:
"""
${text.slice(0, 8000)}
"""

TAREA: Extrae los criterios de evaluación y devuélvelos como JSON:

{
  "criteria": [
    {
      "area": "",         // Área evaluada, nombre corto (ej. "Diagnóstico estratégico")
      "indicators": "",   // Qué se mide concretamente (ej. "Capacidad de identificar el problema y proponer soluciones")
      "maxScore": 5       // Puntuación máxima, generalmente 5 o 10
    }
  ]
}

REGLAS:

1. Si el documento tiene una TABLA/LISTA DE CRITERIOS explícita, extrae cada fila/punto como un criterio. Respeta los nombres literales de cada área.

2. Si el documento describe aspectos evaluables en prosa (sin formato tabular), estructúralos igualmente como criterios, creando un area + indicators coherentes para cada aspecto mencionado.

3. maxScore:
   - Si el documento especifica puntuación (ej. "sobre 10", "0-5", "hasta 20 pts"), úsalo. Normaliza rangos raros (ej. "sobre 100" → 10).
   - Si no lo especifica, usa 5 por defecto.

4. Devuelve entre 2 y 10 criterios. Si el documento tiene más de 10, agrupa los más parecidos. Si tiene menos de 2, devuelve lo que haya.

5. Si el documento NO contiene criterios de evaluación (es un enunciado sin rúbrica, un CV, un manual de marca, etc.), devuelve:
   {
     "criteria": [],
     "error": "El documento no parece contener una rúbrica de evaluación."
   }

6. Formato: solo JSON válido, sin markdown, sin texto adicional.`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada." });

  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length < 30) {
      return res.status(400).json({ error: "El documento no contiene suficiente texto." });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: buildPrompt(text) }],
    });

    const raw = message.content?.[0]?.text?.trim() || "";
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("La IA devolvió una respuesta que no pude parsear como JSON.");
      parsed = JSON.parse(match[0]);
    }

    if (parsed.error) return res.status(200).json({ error: parsed.error });

    const criteria = Array.isArray(parsed.criteria) && parsed.criteria.length > 0
      ? parsed.criteria.map(c => ({
          area: c.area || "",
          indicators: c.indicators || "",
          maxScore: typeof c.maxScore === "number" ? c.maxScore : parseInt(c.maxScore) || 5,
        }))
      : [];

    if (criteria.length === 0) {
      return res.status(200).json({ error: "No se detectaron criterios en el documento." });
    }

    return res.status(200).json({ criteria });
  } catch (err) {
    console.error("parseCriteriaDocument error:", err);
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}

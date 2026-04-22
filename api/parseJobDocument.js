// api/parseJobDocument.js
//
// Extracts structured job-spec fields from the raw text of a document the
// recruiter uploaded (PDF/DOCX/TXT parsed client-side, text POSTed here).
// Claude maps free-form prose into the same shape as defaultJob in App.jsx,
// so the result can be dropped directly into RecruiterSetupScreen's data
// state with a single setData() call.
//
// Required Vercel env var: ANTHROPIC_API_KEY

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Keep this list in sync with the POSITIONS array in src/App.jsx.
const POSITION_TYPES = [
  "media_buyer", "copywriter", "automatizador", "estratega",
  "asistente_virtual", "project_manager", "estratega_creativo",
  "creativo_editor", "redes_sociales", "otro",
];

function buildPrompt(text) {
  return `Eres un asistente que extrae información estructurada de documentos de ofertas de empleo o briefings de procesos de selección en castellano.

DOCUMENTO PROPORCIONADO POR EL RECLUTADOR:
"""
${text.slice(0, 12000)}
"""

TAREA: Extrae la información y devuelve ÚNICAMENTE un objeto JSON con la siguiente estructura. Si algún campo NO aparece en el documento, déjalo como cadena vacía "" — NO lo inventes.

{
  "company": {
    "name": "",
    "description": "",
    "sector": "",
    "location": "",
    "modality": "",       // uno de: "Remoto", "Presencial", "Híbrido" (o "" si no se menciona)
    "salaryMin": "",      // número en string, ej. "40000" (sin símbolos, sin puntos de miles)
    "salaryMax": "",      // idem
    "currency": ""        // uno de: "EUR", "USD", "GBP", "MXN" (o "" si no se menciona)
  },
  "position": {
    "positionType": "",   // uno de: ${POSITION_TYPES.join(", ")}. Usa "otro" si no encaja ninguno.
    "specialty": "",      // opcional, depende del positionType
    "customTitle": "",    // SOLO si positionType === "otro" — título literal del puesto
    "responsibilities": "",
    "skills": "",         // lista separada por comas
    "experience": "",     // años, como string, ej. "3"
    "contract": "",       // uno de: "Freelance", "Contrato directo" (o "" si no claro)
    "hoursPerWeek": "",   // número como string, ej. "40"
    "schedule": "",       // uno de: "Mañanas", "Tardes", "Flexible" (o "" si no se menciona)
    "benefits": ""
  },
  "exercises": [
    {
      "title": "",        // título del ejercicio propuesto
      "description": "",  // enunciado completo que verá el candidato
      "criteria": [
        {
          "area": "",        // qué se evalúa (ej. "Claridad estratégica")
          "indicators": "",  // indicadores concretos (ej. "Capacidad de identificar el problema y proponer soluciones")
          "maxScore": 5      // puntuación máxima, habitualmente 5 o 10
        }
      ]
    }
  ]
}

REGLAS IMPORTANTES:
1. Si el documento describe MÚLTIPLES ejercicios, devuelve uno por cada uno en el array exercises[]. Si describe UNO, devuelve un único ejercicio. Si NO describe ninguno, devuelve array vacío [].
2. Cada ejercicio debe tener al menos 1 criterio. Si el documento no desglosa criterios, infiere 2-4 razonables a partir del enunciado.
3. Para "responsibilities" y "skills", prefiere un texto descriptivo natural (no bullets markdown).
4. Para "positionType", elige el más cercano semánticamente. Si el puesto es claramente de marketing pero no encaja en media_buyer / copywriter / etc., usa "otro" con customTitle.
5. NO añadas campos que no estén en el esquema. NO uses markdown. Solo JSON válido.
6. Si los años de experiencia aparecen como rango (ej. "3-5 años"), usa el mínimo.
7. Para moneda, si el documento usa el símbolo €, interpreta como "EUR"; $ como "USD", etc.

Devuelve ÚNICAMENTE el JSON.`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada en Vercel." });
  }

  try {
    const { text } = req.body || {};
    if (!text || typeof text !== "string" || text.trim().length < 50) {
      return res.status(400).json({ error: "El documento no contiene suficiente texto (mínimo 50 caracteres)." });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
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

    // Normalize exercises so each criterion has the id/maxScore shape the UI expects.
    if (Array.isArray(parsed.exercises)) {
      parsed.exercises = parsed.exercises.map((ex, idx) => ({
        id: Date.now() + idx, // stable-ish ids, front will override anyway
        title: ex.title || `Ejercicio ${idx + 1}`,
        description: ex.description || "",
        criteria: Array.isArray(ex.criteria) && ex.criteria.length > 0
          ? ex.criteria.map(c => ({
              area: c.area || "",
              indicators: c.indicators || "",
              maxScore: typeof c.maxScore === "number" ? c.maxScore : parseInt(c.maxScore) || 5,
            }))
          : [{ area: "Calidad general", indicators: "Revisión global del ejercicio", maxScore: 5 }],
      }));
    } else {
      parsed.exercises = [];
    }

    return res.status(200).json({ job: parsed });
  } catch (err) {
    console.error("parseJobDocument error:", err);
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}

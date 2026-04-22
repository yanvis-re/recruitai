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

TAREA: Extrae la información y devuelve ÚNICAMENTE un objeto JSON con esta estructura:

{
  "company": {
    "name": "", "description": "", "sector": "", "location": "",
    "modality": "",       // uno de: "Remoto", "Presencial", "Híbrido"
    "salaryMin": "",      // número en string, ej. "40000" (sin símbolos, sin puntos de miles)
    "salaryMax": "",
    "currency": ""        // uno de: "EUR", "USD", "GBP", "MXN"
  },
  "position": {
    "positionType": "",   // uno de: ${POSITION_TYPES.join(", ")}. Usa "otro" si no encaja ninguno.
    "specialty": "",
    "customTitle": "",    // SOLO si positionType === "otro"
    "responsibilities": "",
    "skills": "",         // lista separada por comas
    "experience": "",
    "contract": "",       // uno de: "Freelance", "Contrato directo"
    "hoursPerWeek": "",
    "schedule": "",       // uno de: "Mañanas", "Tardes", "Flexible"
    "benefits": ""
  },
  "exercises": [
    {
      "title": "", "description": "",
      "criteria": [{"area": "", "indicators": "", "maxScore": 5}]
    }
  ]
}

REGLAS DE EXTRACCIÓN (importantes — léelas con atención):

A) Campos FACTUALES — déjalos vacíos si no aparecen literalmente en el documento:
   - company.name, company.location, company.sector
   - company.salaryMin, company.salaryMax, company.currency
   - company.modality (solo si se menciona Remoto/Presencial/Híbrido)
   - position.experience (años concretos), position.hoursPerWeek, position.contract, position.schedule

B) Campos NARRATIVOS — PUEDES Y DEBES sintetizar + DEVOLVER EN MARKDOWN cuando tenga estructura:
   - company.description: 1-3 frases que sirvan de contexto al candidato. Texto plano o con **negrita** en datos clave. Si hay mucho contenido, puedes usar 2 párrafos (separa con \\n\\n). SÍ puedes inferir, SIN inventar datos que no están.
   - position.responsibilities: **usa Markdown** si el documento tiene lista o secciones. Preserva headings (\`## Día a día\`, \`## Reporting\`), listas (\`- bullet\`) y negrita en cosas clave. Si es un solo párrafo, déjalo como prosa sin formato.
   - position.skills: lista SEPARADA POR COMAS (no markdown, no bullets). Recopila skills técnicas + herramientas + soft skills en un solo string coma-separado.
   - position.benefits: **usa Markdown** como lista con bullets (\`- beneficio 1\\n- beneficio 2\`) si hay varios. Si es un solo beneficio o prosa corta, texto plano.

C) Ejercicios:
   - Si el documento describe MÚLTIPLES ejercicios, devuelve uno por cada uno.
   - Si describe UNO, devuelve un único ejercicio.
   - Si NO describe ninguno, devuelve array vacío [].
   - Cada ejercicio debe tener ≥1 criterio. Si el documento no desglosa criterios, infiere 2-4 razonables a partir del enunciado.

D) Formato:
   - positionType: elige el más cercano semánticamente. Si no encaja ninguno, usa "otro" + customTitle.
   - currency: "€" → "EUR", "$" → "USD", "£" → "GBP".
   - Experiencia en rango (ej. "2-5 años") → usa el mínimo ("2").
   - NO añadas campos fuera del esquema. NO uses markdown. Solo JSON válido.

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

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
  "title": "",          // Título breve (3-8 palabras)
  "description": "",    // Enunciado formateado en Markdown (ver reglas abajo)
  "criteria": [
    { "area": "", "indicators": "", "maxScore": 5 }
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS DE FORMATO PARA "description" (IMPORTANTE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

El "description" DEBE devolverse en **Markdown estructurado** tal y como el candidato lo va a leer. NO uses texto plano corrido. El documento original suele tener secciones, listas y énfasis — preserva toda esa estructura en Markdown.

Usa:
- \`## Título\` y \`### Subtítulo\` para secciones. Conserva los EMOJIS del documento original cuando aparezcan (ej. \`## 🎯 Objetivo\`).
- Listas con \`- \` para bullets.
- Listas numeradas con \`1. \`, \`2. \`, \`3. \`
- \`**negrita**\` para términos clave (nombres de cliente, ofertas, datos específicos como importes, fechas o porcentajes).
- Párrafos separados por línea en blanco (salto de línea doble).
- Sub-bullets con indentación de 2 espacios.

Ejemplo de salida esperada para un ejercicio de estrategia:

## 🎯 Objetivo

Evaluar tu capacidad para analizar una situación compleja y diseñar una estrategia coherente.

## 🧪 Escenario

**Cliente:** Empresa X.
**Oferta a promocionar:** Formación online premium.

### 🔎 Historial del cliente

1. Máximo referente de su mercado.
2. Competidores crecientes.
3. Últimos lanzamientos con caída de ventas.

### 🎯 Objetivos del lanzamiento

- **Inversión en paid media:** 50.000 €
- **Objetivo de facturación:** 200.000-275.000 €
- **Precio del producto:** 3.500 €

## 🧩 Qué debe incluir tu propuesta

### 1. Diagnóstico inicial

- ¿Qué modalidad estratégica usarías? Justifícalo.
- ¿Qué palancas usarías para mantener autoridad?

### 2. Funnel y planificación

- Tipo de funnel...
- Fases y mensajes...

## 📝 Entrega

Formato libre: vídeo (máx. 10-15 min), PDF o Notion. Estructura por secciones.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OTRAS REGLAS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. title: si el documento tiene título propio del ejercicio, cópialo limpio (sin emojis iniciales que sobren). Si no, sintetízalo corto y descriptivo.

2. criteria:
   - Si el documento lista criterios explícitos de evaluación (rúbrica, "se valorará", "criterios"), extráelos tal cual con area + indicators + maxScore.
   - Si solo los menciona en prosa, estructúralos.
   - Si no hay ninguno, infiere 3-5 criterios razonables a partir del enunciado.
   - maxScore por defecto 5. Si el documento usa otra escala, normaliza a 5 o 10.

3. NO devuelvas markdown en title ni en criteria.area/indicators — solo en description.

4. Formato de salida: solo JSON válido. El valor de "description" es un string normal que contiene markdown (los saltos de línea como \\n, etc.). No uses triple backticks ni otros delimitadores.

Si el documento NO contiene ningún ejercicio (es una oferta de empleo, CV, manual de marca, etc.), devuelve:
{
  "title": "", "description": "", "criteria": [],
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

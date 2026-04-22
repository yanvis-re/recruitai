// api/parse.js
//
// Consolidated document-parsing router. One serverless function for four
// document types:
//
//   action: "job"       → extract full job spec (company + position + exercises)
//   action: "exercise"  → extract a single exercise (title + description + criteria)
//   action: "criteria"  → extract only an evaluation rubric
//   action: "response"  → reformat a candidate's own exercise answer to Markdown,
//                         preserving headings/lists/bold/italic/structure without
//                         changing the content
//
// Body: { action, text }
// Each branch uses Claude to turn the raw document text into structured JSON
// matching the shapes consumed by RecruiterSetupScreen and the candidate's
// public apply screen in src/App.jsx.
//
// Required Vercel env var: ANTHROPIC_API_KEY

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Keep in sync with POSITIONS in src/App.jsx
const POSITION_TYPES = [
  "media_buyer", "copywriter", "automatizador", "estratega",
  "asistente_virtual", "project_manager", "estratega_creativo",
  "creativo_editor", "redes_sociales", "otro",
];

// ── Prompts ──────────────────────────────────────────────────────────────────

function buildJobPrompt(text) {
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

function buildExercisePrompt(text) {
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

function buildResponsePrompt(text) {
  return `Eres un asistente que reformatea las respuestas a ejercicios de procesos de selección subidas en castellano por el candidato. No eres un editor: tu misión es PRESERVAR EL CONTENIDO y solo darle formato Markdown limpio.

DOCUMENTO PROPORCIONADO POR EL CANDIDATO:
"""
${text.slice(0, 15000)}
"""

TAREA: Devuelve el contenido de este documento en formato Markdown estructurado, respetando el significado literal. NO añadas contenido que no esté, NO resumas, NO omitas, NO corrijas las ideas del candidato.

REGLAS:

1. **Respeta el texto original.** Si el candidato escribe "pinzeladas" o da una opinión, la dejas tal cual. No es tu tarea corregirle faltas de ortografía ni reestructurar su argumento — solo dar formato.

2. **Detecta y aplica estructura:**
   - Títulos de sección (por jerarquía visual en el documento) → \`## Título\` o \`### Subtítulo\`
   - Listas con guiones, asteriscos o números → \`- bullet\` o \`1. item\`
   - Negritas del documento original (ej. del .docx) → \`**texto**\`
   - Cursivas del documento original → \`_texto_\`
   - Párrafos separados por línea en blanco
   - Citas o bloques destacados → \`> cita\`

3. **Conserva emojis, cifras, fechas y nombres propios** tal cual aparecen.

4. **No generes preguntas ni meta-comentarios** tipo "El candidato dice…" o "Esta respuesta…". Solo devuelve el contenido formateado.

5. **Si el documento es solo texto plano sin estructura discernible**, devuélvelo con párrafos separados por líneas en blanco y sin forzar listas o títulos inventados.

6. **Formato de salida:** solo el Markdown, sin envolverlo en triple backticks, sin prefacios.

Devuelve ÚNICAMENTE el Markdown de la respuesta del candidato.`;
}

function buildCriteriaPrompt(text) {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

async function callClaude(prompt, maxTokens) {
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: maxTokens,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = message.content?.[0]?.text?.trim() || "";
  try { return JSON.parse(raw); }
  catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("La IA devolvió una respuesta que no pude parsear como JSON.");
    return JSON.parse(match[0]);
  }
}

function normalizeCriteria(arr, fallback) {
  return Array.isArray(arr) && arr.length > 0
    ? arr.map(c => ({
        area: c.area || "",
        indicators: c.indicators || "",
        maxScore: typeof c.maxScore === "number" ? c.maxScore : parseInt(c.maxScore) || 5,
      }))
    : fallback;
}

// ── Action handlers ──────────────────────────────────────────────────────────

async function parseJob(text, res) {
  const parsed = await callClaude(buildJobPrompt(text), 3000);
  if (Array.isArray(parsed.exercises)) {
    parsed.exercises = parsed.exercises.map((ex, idx) => ({
      id: Date.now() + idx,
      title: ex.title || `Ejercicio ${idx + 1}`,
      description: ex.description || "",
      criteria: normalizeCriteria(ex.criteria, [{ area: "Calidad general", indicators: "Revisión global del ejercicio", maxScore: 5 }]),
    }));
  } else {
    parsed.exercises = [];
  }
  return res.status(200).json({ job: parsed });
}

async function parseExercise(text, res) {
  const parsed = await callClaude(buildExercisePrompt(text), 2500);
  if (parsed.error) return res.status(200).json({ error: parsed.error });
  const criteria = normalizeCriteria(parsed.criteria, [{ area: "Calidad general", indicators: "Revisión global del ejercicio", maxScore: 5 }]);
  return res.status(200).json({
    exercise: {
      title: parsed.title || "Ejercicio",
      description: parsed.description || "",
      criteria,
    },
  });
}

async function parseResponse(text, res) {
  // For pure reformatting we skip the JSON wrapping step — the model returns
  // raw Markdown. Keep the roundtrip simple and tolerant: strip stray code
  // fences the model might add even with the instructions saying otherwise.
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4000,
    messages: [{ role: "user", content: buildResponsePrompt(text) }],
  });
  let md = (message.content?.[0]?.text || "").trim();
  if (md.startsWith("```")) {
    md = md.replace(/^```(?:markdown|md)?\s*/i, "").replace(/```\s*$/, "").trim();
  }
  if (!md) return res.status(200).json({ error: "No se pudo extraer contenido del documento." });
  return res.status(200).json({ response: md });
}

async function parseCriteria(text, res) {
  const parsed = await callClaude(buildCriteriaPrompt(text), 2000);
  if (parsed.error) return res.status(200).json({ error: parsed.error });
  const criteria = normalizeCriteria(parsed.criteria, []);
  if (criteria.length === 0) return res.status(200).json({ error: "No se detectaron criterios en el documento." });
  return res.status(200).json({ criteria });
}

// ── Router ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "ANTHROPIC_API_KEY no configurada." });

  const { action, text } = req.body || {};
  if (!text || typeof text !== "string" || text.trim().length < 30) {
    return res.status(400).json({ error: "El documento no contiene suficiente texto." });
  }

  try {
    if (action === "job") {
      if (text.trim().length < 50) return res.status(400).json({ error: "El documento no contiene suficiente texto (mínimo 50 caracteres)." });
      return await parseJob(text, res);
    }
    if (action === "exercise") {
      if (text.trim().length < 50) return res.status(400).json({ error: "El documento no contiene suficiente texto (mínimo 50 caracteres)." });
      return await parseExercise(text, res);
    }
    if (action === "criteria") {
      return await parseCriteria(text, res);
    }
    if (action === "response") {
      return await parseResponse(text, res);
    }
    return res.status(400).json({ error: `Unknown action: ${action}. Use "job" | "exercise" | "criteria" | "response".` });
  } catch (err) {
    console.error(`parse/${action} error:`, err);
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}

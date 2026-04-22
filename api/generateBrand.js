// api/generateBrand.js
//
// Generates a complete brand manual from 8 conversational answers using Claude.
// Output structure is modeled after real agency brand manuals (Rumbo Eficiente,
// Proelia Digital) so the generated document can serve both as:
//   1. Internal culture reference (downloadable .docx for the user)
//   2. Context for RecruitAI's candidate evaluation IA (used as brandManual)
//
// Required Vercel env var: ANTHROPIC_API_KEY

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt({ answers, agencyName }) {
  const { history, whatYouDo, differentiator, values, idealClient, tone, redFlags, idealProfile } = answers;
  const name = (agencyName || "la agencia").trim();

  return `Eres un consultor senior de branding con 15+ años de experiencia creando manuales de marca para agencias digitales.

Tu tarea es redactar un **manual de marca completo** para "${name}". Este manual tiene doble propósito:
1. Documento interno que la agencia usará con su equipo y fichajes nuevos.
2. Contexto cultural que una IA usará para evaluar la compatibilidad de candidatos en procesos de selección.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFORMACIÓN QUE HA APORTADO EL FUNDADOR
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1. Historia y por qué existe la agencia]
${history || "(No proporcionado — infiérelo si puedes, si no omite la sección de historia.)"}

[2. Qué hace la agencia, para quién, y qué consiguen]
${whatYouDo || "(No proporcionado.)"}

[3. Qué la hace diferente de otras agencias parecidas]
${differentiator || "(No proporcionado.)"}

[4. Valores innegociables del equipo]
${values || "(No proporcionado.)"}

[5. Cliente ideal]
${idealClient || "(No proporcionado.)"}

[6. Tono de comunicación + ejemplo]
${tone || "(No proporcionado.)"}

[7. Red flags culturales en fichajes]
${redFlags || "(No proporcionado.)"}

[8. Perfil de persona que encaja en el equipo]
${idealProfile || "(No proporcionado.)"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTRUCTURA OBLIGATORIA DEL MANUAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Genera el manual con EXACTAMENTE estas secciones, cada una como encabezado \`## \` en Markdown:

## Qué es ${name}
(3-5 frases narrativas describiendo la agencia. Tono cálido, seguro, de fundador hablando.)

## Arquetipo de marca
(Identifica UN arquetipo claro: Héroe, Explorador, Sabio, Rebelde, Creador, Amante, Mago, Bufón, Cuidador, Gobernante, Inocente, Hombre Común. Justifícalo en 2-3 frases. Lista 6-8 atributos clave separados por espacios.)

## Personalidad de marca
(Dónde se sitúa en estos espectros: informal↔formal, moderna↔clásica, cercana↔exclusiva, enérgica↔reflexiva. Justifica brevemente.)

## Misión y propósito
(**Qué:** 1 frase — **Cómo:** 1 frase — **Por qué:** 1 frase. Formato: texto explicativo corto, no bullets.)

## Valores de marca
(Los 3-4 valores que el fundador mencionó, con 1-2 frases narrativas cada uno. Usa el mismo nombre del valor que él dio.)

## Propuesta de valor
(2-3 diferenciadores concretos, con evidencia o método detrás de cada uno si el fundador lo aportó.)

## Cliente ideal
(Descripción narrativa del buyer persona: qué hace, qué le preocupa, qué busca, qué transformación logra trabajando con la agencia. 2-3 párrafos.)

## Voz de marca
(4 adjetivos que definan la voz + 1 párrafo que explique el carácter general de cómo comunica la agencia.)

## Tono general
(4 descriptores del tono — ejemplos: Directo, Empático, Con foco, Inspirador — con 1 frase explicativa cada uno.)

## Cuando escribimos
(Lista de 5-7 reglas prácticas de escritura, tipo "Hablamos de tú", "Evitamos párrafos largos", etc. Extráelas del ejemplo de email del fundador si lo dio.)

## Universo verbal positivo
(Lista de 8-12 palabras que SÍ usamos + 4-6 frases/mantras que son obligatorios. Formato bullet.)

## Universo verbal negativo
(Lista de 6-10 palabras/expresiones que EVITAMOS + 4-6 fórmulas prohibidas. Formato bullet.)

## Líneas rojas
(3 reglas absolutamente innegociables en comunicación y conducta. Formato numerado.)

## Perfil de candidato ideal
(Soft skills, actitudes, mentalidad y nivel de experiencia que encajan en el equipo. Esta sección es CRÍTICA — la IA de selección la usará como referencia principal para evaluar a candidatos. Sé específico, no genérico. 2-3 párrafos.)

## Red flags en procesos de selección
(3-5 conductas o señales que justificarían descartar a un candidato o no renovar a un fichaje reciente. Basado en lo que aportó el fundador.)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REGLAS DE REDACCIÓN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Longitud: 1800-2500 palabras total.
- Tono: **narrativo, cálido, seguro**, como si el fundador estuviera explicándolo. Nada corporate, nada genérico, nada de clichés tipo "nuestra pasión es tu éxito".
- Usa la **primera persona del plural** ("nosotros hacemos...", "valoramos...", "buscamos..."). Excepciones: historia personal del fundador si aparece, puede ir en primera persona singular.
- Cuando el fundador haya usado ejemplos concretos, frases específicas o palabras distintivas, **incorpóralas textualmente** — es lo que le da voz al manual.
- Evita tecnicismos innecesarios y anglicismos salvo los imprescindibles del sector.
- Si una sección no tiene información suficiente del fundador para rellenarla con rigor, escribe un placeholder corto y honesto del tipo: *"(Pendiente de definir con el equipo fundador)"*. Prefiero secciones honestas a inventadas.
- Formato: **Markdown puro**. Títulos con \`## \`, bullets con \`- \`, negrita con \`**...**\`. NO uses \`# \` (el título principal lo añade el sistema).
- NO incluyas introducción meta tipo "Aquí está el manual" ni cierre tipo "Espero que te sirva". Empieza directamente por "## Qué es ${name}".

Genera el manual ahora.`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  try {
    const { answers, agencyName } = req.body || {};
    if (!answers || typeof answers !== "object") {
      return res.status(400).json({ error: "Missing or invalid 'answers' payload" });
    }

    // Enforce a minimum of substantive input — avoid wasting tokens on empty submissions
    const nonEmptyAnswers = Object.values(answers).filter(v => typeof v === "string" && v.trim().length > 10);
    if (nonEmptyAnswers.length < 3) {
      return res.status(400).json({ error: "Se necesitan al menos 3 respuestas con contenido mínimo (más de 10 caracteres cada una)." });
    }

    const prompt = buildPrompt({ answers, agencyName });

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4500,
      messages: [{ role: "user", content: prompt }],
    });

    const manual = message.content?.[0]?.text?.trim() || "";
    if (!manual) {
      return res.status(500).json({ error: "La IA no devolvió contenido. Inténtalo de nuevo." });
    }

    // Prepend a title so the generated doc has a clean H1.
    const fullManual = `# Manual de marca de ${(agencyName || "la agencia").trim()}\n\n${manual}`;

    return res.status(200).json({ manual: fullManual });
  } catch (err) {
    console.error("generateBrand error:", err);
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}

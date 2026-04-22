// api/generatePublishPost.js
//
// Generates ready-to-publish copy for multiple channels to promote a freshly-
// created process. Three channels in the MVP:
//   - linkedin         : long-form, narrative, 1500-2500 chars
//   - instagram_story  : punchy, 2-3 lines max, emoji-forward, implicit swipe-up
//   - email_internal   : subject + body for the recruiter to forward to their network
//
// Voice adapts to the recruiter's brand manual (if present) so the generated
// copy isn't generic corporate — feels like the agency speaking.
//
// Required Vercel env var: ANTHROPIC_API_KEY

import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildPrompt({ process: proc, brandManual, publicUrl, recruiterName }) {
  const p = proc || {};
  const c = p.company || {};
  const pos = p.position || {};
  const positionLabel = pos.customTitle || [pos.positionType, pos.specialty].filter(Boolean).join(" — ") || "Posición abierta";
  const salary = c.salaryMin && c.salaryMax
    ? `${Number(c.salaryMin).toLocaleString()}–${Number(c.salaryMax).toLocaleString()} ${c.currency || "EUR"}/año`
    : "";

  return `Eres un copywriter especializado en employer branding. Vas a redactar 3 piezas de copy para promocionar una oferta de trabajo, una por canal. El reclutador es ${recruiterName || "parte del equipo"}.

${brandManual ? `MANUAL DE MARCA / VOZ DE LA AGENCIA (úsalo para inspirar el tono):
${brandManual.slice(0, 3500)}

` : ""}DATOS DEL PUESTO:
- Empresa: ${c.name || "—"}
- Descripción empresa: ${c.description || "—"}
- Sector: ${c.sector || "—"}
- Ubicación: ${c.location || "—"} · Modalidad: ${c.modality || "—"}
- Puesto: ${positionLabel}
- Responsabilidades: ${pos.responsibilities || "—"}
- Habilidades: ${pos.skills || "—"}
- Experiencia: ${pos.experience ? `${pos.experience} años` : "—"}
- Contrato: ${pos.contract || "—"}
- Horas: ${pos.hoursPerWeek ? `${pos.hoursPerWeek}h/sem` : "—"} (${pos.schedule || "—"})
${salary ? `- Salario: ${salary}` : ""}
${pos.benefits ? `- Beneficios: ${pos.benefits}` : ""}

LINK PÚBLICO DE APLICACIÓN: ${publicUrl || "(pendiente de generar)"}

TAREA: redacta 3 versiones de copy en castellano. Devuelve ÚNICAMENTE este JSON (sin markdown):

{
  "linkedin": {
    "text": "..."
  },
  "instagram_story": {
    "text": "..."
  },
  "email_internal": {
    "subject": "...",
    "body": "..."
  }
}

REGLAS POR CANAL:

### linkedin.text
- 1500-2500 caracteres.
- Estructura: hook (1 frase corta) + párrafo explicando qué busca la empresa y qué ofrece + qué tipo de perfil encaja + el plus diferencial + CTA con el link + 3-5 hashtags al final.
- Usa saltos de línea dobles entre párrafos (sintaxis: \\n\\n).
- Tono: profesional pero humano, primera persona ("Estamos buscando...", "Ofrecemos..."). Evita clichés tipo "únete a nuestro equipo ganador" o "buscamos talento".
- Si hay manual de marca, alinéate con su voz.
- **Deja una línea para @empresa (mencionar la página corporativa en LinkedIn).** Si conoces el nombre exacto de la empresa, formatea como: "Estamos en @${c.name || "la empresa"}" donde el reclutador luego sustituirá @ por la mención real.

### instagram_story.text
- Muy corto: 2-3 líneas máximo, ~200 caracteres.
- Emoji-forward pero no exagerado (2-3 emojis).
- Hook + qué puesto + CTA implícito (ej. "link en bio").
- Sin hashtags (no caben bien en stories).
- Línea final con el CTA corto: "👆 Desliza" o "🔗 Link en bio".

### email_internal.subject
- 40-60 caracteres.
- Directo, específico. Ej: "¿Conoces a un Copywriter que quiera trabajar con nosotros?"

### email_internal.body
- 600-1200 caracteres.
- Estilo conversacional, como si escribieras a amigos/contactos cercanos.
- Empezar con "Hola," o similar.
- Explicar brevemente el puesto + qué tipo de persona buscan + por qué su recomendación vale oro.
- CTA claro con el link: "Si conoces a alguien, compárteselo: [LINK]".
- Firma con el nombre del reclutador si está disponible.

NO inventes beneficios, salarios o información que no esté en los datos. Si falta un dato importante (ej. responsabilidades vacías), escribe algo más genérico pero honesto.`;
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
    const { process: proc, brandManual, publicUrl, recruiterName } = req.body || {};
    if (!proc || typeof proc !== "object") {
      return res.status(400).json({ error: "Falta el objeto 'process' con los datos del puesto." });
    }

    const message = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      messages: [{ role: "user", content: buildPrompt({ process: proc, brandManual, publicUrl, recruiterName }) }],
    });

    const raw = message.content?.[0]?.text?.trim() || "";
    let posts;
    try {
      posts = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("La IA devolvió una respuesta que no pude parsear como JSON.");
      posts = JSON.parse(match[0]);
    }

    return res.status(200).json({ posts });
  } catch (err) {
    console.error("generatePublishPost error:", err);
    return res.status(500).json({ error: err.message || "Error interno del servidor" });
  }
}

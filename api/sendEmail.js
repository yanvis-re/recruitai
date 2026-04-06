import { Resend } from "resend";
import nodemailer from "nodemailer";

// ── Email templates ──────────────────────────────────────────────────────────

function templateApplicationReceived({ candidateName, companyName, positionTitle }) {
  return {
    subject: `Hemos recibido tu solicitud – ${positionTitle}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#1e40af;padding:32px;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:22px">${companyName}</h1></div>
      <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
        <p style="font-size:16px">Hola <strong>${candidateName}</strong>,</p>
        <p style="font-size:15px;line-height:1.6">Hemos recibido tu solicitud para el puesto de <strong>${positionTitle}</strong>. Nuestro equipo la revisará y te contactaremos en los próximos días con los siguientes pasos.</p>
        <p style="font-size:15px;line-height:1.6">Gracias por tu interés en formar parte de <strong>${companyName}</strong>.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
        <p style="font-size:13px;color:#6b7280">Este es un mensaje automático. Por favor no respondas a este correo.</p>
      </div></div>`,
  };
}

function templateNewApplicationAlert({ candidateName, positionTitle, recruiterName }) {
  return {
    subject: `🔔 Nueva solicitud – ${positionTitle}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#1e40af;padding:32px;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:22px">RecruitAI</h1></div>
      <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
        <p style="font-size:16px">Hola <strong>${recruiterName}</strong>,</p>
        <p style="font-size:15px;line-height:1.6">Has recibido una nueva solicitud para el puesto de <strong>${positionTitle}</strong>.</p>
        <div style="background:white;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:20px 0">
          <p style="margin:0;font-size:14px;color:#374151"><strong>Candidato:</strong> ${candidateName}</p>
          <p style="margin:8px 0 0;font-size:14px;color:#374151"><strong>Puesto:</strong> ${positionTitle}</p>
        </div>
        <p style="font-size:15px">Accede a RecruitAI para revisar la solicitud.</p>
      </div></div>`,
  };
}

function templateDecisionContratado({ candidateName, companyName, positionTitle }) {
  return {
    subject: `¡Enhorabuena! Oferta de trabajo – ${positionTitle}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#16a34a;padding:32px;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:22px">${companyName}</h1></div>
      <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
        <p style="font-size:16px">Hola <strong>${candidateName}</strong>,</p>
        <p style="font-size:15px;line-height:1.6">Es un placer comunicarte que hemos decidido hacerte una oferta para unirte al equipo de <strong>${companyName}</strong> como <strong>${positionTitle}</strong>. 🎉</p>
        <p style="font-size:15px;line-height:1.6">Nos pondremos en contacto contigo muy pronto para darte todos los detalles.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
        <p style="font-size:13px;color:#6b7280">Este es un mensaje automático. Por favor no respondas a este correo.</p>
      </div></div>`,
  };
}

function templateDecisionSegundaEntrevista({ candidateName, companyName, positionTitle }) {
  return {
    subject: `Siguiente paso en tu proceso – ${positionTitle}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#1e40af;padding:32px;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:22px">${companyName}</h1></div>
      <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
        <p style="font-size:16px">Hola <strong>${candidateName}</strong>,</p>
        <p style="font-size:15px;line-height:1.6">Tras revisar tu candidatura para <strong>${positionTitle}</strong>, nos gustaría avanzar contigo a una segunda entrevista.</p>
        <p style="font-size:15px;line-height:1.6">En breve te contactaremos para coordinar fecha y hora. ¡Gracias por tu dedicación!</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
        <p style="font-size:13px;color:#6b7280">Este es un mensaje automático. Por favor no respondas a este correo.</p>
      </div></div>`,
  };
}

function templateDecisionEnCartera({ candidateName, companyName, positionTitle }) {
  return {
    subject: `Tu candidatura en ${companyName} – ${positionTitle}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#7c3aed;padding:32px;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:22px">${companyName}</h1></div>
      <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
        <p style="font-size:16px">Hola <strong>${candidateName}</strong>,</p>
        <p style="font-size:15px;line-height:1.6">Gracias por participar en nuestro proceso de selección para <strong>${positionTitle}</strong>.</p>
        <p style="font-size:15px;line-height:1.6">En este momento no podemos avanzar, pero tu perfil nos ha parecido muy interesante y lo mantendremos en nuestra base de talento. Si surge una oportunidad, te contactaremos.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
        <p style="font-size:13px;color:#6b7280">Este es un mensaje automático. Por favor no respondas a este correo.</p>
      </div></div>`,
  };
}

function templateDecisionDescartado({ candidateName, companyName, positionTitle }) {
  return {
    subject: `Actualización sobre tu candidatura – ${positionTitle}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#374151;padding:32px;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:22px">${companyName}</h1></div>
      <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
        <p style="font-size:16px">Hola <strong>${candidateName}</strong>,</p>
        <p style="font-size:15px;line-height:1.6">Gracias por tu interés en el puesto de <strong>${positionTitle}</strong> en <strong>${companyName}</strong> y por el tiempo invertido en el proceso.</p>
        <p style="font-size:15px;line-height:1.6">Tras valorar todas las candidaturas, hemos decidido continuar con otros perfiles que encajan mejor con las necesidades actuales. Te deseamos mucho éxito en tu búsqueda.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
        <p style="font-size:13px;color:#6b7280">Este es un mensaje automático. Por favor no respondas a este correo.</p>
      </div></div>`,
  };
}

function templateTest({ companyName }) {
  return {
    subject: `✅ Email de prueba – RecruitAI`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
      <div style="background:#1e40af;padding:32px;border-radius:12px 12px 0 0"><h1 style="color:white;margin:0;font-size:22px">RecruitAI</h1></div>
      <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb;border-top:none">
        <p style="font-size:16px">¡Funciona! ✅</p>
        <p style="font-size:15px;line-height:1.6">La configuración de email para <strong>${companyName}</strong> está correctamente configurada. Los emails automáticos a candidatos ya están activos.</p>
      </div></div>`,
  };
}

// ── Build sender config ──────────────────────────────────────────────────────

function getFromAddress(emailConfig) {
  const name = emailConfig.fromName || "Equipo de selección";
  // "app" provider: uses app-level Resend account (env var), shared Resend domain
  if (emailConfig.provider === "app") {
    const fromDomain = process.env.FROM_EMAIL || "onboarding@resend.dev";
    return `${name} <${fromDomain}>`;
  }
  if (emailConfig.provider === "resend_domain") return `${name} <${emailConfig.fromEmail}>`;
  // Legacy fallbacks
  if (emailConfig.provider === "gmail") return `${name} <${emailConfig.gmailUser}>`;
  if (emailConfig.provider === "resend_shared") return `${name} <onboarding@resend.dev>`;
  return null;
}

// ── Send via Resend ──────────────────────────────────────────────────────────

async function sendViaResend(apiKey, from, to, subject, html) {
  const resend = new Resend(apiKey);
  await resend.emails.send({ from, to, subject, html });
}

// ── Send via Gmail SMTP (legacy) ─────────────────────────────────────────────

async function sendViaGmail(emailConfig, to, subject, html) {
  const transporter = nodemailer.createTransporter({
    service: "gmail",
    auth: { user: emailConfig.gmailUser, pass: emailConfig.gmailAppPassword },
  });
  const from = getFromAddress(emailConfig);
  await transporter.sendMail({ from, to, subject, html });
}

// ── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, data, emailConfig } = req.body;
  const provider = emailConfig?.provider || "none";

  if (provider === "none") {
    return res.status(200).json({ success: false, error: "Email provider not configured" });
  }

  const TEMPLATE_MAP = {
    application_received: templateApplicationReceived,
    new_application_alert: templateNewApplicationAlert,
    decision_contratado: templateDecisionContratado,
    decision_segunda_entrevista: templateDecisionSegundaEntrevista,
    decision_en_cartera: templateDecisionEnCartera,
    decision_descartado: templateDecisionDescartado,
    test: templateTest,
  };

  const templateFn = TEMPLATE_MAP[type];
  if (!templateFn) return res.status(400).json({ error: `Unknown type: ${type}` });

  const template = templateFn(data);

  // Determine recipient
  const to = type === "new_application_alert" ? data.recruiterEmail : data.candidateEmail;
  if (!to) return res.status(200).json({ success: false, error: "No recipient email" });

  try {
    const from = getFromAddress(emailConfig);

    if (provider === "app") {
      // App-level Resend: uses RESEND_API_KEY env var (set by developer in Vercel)
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        return res.status(200).json({ success: false, error: "RESEND_API_KEY not set in Vercel env vars. Add it in Vercel → Settings → Environment Variables." });
      }
      await sendViaResend(apiKey, from, to, template.subject, template.html);

    } else if (provider === "resend_domain") {
      // User's own Resend account + custom domain
      const apiKey = emailConfig.resendApiKey;
      if (!apiKey) return res.status(200).json({ success: false, error: "Missing Resend API key" });
      await sendViaResend(apiKey, from, to, template.subject, template.html);

    } else if (provider === "resend_shared") {
      // Legacy: user's own Resend account, shared domain
      const apiKey = emailConfig.resendApiKey || process.env.RESEND_API_KEY;
      if (!apiKey) return res.status(200).json({ success: false, error: "Missing Resend API key" });
      await sendViaResend(apiKey, from, to, template.subject, template.html);

    } else if (provider === "gmail") {
      // Legacy Gmail support
      await sendViaGmail(emailConfig, to, template.subject, template.html);

    } else {
      return res.status(400).json({ error: `Unknown provider: ${provider}` });
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("sendEmail error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// api/admin/createInviteCode.js
//
// Admin-only: creates a new invite code. Accepts a custom code, or generates
// a short human-friendly one (RAI-XXXXXX, alphanumeric without O/I/0/1 to
// avoid reading errors when shared verbally).
//
// Body: { code?, maxUses?, expiresAt?, note? }
//   code:      optional custom code (otherwise auto-generated)
//   maxUses:   integer — -1 or null means unlimited. Default: unlimited.
//   expiresAt: ISO date string or null. Default: no expiration.
//   note:      free-text note for the admin (e.g. "Promo alumni abril 2026").

import admin from "firebase-admin";

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (raw) { try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); } catch (e) { console.error("firebase-admin init:", e.message); } }
}

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "yanvis@gmail.com";

async function requireAdmin(req, res) {
  if (!admin.apps.length) { res.status(500).json({ error: "service_unavailable" }); return null; }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) { res.status(401).json({ error: "Missing token" }); return null; }
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (decoded.email !== ADMIN_EMAIL) { res.status(403).json({ error: "Forbidden" }); return null; }
    return decoded;
  } catch { res.status(401).json({ error: "Invalid token" }); return null; }
}

// Alphabet without visually confusing characters (0/O, 1/I/L).
const SAFE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function generateCode() {
  let chunk = "";
  for (let i = 0; i < 6; i++) chunk += SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)];
  return `RAI-${chunk}`;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const decoded = await requireAdmin(req, res);
  if (!decoded) return;

  const { code: providedCode, maxUses, expiresAt, note } = req.body || {};

  try {
    const db = admin.firestore();

    // Resolve the code: either use provided (uppercased, sanitized) or generate.
    let code;
    if (providedCode) {
      code = String(providedCode).trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
      if (!code || code.length < 3) return res.status(400).json({ error: "Custom code must be at least 3 alphanumeric characters." });
      // Collision check
      const existing = await db.collection("inviteCodes").doc(code).get();
      if (existing.exists) return res.status(409).json({ error: "Code already exists" });
    } else {
      // Try a few random codes until one is free (collision extremely rare with 31^6 space)
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = generateCode();
        const ex = await db.collection("inviteCodes").doc(candidate).get();
        if (!ex.exists) { code = candidate; break; }
      }
      if (!code) return res.status(500).json({ error: "Failed to generate a unique code" });
    }

    const payload = {
      code,
      createdAt: new Date().toISOString(),
      createdBy: decoded.uid,
      createdByEmail: decoded.email,
      enabled: true,
      uses: 0,
      maxUses: typeof maxUses === "number" && maxUses > 0 ? maxUses : null,
      expiresAt: expiresAt || null,
      note: note || "",
      lastUsedAt: null,
    };

    await db.collection("inviteCodes").doc(code).set(payload);

    return res.status(200).json({ success: true, code: payload });
  } catch (err) {
    console.error("admin/createInviteCode error:", err);
    return res.status(500).json({ error: err.message });
  }
}

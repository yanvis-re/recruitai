// api/_quota.js
//
// Rate-limit / quota helper for AI evaluations. Called by /api/evaluate and
// /api/autoEvaluate right before hitting Claude so a single recruiter cannot
// drain the Anthropic budget (accidentally or otherwise).
//
// Model:
//   recruiters/{uid}.usage.{YYYY-MM}.aiEvaluations   // integer counter
//
// Limits reset on the 1st of each calendar month (UTC). A single env var
// FREE_AI_EVALUATIONS_PER_MONTH controls the cap across both endpoints;
// defaults to 50 if unset, which is ~≤$15/month of Claude Sonnet 4.6 at
// current pricing per our typical evaluation token footprint.
//
// The filename starts with an underscore so Vercel does NOT treat it as a
// standalone serverless function — it's a module imported by the real
// handlers. Keeps us at 11/12 functions on the Hobby plan.

import admin from "firebase-admin";

// Initialise once per container (same pattern as the other api/* files).
// Safe to call repeatedly — admin.apps.length guards the second init.
function ensureAdmin() {
  if (admin.apps.length) return true;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) return false;
  try { admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) }); return true; }
  catch (e) { console.error("firebase-admin init (quota):", e.message); return false; }
}

export const EVAL_LIMIT = parseInt(process.env.FREE_AI_EVALUATIONS_PER_MONTH || "50", 10);

function currentPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Atomically check the recruiter's monthly quota and reserve ONE slot.
 *
 * Returns:
 *   { ok: true,  used, limit, period }     → go ahead, counter incremented
 *   { ok: false, used, limit, period }     → over quota, do NOT call Claude
 *   { ok: true,  skipped: true, reason }   → quota was skipped (no admin SDK,
 *                                            no recruiterUid, or missing doc);
 *                                            fail-open so legacy paths keep working
 *
 * Safe to call multiple times per request — each call reserves one unit. If
 * you loop over N exercises, call it once per exercise (or pre-reserve N up
 * front). Current callers use one call per Claude completion.
 */
export async function reserveEvaluation(recruiterUid) {
  if (!recruiterUid) return { ok: true, skipped: true, reason: "no_uid" };
  if (!ensureAdmin()) return { ok: true, skipped: true, reason: "admin_sdk_unavailable" };

  const db = admin.firestore();
  const ref = db.collection("recruiters").doc(recruiterUid);
  const period = currentPeriod();
  const key = `usage.${period}.aiEvaluations`;

  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { ok: true, skipped: true, reason: "recruiter_doc_missing" };
      const used = snap.data()?.usage?.[period]?.aiEvaluations || 0;
      if (used >= EVAL_LIMIT) {
        return { ok: false, used, limit: EVAL_LIMIT, period };
      }
      // Dot-path update so we don't clobber sibling periods.
      tx.update(ref, { [key]: used + 1 });
      return { ok: true, used: used + 1, limit: EVAL_LIMIT, period };
    });
  } catch (e) {
    // Transactional failure (rare) — fail open so we don't block legitimate
    // users due to transient Firestore contention. Logged for observability.
    console.error("reserveEvaluation transaction failed:", e.message);
    return { ok: true, skipped: true, reason: "transaction_error" };
  }
}

/**
 * Read-only helper for UIs that want to show "X / 50 evaluations left".
 * Not called by the handlers themselves.
 */
export async function peekUsage(recruiterUid) {
  if (!recruiterUid || !ensureAdmin()) return { used: 0, limit: EVAL_LIMIT, period: currentPeriod() };
  const db = admin.firestore();
  const snap = await db.collection("recruiters").doc(recruiterUid).get();
  if (!snap.exists) return { used: 0, limit: EVAL_LIMIT, period: currentPeriod() };
  const period = currentPeriod();
  const used = snap.data()?.usage?.[period]?.aiEvaluations || 0;
  return { used, limit: EVAL_LIMIT, period };
}

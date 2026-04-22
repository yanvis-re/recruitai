import { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  auth, db, googleProvider,
  doc, getDoc, setDoc, collection, addDoc, getDocs,
  signInWithPopup, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile,
} from "./firebase.js";

// Spanish-friendly translations for the most common Firebase Auth error codes.
function translateAuthError(code) {
  const map = {
    "auth/email-already-in-use": "Este email ya está registrado. Inicia sesión o usa otro.",
    "auth/invalid-email": "El email no tiene un formato válido.",
    "auth/weak-password": "La contraseña es muy débil. Usa al menos 6 caracteres.",
    "auth/user-not-found": "No existe ninguna cuenta con este email.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/invalid-credential": "Email o contraseña incorrectos.",
    "auth/invalid-login-credentials": "Email o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos fallidos. Prueba en unos minutos o recupera tu contraseña.",
    "auth/network-request-failed": "Error de red. Revisa tu conexión.",
    "auth/operation-not-allowed": "Este método de autenticación no está habilitado. El admin debe activarlo en Firebase Console.",
    "auth/user-disabled": "Esta cuenta ha sido deshabilitada.",
    "auth/missing-password": "Introduce una contraseña.",
  };
  return map[code] || null;
}

// ─── AI evaluation (simulated fallback) ───────────────────────────────────────
function generateAIEvaluation(responses, jobData) {
  const evaluations = jobData.exercises.map((exercise) => {
    const resp = responses.find((r) => r.exerciseId === exercise.id);
    const text = resp?.response || "";
    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    const criteriaScores = exercise.criteria.map((criterion) => {
      let base = words > 300 ? 4 : words > 150 ? 3 : words > 60 ? 2 : 1;
      const score = Math.min(criterion.maxScore, base + Math.floor(Math.random() * 1.5));
      const comments = [
        `Respuesta sólida sobre "${criterion.area}" con argumentación clara y ejemplos relevantes.`,
        `Buen nivel en "${criterion.area}". Demuestra comprensión aunque podría profundizar más.`,
        `Respuesta básica en "${criterion.area}". Falta mayor desarrollo y especificidad.`,
        `Respuesta insuficiente en "${criterion.area}". No se abordan los indicadores clave.`,
      ];
      return { area: criterion.area, score, maxScore: criterion.maxScore, comment: comments[Math.max(0, Math.min(3, criterion.maxScore - score))] };
    });
    const total = criteriaScores.reduce((s, c) => s + c.score, 0);
    const maxTotal = criteriaScores.reduce((s, c) => s + c.maxScore, 0);
    return { exerciseId: exercise.id, exerciseTitle: exercise.title, criteriaScores, total, maxTotal, pct: Math.round((total / maxTotal) * 100) };
  });
  const overall = Math.round(evaluations.reduce((s, e) => s + e.pct, 0) / evaluations.length);
  let rec, summary;
  if (overall >= 78) { rec = "AVANZAR"; summary = "El candidato muestra un perfil técnico sólido y bien argumentado."; }
  else if (overall >= 55) { rec = "REVISAR"; summary = "El candidato presenta aspectos positivos pero también áreas de mejora."; }
  else { rec = "DESCARTAR"; summary = "El candidato no alcanza el nivel mínimo requerido."; }
  return { evaluations, overall, rec, summary };
}

function generateInterviewAnalysis(name) {
  return {
    transcript: [
      { who: "Reclutador", text: `Buenos días, ${name.split(" ")[0]}. ¿Puedes presentarte brevemente?` },
      { who: name, text: "Buenos días. Llevo 6 años en marketing digital, con los últimos 3 especializados en Paid Media." },
    ],
    candidate: { score: 84, strengths: ["Experiencia técnica sólida", "Pensamiento estratégico"], gaps: ["Podría profundizar más en gestión remota"], rec: "CONTRATAR", summary: `${name} demuestra un perfil técnico y estratégico muy sólido.` },
    recruiter: { score: 72, did_well: ["Preguntas bien estructuradas"], improve: ["Faltó explorar motivaciones intrínsecas"], tips: ["Incluir preguntas STAR", "Reservar 5 min para preguntas del candidato"] },
  };
}

function Badge({ type }) {
  const map = { AVANZAR: { cls: "bg-green-100 text-green-800", label: "✅ Avanzar" }, REVISAR: { cls: "bg-yellow-100 text-yellow-800", label: "⚠️ Revisar" }, DESCARTAR: { cls: "bg-red-100 text-red-800", label: "❌ Descartar" }, CONTRATAR: { cls: "bg-emerald-100 text-emerald-800", label: "🎉 Contratar" } };
  const c = map[type] || map.REVISAR;
  return <span className={`px-3 py-1 rounded-full text-xs font-semibold ${c.cls}`}>{c.label}</span>;
}

function ScoreDial({ score }) {
  const color = score >= 78 ? "text-green-600" : score >= 55 ? "text-yellow-600" : "text-red-500";
  return <div className={`text-4xl font-extrabold leading-none ${color}`}>{score}<span className="text-lg font-medium text-gray-400">%</span></div>;
}

function ProgressStepper({ current }) {
  const steps = [{ id: "setup", icon: "⚙️", label: "Configurar" }, { id: "preview", icon: "📢", label: "Publicar" }, { id: "apply", icon: "📝", label: "Aplicar" }, { id: "exercises", icon: "🎯", label: "Ejercicios" }, { id: "evaluation", icon: "🤖", label: "Evaluación" }, { id: "interview", icon: "🎤", label: "Entrevista" }, { id: "final", icon: "📊", label: "Análisis" }];
  const idx = steps.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center justify-center gap-0 px-4 py-3 bg-white border-b border-gray-100 overflow-x-auto">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div className="flex flex-col items-center">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${i < idx ? "bg-green-500 text-white" : i === idx ? "bg-gray-900 text-white shadow-md scale-110" : "bg-gray-100 text-gray-400"}`}>{i < idx ? "✓" : s.icon}</div>
            <span className="text-xs mt-1 hidden sm:block" style={{ color: i <= idx ? "#374151" : "#9CA3AF" }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className={`w-6 sm:w-10 h-0.5 mx-1 ${i < idx ? "bg-green-400" : "bg-gray-200"}`} />}
        </div>
      ))}
    </div>
  );
}

const inp = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 bg-white";
const lbl = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1";

const POSITIONS = [
  { id: "media_buyer", label: "Media Buyer", icon: "📊", specialties: [] },
  { id: "copywriter", label: "Copywriter", icon: "✍️", specialties: ["Web", "Email Marketing", "Redes Sociales", "Otros"] },
  { id: "automatizador", label: "Automatizador", icon: "⚙️", specialties: ["Email Marketing", "Marketing Conversacional"] },
  { id: "estratega", label: "Estratega / Funnel Builder", icon: "🎯", specialties: [] },
  { id: "asistente_virtual", label: "Asistente Virtual", icon: "🤝", specialties: ["Administración y Finanzas", "Gestión de Procesos", "Gestión de Agenda", "Otros"] },
  { id: "project_manager", label: "Project Manager", icon: "📋", specialties: [] },
  { id: "estratega_creativo", label: "Estratega Creativo", icon: "💡", specialties: [] },
  { id: "creativo_editor", label: "Creativo / Editor", icon: "🎨", specialties: [] },
  { id: "redes_sociales", label: "Redes Sociales", icon: "📱", specialties: ["Meta", "TikTok", "LinkedIn", "Otros"] },
  { id: "otro", label: "Otro / Personalizado", icon: "✏️", specialties: [] },
];

const SALARY_DATA = {
  media_buyer: { label: "Media Buyer / Paid Media", junior: [22000, 28000], mid: [28000, 40000], senior: [40000, 55000] },
  copywriter: { label: "Copywriter", junior: [20000, 25000], mid: [25000, 32000], senior: [32000, 42000] },
  automatizador: { label: "Automatizador (CRM/Email)", junior: [22000, 28000], mid: [28000, 38000], senior: [38000, 50000] },
  estratega: { label: "Estratega / Funnel Builder", junior: [24000, 30000], mid: [30000, 42000], senior: [42000, 58000] },
  asistente_virtual: { label: "Asistente Virtual", junior: [18000, 22000], mid: [22000, 30000], senior: [30000, 40000] },
  project_manager: { label: "Project Manager", junior: [28000, 35000], mid: [35000, 48000], senior: [48000, 65000] },
  estratega_creativo: { label: "Estratega Creativo", junior: [24000, 30000], mid: [30000, 42000], senior: [42000, 55000] },
  creativo_editor: { label: "Creativo / Editor", junior: [20000, 25000], mid: [25000, 33000], senior: [33000, 45000] },
  redes_sociales: { label: "Social Media Manager", junior: [20000, 26000], mid: [26000, 36000], senior: [36000, 50000] },
};

function SalaryWidget({ positionType, contract, onApplyRanges }) {
  const data = SALARY_DATA[positionType];
  if (!data) return null;
  const isFreelance = contract === "Freelance";
  const adj = isFreelance ? 1.18 : 1;
  const fmt = (v) => `€${Math.round(v / 1000)}K`;
  const tiers = [{ label: "Junior", key: "junior", exp: "0–2 años" }, { label: "Mid", key: "mid", exp: "2–5 años" }, { label: "Senior", key: "senior", exp: "5+ años" }];
  return (
    <div className="rounded-xl border-2 border-gray-100 bg-gradient-to-br from-gray-50 to-indigo-50 p-4 mt-3">
      <div className="flex items-start gap-2 mb-3">
        <span className="text-lg leading-none">💡</span>
        <div className="flex-1"><p className="text-sm font-bold text-gray-700 leading-none">Referencia salarial de mercado</p><p className="text-xs text-gray-900 mt-0.5">{data.label} · España 2026</p></div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {tiers.map(t => {
          const [lo, hi] = data[t.key].map(v => Math.round(v * adj));
          return (
            <div key={t.key} className="bg-white rounded-lg p-2.5 text-center border border-gray-100 shadow-sm">
              <p className="text-xs font-bold text-gray-500 mb-0.5">{t.label}</p>
              <p className="text-sm font-black text-gray-800">{fmt(lo)}–{fmt(hi)}</p>
              <p className="text-xs text-gray-400 mb-1.5">{t.exp}</p>
              <button type="button" onClick={() => onApplyRanges(lo, hi)} className="w-full text-xs bg-gray-50 hover:bg-gray-100 text-gray-900 font-semibold py-1 rounded-md transition-colors">Usar este rango</button>
            </div>
          );
        })}
      </div>
      {isFreelance && <p className="text-xs text-indigo-600 font-medium mb-2">📌 Tarifa freelance: +18% estimado sobre contrato directo</p>}
      <p className="text-xs text-gray-400">Fuente: ObservatorioRH 2026, Sayonara.es · Referencia orientativa para España</p>
    </div>
  );
}

function getPositionTitle(position) {
  if (!position) return "Posición";
  if (position.positionType === "otro") return position.customTitle || "Otro / Personalizado";
  const pos = POSITIONS.find(p => p.id === position.positionType);
  const base = pos ? pos.label : (position.positionType || "Posición");
  return position.specialty ? `${base} — ${position.specialty}` : base;
}

// Neutral defaults. NO hardcoded brand names — each recruiter starts clean
// and fills in their own agency info. A few safe, generic defaults are kept
// (position type, currency, hours, schedule, contract) because they're the
// most common choice — the recruiter can change them instantly if wrong.
const defaultJob = {
  company: { name: "", description: "", sector: "", location: "", modality: "Remoto", salaryMin: "", salaryMax: "", currency: "EUR" },
  position: { positionType: "media_buyer", specialty: "", customTitle: "", responsibilities: "", skills: "", experience: "3", contract: "Freelance", hoursPerWeek: "20", schedule: "Flexible", benefits: "" },
  exercises: [{ id: 1, title: "Ejercicio Práctico", description: "", criteria: [{ area: "Análisis y diagnóstico", indicators: "Capacidad de identificar el problema y proponer soluciones", maxScore: 5 }, { area: "Propuesta estratégica", indicators: "Coherencia y calidad de la propuesta", maxScore: 5 }] }],
  schedulingUrl: "",
};

// ─── Conversational process-creation flow (same DNA as OnboardingScreen) ─────
function RecruiterSetupScreen({ onPublish, onPublishAndShare, onBack }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(defaultJob);
  const [salaryApplied, setSalaryApplied] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Document-parsing state (for the "subir documento" start option)
  const [parseMode, setParseMode] = useState("choose"); // "choose" | "manual" | "upload" | "parsing" | "parsed"
  const [parseError, setParseError] = useState("");
  const [parsedFileName, setParsedFileName] = useState("");
  const parseFileRef = useRef(null);

  // Per-exercise document parsing state (exercises step only)
  const [exParseState, setExParseState] = useState("idle"); // "idle" | "parsing" | "preview" | "error"
  const [exParsePreview, setExParsePreview] = useState(null);
  const [exParseError, setExParseError] = useState("");
  const [exParseFileName, setExParseFileName] = useState("");
  const [exEditMode, setExEditMode] = useState(false); // toggle ajustes panel inside modal
  const [lastAddedName, setLastAddedName] = useState(""); // tiny success banner after accepting
  const exFileRef = useRef(null);

  // Per-exercise criteria upload state (attach rubric to an existing exercise)
  const [critParseTarget, setCritParseTarget] = useState(null); // { exerciseId, fileName, status, criteria?, error? }
  const critFileRefs = useRef({});

  const extractTextFromFile = async (file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "txt") return await file.text();
    if (ext === "docx") {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      return r.value;
    }
    if (ext === "pdf") {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
      const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      let t = "";
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const ct = await pg.getTextContent();
        t += ct.items.map(x => x.str).join(" ") + "\n";
      }
      return t;
    }
    throw new Error("Formato no soportado. Usa .txt, .docx o .pdf.");
  };

  const handleExerciseFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setExParseError(""); setExParsePreview(null); setExParseFileName(file.name); setExParseState("parsing");
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim() || text.trim().length < 50) throw new Error("El documento parece vacío o no tiene texto.");
      const res = await fetch("/api/parseExerciseDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (!json.exercise) throw new Error("La IA no devolvió un ejercicio válido.");
      setExParsePreview(json.exercise);
      setExParseState("preview");
    } catch (err) {
      setExParseError(err.message || "No se pudo analizar el documento.");
      setExParseState("error");
    }
  };

  const acceptParsedExercise = () => {
    if (!exParsePreview) return;
    const newExercise = {
      id: Date.now(),
      title: exParsePreview.title || `Ejercicio ${data.exercises.length + 1}`,
      description: exParsePreview.description || "",
      criteria: exParsePreview.criteria && exParsePreview.criteria.length > 0
        ? exParsePreview.criteria
        : [{ area: "", indicators: "", maxScore: 5 }],
    };
    // If the only existing exercise is the default empty one, replace it.
    const onlyDefault = data.exercises.length === 1
      && !data.exercises[0].description?.trim()
      && data.exercises[0].title === "Ejercicio Práctico";
    setData(d => ({
      ...d,
      exercises: onlyDefault ? [newExercise] : [...d.exercises, newExercise],
    }));
    setLastAddedName(newExercise.title);
    setExParseState("idle");
    setExParsePreview(null);
    setExParseFileName("");
    setExEditMode(false);
    setTimeout(() => setLastAddedName(""), 6000);
  };

  // Per-exercise criteria upload handler
  const handleCriteriaFile = async (exerciseId, file) => {
    if (!file) return;
    setCritParseTarget({ exerciseId, fileName: file.name, status: "parsing" });
    try {
      const text = await extractTextFromFile(file);
      if (!text.trim() || text.trim().length < 30) throw new Error("El documento parece vacío.");
      const res = await fetch("/api/parseCriteriaDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      if (!json.criteria || json.criteria.length === 0) throw new Error("No se detectaron criterios.");
      setCritParseTarget({ exerciseId, fileName: file.name, status: "preview", criteria: json.criteria });
    } catch (err) {
      setCritParseTarget({ exerciseId, fileName: file.name, status: "error", error: err.message });
    }
  };

  const applyCriteria = (mode /* "replace" | "append" */) => {
    if (!critParseTarget || !critParseTarget.criteria) return;
    const { exerciseId, criteria } = critParseTarget;
    setData(d => ({
      ...d,
      exercises: d.exercises.map(ex => {
        if (ex.id !== exerciseId) return ex;
        return {
          ...ex,
          criteria: mode === "replace"
            ? criteria
            : [...(ex.criteria || []).filter(c => c.area?.trim() || c.indicators?.trim()), ...criteria],
        };
      }),
    }));
    setCritParseTarget(null);
  };

  const handleParseFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setParseError(""); setParseMode("parsing"); setParsedFileName(file.name);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      let text = "";
      if (ext === "txt") text = await file.text();
      else if (ext === "docx") {
        const mammoth = await import("mammoth");
        const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        text = r.value;
      } else if (ext === "pdf") {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        for (let i = 1; i <= pdf.numPages; i++) {
          const pg = await pdf.getPage(i);
          const ct = await pg.getTextContent();
          text += ct.items.map(x => x.str).join(" ") + "\n";
        }
      } else {
        throw new Error("Formato no soportado. Usa .txt, .docx o .pdf.");
      }
      if (!text.trim() || text.trim().length < 50) {
        throw new Error("El documento parece vacío o no contiene texto legible.");
      }
      const res = await fetch("/api/parseJobDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Error desconocido al analizar.");
      // Merge AI output into state, keeping defaults for any field the AI left empty.
      const ai = json.job || {};
      setData(d => ({
        ...d,
        company: { ...d.company, ...(ai.company || {}) },
        position: { ...d.position, ...(ai.position || {}) },
        exercises: Array.isArray(ai.exercises) && ai.exercises.length > 0 ? ai.exercises : d.exercises,
      }));
      setParseMode("parsed");
    } catch (err) {
      setParseError(err.message || "No se pudo analizar el documento.");
      setParseMode("upload");
    }
  };

  // Has the user touched anything beyond the defaults? If yes, confirm on exit.
  const hasProgress = () => {
    if (step > 0) return true;
    const c = data.company, p = data.position;
    return !!(c.name || c.description || c.sector || c.location || c.salaryMin || c.salaryMax
      || p.responsibilities || p.skills || p.customTitle || p.benefits
      || (data.schedulingUrl && data.schedulingUrl.trim())
      || (data.exercises.length > 1)
      || (data.exercises[0]?.description && data.exercises[0].description.trim()));
  };
  const attemptExit = () => {
    if (hasProgress()) setShowExitConfirm(true);
    else onBack();
  };
  const upC = (f, v) => setData(d => ({ ...d, company: { ...d.company, [f]: v } }));
  const upP = (f, v) => setData(d => ({ ...d, position: { ...d.position, [f]: v } }));
  const upTop = (f, v) => setData(d => ({ ...d, [f]: v }));
  const applySalary = (lo, hi) => { upC("salaryMin", String(lo)); upC("salaryMax", String(hi)); setSalaryApplied(true); setTimeout(() => setSalaryApplied(false), 3000); };
  const addEx = () => setData(d => ({ ...d, exercises: [...d.exercises, { id: Date.now(), title: `Ejercicio ${d.exercises.length + 1}`, description: "", criteria: [{ area: "", indicators: "", maxScore: 5 }] }] }));
  const delEx = (id) => setData(d => ({ ...d, exercises: d.exercises.filter(e => e.id !== id) }));
  const upEx = (id, f, v) => setData(d => ({ ...d, exercises: d.exercises.map(e => e.id === id ? { ...e, [f]: v } : e) }));
  const addCr = (eid) => setData(d => ({ ...d, exercises: d.exercises.map(e => e.id === eid ? { ...e, criteria: [...e.criteria, { area: "", indicators: "", maxScore: 5 }] } : e) }));
  const delCr = (eid, i) => setData(d => ({ ...d, exercises: d.exercises.map(e => e.id === eid ? { ...e, criteria: e.criteria.filter((_, j) => j !== i) } : e) }));
  const upCr = (eid, i, f, v) => setData(d => ({ ...d, exercises: d.exercises.map(e => e.id === eid ? { ...e, criteria: e.criteria.map((c, j) => j === i ? { ...c, [f]: v } : c) } : e) }));

  // Linear flow: intro (not counted) + 7 numbered sections
  const FLOW = [
    { id: "intro" },
    { id: "company",           section: "🏢 Empresa",   n: 1, total: 7 },
    { id: "position_type",     section: "👤 Posición",  n: 2, total: 7 },
    { id: "position_details",  section: "👤 Posición",  n: 3, total: 7 },
    { id: "position_contract", section: "👤 Posición",  n: 4, total: 7 },
    { id: "scheduling",        section: "🗓 Agenda",     n: 5, total: 7 },
    { id: "exercises",         section: "🎯 Ejercicios", n: 6, total: 7 },
    { id: "review",            section: "✅ Revisión",    n: 7, total: 7 },
  ];
  const current = FLOW[step];

  const canAdvance = (() => {
    switch (current.id) {
      case "intro": return parseMode === "manual" || parseMode === "parsed";
      case "company": return !!data.company.name.trim();
      case "position_type":
        return !!data.position.positionType
          && (data.position.positionType !== "otro" || !!(data.position.customTitle || "").trim());
      case "position_details": return true;
      case "position_contract": return !!data.position.contract;
      case "scheduling": return true;
      case "exercises":
        return data.exercises.length > 0
          && data.exercises.every(e => e.title.trim().length > 0 && e.description.trim().length >= 10);
      case "review": return true;
      default: return true;
    }
  })();

  const next = () => setStep(s => Math.min(s + 1, FLOW.length - 1));
  const back = () => setStep(s => Math.max(0, s - 1));
  const jumpTo = (id) => { const i = FLOW.findIndex(f => f.id === id); if (i >= 0) setStep(i); };

  // ── Shared card primitive for option grids (same DNA as onboarding) ────────
  const OptionCard = ({ selected, onClick, icon, title, subtitle, compact }) => (
    <button type="button" onClick={onClick}
      className={`w-full text-left rounded-2xl border-2 transition-all ${compact ? "p-3" : "p-4"} ${
        selected ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white hover:border-gray-400"
      }`}>
      <div className="flex items-start gap-2.5">
        {icon && <div className={compact ? "text-lg shrink-0" : "text-xl shrink-0"}>{icon}</div>}
        <div className="flex-1 min-w-0">
          <p className={`font-bold ${compact ? "text-xs" : "text-sm"} ${selected ? "text-white" : "text-gray-900"}`}>{title}</p>
          {subtitle && <p className={`${compact ? "text-[11px]" : "text-xs"} mt-0.5 leading-snug ${selected ? "text-white/80" : "text-gray-500"}`}>{subtitle}</p>}
        </div>
      </div>
    </button>
  );

  const renderQuestion = () => {
    switch (current.id) {
      case "intro":
        return (
          <div className="space-y-5">
            <div className="text-center">
              <div className="text-6xl mb-4">📝</div>
              <h2 className="text-3xl font-black text-gray-900 tracking-tight">Vamos a crear un nuevo proceso</h2>
              <p className="text-gray-500 mt-3 leading-relaxed">
                Puedes empezar desde cero (te guío paso a paso, ~5 min) o subir un documento existente y la IA te pre-rellena los campos.
              </p>
            </div>

            {parseMode === "parsed" && (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex items-start gap-3">
                <div className="text-2xl shrink-0">✅</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-green-800">Documento analizado</p>
                  <p className="text-xs text-green-700 mt-0.5">
                    {parsedFileName} · revisa los datos pre-rellenados en los siguientes pasos y ajusta lo que haga falta.
                  </p>
                </div>
              </div>
            )}

            {parseMode === "parsing" && (
              <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6 flex items-center justify-center gap-3">
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                <span className="text-sm text-gray-600">Analizando documento con IA...</span>
              </div>
            )}

            {parseMode === "choose" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button type="button" onClick={() => setParseMode("manual")}
                  className="rounded-2xl border-2 border-gray-200 bg-white p-5 text-left hover:border-gray-400 transition-all">
                  <div className="text-3xl mb-2">✏️</div>
                  <p className="font-bold text-gray-900">Crear desde cero</p>
                  <p className="text-xs text-gray-500 mt-1 leading-snug">Te hago preguntas paso a paso. Control total sobre cada campo.</p>
                </button>
                <button type="button" onClick={() => setParseMode("upload")}
                  className="rounded-2xl border-2 border-gray-200 bg-white p-5 text-left hover:border-gray-400 transition-all">
                  <div className="text-3xl mb-2">📄</div>
                  <p className="font-bold text-gray-900">Subir documento <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded ml-1 align-middle">Nuevo</span></p>
                  <p className="text-xs text-gray-500 mt-1 leading-snug">Pega o sube un PDF/DOCX con la oferta. La IA rellena los campos.</p>
                </button>
              </div>
            )}

            {parseMode === "upload" && (
              <div className="space-y-3">
                <div onClick={() => parseFileRef.current?.click()}
                  className="border-2 border-dashed border-gray-300 rounded-2xl p-8 text-center cursor-pointer hover:border-gray-900 hover:bg-gray-50 transition-all">
                  <p className="text-3xl mb-2">📁</p>
                  <p className="text-sm font-medium text-gray-700">Haz clic para seleccionar archivo</p>
                  <p className="text-xs text-gray-400 mt-1">Formatos: .pdf · .docx · .txt</p>
                </div>
                <input ref={parseFileRef} type="file" accept=".pdf,.docx,.txt" onChange={handleParseFile} className="hidden" />
                {parseError && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{parseError}</div>
                )}
                <button type="button" onClick={() => { setParseMode("choose"); setParseError(""); }}
                  className="w-full text-xs text-gray-500 hover:text-gray-900 py-2">
                  ← Volver
                </button>
              </div>
            )}
          </div>
        );

      case "company":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Cuéntame sobre la empresa contratadora</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">Los datos básicos. El candidato verá esta información en la oferta pública.</p>
            <div className="space-y-4">
              <div>
                <label className={lbl}>Nombre de la empresa *</label>
                <input className={inp} value={data.company.name} onChange={e => upC("name", e.target.value)} placeholder="Nombre de tu agencia" />
              </div>
              <div>
                <label className={lbl}>Descripción corta</label>
                <MarkdownEditor
                  value={data.company.description}
                  onChange={v => upC("description", v)}
                  rows={4}
                  small
                  allowHeadings={false}
                  placeholder="Agencia de paid media especializada en infoproductos. Trabajamos con..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={lbl}>Sector</label><input className={inp} value={data.company.sector} onChange={e => upC("sector", e.target.value)} placeholder="Marketing digital" /></div>
                <div><label className={lbl}>Ubicación</label><input className={inp} value={data.company.location} onChange={e => upC("location", e.target.value)} placeholder="Madrid / Remoto" /></div>
              </div>
              <div>
                <label className={lbl}>Modalidad de trabajo</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {[["Remoto", "🏠"], ["Presencial", "🏢"], ["Híbrido", "🔀"]].map(([m, ic]) => (
                    <OptionCard key={m} compact icon={ic} title={m}
                      selected={data.company.modality === m}
                      onClick={() => upC("modality", m)} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        );

      case "position_type": {
        const pos = POSITIONS.find(p => p.id === data.position.positionType);
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">¿Qué tipo de posición buscas?</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">Elige el perfil base. Adaptaré los siguientes pasos y la referencia salarial al rol que elijas.</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {POSITIONS.map(p => (
                <OptionCard key={p.id} compact icon={p.icon} title={p.label}
                  selected={data.position.positionType === p.id}
                  onClick={() => { upP("positionType", p.id); upP("specialty", ""); }} />
              ))}
            </div>
            {pos && pos.specialties.length > 0 && (
              <div className="mt-5">
                <label className={lbl}>¿Alguna especialidad concreta?</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {pos.specialties.map(sp => (
                    <button key={sp} type="button"
                      onClick={() => upP("specialty", data.position.specialty === sp ? "" : sp)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${
                        data.position.specialty === sp ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600 hover:border-gray-400"
                      }`}>{sp}</button>
                  ))}
                </div>
              </div>
            )}
            {data.position.positionType === "otro" && (
              <div className="mt-5">
                <label className={lbl}>Nombre personalizado *</label>
                <input className={inp} value={data.position.customTitle || ""}
                  onChange={e => upP("customTitle", e.target.value)}
                  placeholder="ej. Growth Hacker, Head of CRM..." />
              </div>
            )}
          </div>
        );
      }

      case "position_details":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">¿Qué hará esta persona en el día a día?</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">Responsabilidades concretas y habilidades clave. Todo es opcional pero cuanto más detalles, mejor filtra la IA a los candidatos.</p>
            <div className="space-y-4">
              <div>
                <label className={lbl}>Responsabilidades principales</label>
                <MarkdownEditor
                  value={data.position.responsibilities}
                  onChange={v => upP("responsibilities", v)}
                  rows={6}
                  small
                  placeholder={`## Día a día\n- Liderar la estrategia de paid media de 3-5 cuentas\n- Gestión de campañas en Meta, Google y TikTok\n- Optimización semanal de ROAS\n\n## Reporting\n- Informes quincenales al cliente`} />
              </div>
              <div>
                <label className={lbl}>Habilidades requeridas</label>
                <textarea className={inp} rows={3} value={data.position.skills} onChange={e => upP("skills", e.target.value)}
                  placeholder="Meta Ads avanzado, Google Ads, TikTok Ads, Looker Studio, Zapier, Notion..." />
                <p className="text-xs text-gray-400 mt-1.5">Separa con comas. Aparecen como etiquetas en la oferta pública.</p>
              </div>
            </div>
          </div>
        );

      case "position_contract":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Condiciones del puesto</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">Tipo de relación, salario y modalidad horaria. La referencia salarial del mercado te la calculo al momento.</p>
            <div className="space-y-5">
              <div>
                <label className={lbl}>Tipo de relación contractual *</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {[["Freelance", "🤝"], ["Contrato directo", "📄"]].map(([val, icon]) => (
                    <OptionCard key={val} icon={icon} title={val}
                      selected={data.position.contract === val}
                      onClick={() => upP("contract", val)} />
                  ))}
                </div>
              </div>
              <SalaryWidget positionType={data.position.positionType} contract={data.position.contract} onApplyRanges={applySalary} />
              {salaryApplied && (
                <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 font-medium">
                  <span>✅</span> Rango aplicado
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div><label className={lbl}>Moneda</label>
                  <select className={inp} value={data.company.currency} onChange={e => upC("currency", e.target.value)}>
                    {["EUR", "USD", "GBP", "MXN"].map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                <div><label className={lbl}>Salario mín./año</label><input className={inp} type="number" value={data.company.salaryMin} onChange={e => upC("salaryMin", e.target.value)} /></div>
                <div><label className={lbl}>Salario máx./año</label><input className={inp} type="number" value={data.company.salaryMax} onChange={e => upC("salaryMax", e.target.value)} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Horas semanales</label>
                  <input className={inp} type="number" min={1} max={40}
                    value={data.position.hoursPerWeek}
                    onChange={e => upP("hoursPerWeek", Math.min(40, parseInt(e.target.value) || 0).toString())} />
                </div>
                <div>
                  <label className={lbl}>Años de experiencia</label>
                  <input className={inp} type="number" min={0} max={20} value={data.position.experience} onChange={e => upP("experience", e.target.value)} />
                </div>
              </div>
              <div>
                <label className={lbl}>Horario preferido</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {[["Mañanas", "🌅"], ["Tardes", "🌆"], ["Flexible", "🕐"]].map(([h, icon]) => (
                    <OptionCard key={h} compact icon={icon} title={h}
                      selected={data.position.schedule === h}
                      onClick={() => upP("schedule", h)} />
                  ))}
                </div>
              </div>
              <div>
                <label className={lbl}>Otros beneficios (opcional)</label>
                <MarkdownEditor
                  value={data.position.benefits}
                  onChange={v => upP("benefits", v)}
                  rows={4}
                  small
                  allowHeadings={false}
                  placeholder={`- Formación continua\n- 25 días de vacaciones\n- Material de oficina\n- Clases de inglés`} />
              </div>
            </div>
          </div>
        );

      case "scheduling":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">¿Tienes un link de agendamiento?</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">
              Cuando marques a un candidato como <strong>"Segunda entrevista"</strong> o <strong>"Contratado"</strong> en este proceso, el email incluirá un botón para que agende directamente contigo. Sin esto, el email avisa de que te pondrás en contacto manualmente.
            </p>
            <div>
              <label className={lbl}>URL de calendario (opcional)</label>
              <input
                className={inp}
                type="url"
                value={data.schedulingUrl || ""}
                onChange={e => upTop("schedulingUrl", e.target.value)}
                placeholder="https://cal.com/tu-usuario/entrevista"
              />
              <p className="text-xs text-gray-400 mt-2">Compatible con <strong>Cal.com, Calendly, TidyCal, SavvyCal, Google Appointments</strong> o cualquier URL pública.</p>
            </div>
            {data.schedulingUrl && (
              <a href={data.schedulingUrl} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-gray-900 hover:underline font-medium mt-3">
                🔗 Probar el link en nueva pestaña →
              </a>
            )}
          </div>
        );

      case "exercises":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Diseña los ejercicios prácticos</h2>
            <p className="text-gray-500 mb-5 leading-relaxed">
              Cada candidato resuelve estos ejercicios con respuesta escrita + vídeo de defensa en Loom. La IA los evalúa con los criterios que definas.
            </p>

            {/* Upload exercise from document — simple banner. Preview + confirm go in a modal */}
            <div className="border-2 border-dashed border-gray-200 rounded-2xl p-4 mb-3 bg-gray-50">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-start gap-2.5 flex-1 min-w-0">
                  <span className="text-xl shrink-0">📄</span>
                  <div>
                    <p className="text-sm font-bold text-gray-900">
                      {data.exercises.some(e => e.description?.trim()) ? "¿Añadir otro ejercicio desde documento?" : "¿Ya tienes el ejercicio en un documento?"}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">
                      Sube un PDF/DOCX con el enunciado (y criterios si los tienes). La IA lo estructura y te muestra un preview de cómo lo verá el candidato antes de añadirlo al proceso. <strong>Puedes subir tantos documentos como ejercicios quieras incluir.</strong>
                    </p>
                  </div>
                </div>
                <button type="button" onClick={() => exFileRef.current?.click()} disabled={exParseState === "parsing"}
                  className="shrink-0 bg-gray-900 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-gray-800 disabled:opacity-50">
                  {exParseState === "parsing" ? "Analizando..." : "Subir documento"}
                </button>
                <input ref={exFileRef} type="file" accept=".pdf,.docx,.txt" onChange={handleExerciseFile} className="hidden" />
              </div>
              {exParseState === "parsing" && (
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-600">
                  <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                  <span>Analizando <strong>{exParseFileName}</strong> con IA (~15s)...</span>
                </div>
              )}
              {exParseState === "error" && (
                <div className="mt-3 flex items-start justify-between gap-3 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  <div className="flex items-start gap-2">
                    <span className="text-base">⚠️</span>
                    <p className="text-xs text-red-700 leading-relaxed">{exParseError}</p>
                  </div>
                  <button type="button" onClick={() => { setExParseState("idle"); setExParseError(""); }}
                    className="shrink-0 text-xs text-red-700 hover:text-red-900 font-bold">×</button>
                </div>
              )}
            </div>

            {lastAddedName && (
              <div className="bg-green-50 border border-green-200 rounded-xl p-3 mb-4 flex items-center gap-2.5">
                <span className="text-lg">✅</span>
                <p className="text-sm text-green-800">
                  <strong>{lastAddedName}</strong> añadido al proceso. Puedes subir otro documento arriba o continuar al siguiente paso.
                </p>
              </div>
            )}

            {data.exercises.map((ex, idx) => (
              <div key={ex.id} className="border border-gray-200 rounded-2xl p-4 mb-4 bg-gray-50">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-gray-400">#{idx + 1}</span>
                  <input className="flex-1 bg-transparent border-b border-dashed border-gray-300 text-sm font-bold text-gray-800 focus:outline-none pb-1" value={ex.title} onChange={e => upEx(ex.id, "title", e.target.value)} placeholder="Título del ejercicio" />
                  {data.exercises.length > 1 && (
                    <button onClick={() => delEx(ex.id)} className="text-red-300 hover:text-red-500 text-xl leading-none">×</button>
                  )}
                </div>
                <div className="mb-3">
                  <label className={lbl}>Enunciado *</label>
                  <MarkdownEditor
                    value={ex.description}
                    onChange={v => upEx(ex.id, "description", v)}
                    rows={8}
                    small
                    placeholder={`## Objetivo\nQué debe conseguir el candidato.\n\n## Escenario\n**Cliente:** ...\n\n## Qué debe incluir\n1. Diagnóstico\n2. Propuesta estratégica\n\nUsa la barra de formato arriba para añadir **negritas**, listas y secciones.`} />
                </div>
                <div>
                  <div className="flex justify-between items-center mb-2 gap-2 flex-wrap">
                    <label className={lbl}>Criterios de evaluación</label>
                    <div className="flex gap-3 items-center">
                      <button type="button" onClick={() => critFileRefs.current[ex.id]?.click()}
                        className="text-xs text-gray-500 hover:text-gray-900 hover:underline font-medium">
                        📄 Subir criterios
                      </button>
                      <input
                        ref={el => { critFileRefs.current[ex.id] = el; }}
                        type="file" accept=".pdf,.docx,.txt" className="hidden"
                        onChange={e => { handleCriteriaFile(ex.id, e.target.files[0]); e.target.value = ""; }} />
                      <button type="button" onClick={() => addCr(ex.id)} className="text-xs text-gray-900 hover:underline font-medium">+ Criterio</button>
                    </div>
                  </div>
                  {ex.criteria.map((cr, ci) => (
                    <div key={ci} className="flex gap-2 items-start bg-white rounded-lg p-3 mb-2 border border-gray-100">
                      <div className="flex-1 space-y-2 min-w-0">
                        <input className={inp} value={cr.area} onChange={e => upCr(ex.id, ci, "area", e.target.value)} placeholder="Área evaluada" />
                        <input className={inp} value={cr.indicators} onChange={e => upCr(ex.id, ci, "indicators", e.target.value)} placeholder="Indicadores clave..." />
                      </div>
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <span className="text-xs text-gray-400">Pts</span>
                        <input className="w-12 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none" type="number" min={1} max={10} value={cr.maxScore} onChange={e => upCr(ex.id, ci, "maxScore", parseInt(e.target.value) || 5)} />
                      </div>
                      {ex.criteria.length > 1 && (
                        <button onClick={() => delCr(ex.id, ci)} className="text-red-300 hover:text-red-500 text-xl leading-none mt-1">×</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <button onClick={addEx}
              className="w-full py-3 border-2 border-dashed border-gray-300 text-gray-600 rounded-xl text-sm font-semibold hover:border-gray-900 hover:text-gray-900 transition-colors">
              + Añadir otro ejercicio
            </button>
          </div>
        );

      case "review":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Todo listo. Revisa antes de publicar</h2>
            <p className="text-gray-500 mb-5 leading-relaxed">Si algo no cuadra, edítalo con un clic. Cuando pulses "Publicar", se genera el link público y puedes empezar a recibir candidatos.</p>
            {[
              {
                key: "company", label: "🏢 Empresa",
                lines: [
                  data.company.name,
                  [data.company.sector, data.company.location, data.company.modality].filter(Boolean).join(" · "),
                ].filter(Boolean),
              },
              {
                key: "position_type", label: "👤 Posición",
                lines: [
                  getPositionTitle(data.position),
                  data.position.experience ? `${data.position.experience} años de experiencia` : null,
                ].filter(Boolean),
              },
              {
                key: "position_contract", label: "💼 Condiciones",
                lines: [
                  [data.position.contract, `${data.position.hoursPerWeek || "?"}h/sem`, data.position.schedule].filter(Boolean).join(" · "),
                  data.company.salaryMin && data.company.salaryMax
                    ? `${Number(data.company.salaryMin).toLocaleString()} – ${Number(data.company.salaryMax).toLocaleString()} ${data.company.currency}/año`
                    : "Salario sin especificar",
                ].filter(Boolean),
              },
              {
                key: "scheduling", label: "🗓 Agenda",
                lines: [data.schedulingUrl ? data.schedulingUrl : "— Sin link de agendamiento"],
              },
              {
                key: "exercises", label: "🎯 Ejercicios",
                lines: [
                  `${data.exercises.length} ejercicio${data.exercises.length !== 1 ? "s" : ""} con ${data.exercises.reduce((s, e) => s + e.criteria.length, 0)} criterios totales`,
                  ...data.exercises.map(e => `· ${e.title}`),
                ],
              },
            ].map(row => (
              <div key={row.key} className="flex items-start justify-between gap-3 py-3 border-b border-gray-100 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">{row.label}</p>
                  {row.lines.map((l, i) => <p key={i} className="text-sm text-gray-800 truncate">{l}</p>)}
                </div>
                <button onClick={() => jumpTo(row.key)} className="text-xs text-gray-500 hover:text-gray-900 font-medium shrink-0 pt-1">✏️ Editar</button>
              </div>
            ))}
          </div>
        );

      default: return null;
    }
  };

  const isIntro = current.id === "intro";
  const isReview = current.id === "review";
  const counterText = step > 0 ? `${step} de ${FLOW.length - 1}` : "";

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top bar */}
      <div className="px-6 py-5 flex justify-between items-center max-w-2xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <button onClick={attemptExit} className="text-sm text-gray-500 hover:text-gray-900 font-medium">← Volver al dashboard</button>
          <div className="w-px h-4 bg-gray-200" />
          <span className="text-xl font-black text-gray-900 tracking-tight">RecruitAI</span>
        </div>
        {counterText && <span className="text-xs text-gray-400 font-medium">{counterText}</span>}
      </div>

      {/* Exit confirmation modal */}
      {showExitConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-6">
            <div className="text-center mb-5">
              <div className="text-4xl mb-2">⚠️</div>
              <h3 className="font-bold text-gray-900 text-lg mb-1">¿Salir sin guardar?</h3>
              <p className="text-sm text-gray-500 leading-relaxed">Perderás el progreso de este proceso. Si quieres conservarlo, completa la creación.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowExitConfirm(false)}
                className="flex-1 py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
                Seguir creando
              </button>
              <button onClick={() => { setShowExitConfirm(false); onBack(); }}
                className="flex-1 py-3 bg-red-500 text-white rounded-xl text-sm font-bold hover:bg-red-600">
                Salir sin guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Exercise preview / confirmation modal (upload from document) ── */}
      {exParseState === "preview" && exParsePreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={() => { setExParseState("idle"); setExParsePreview(null); setExEditMode(false); }}>
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">✨ Revisa el ejercicio antes de añadirlo</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Detectado en <strong>{exParseFileName}</strong>. Así lo verá el candidato. Si quieres ajustar algo, usa el botón de abajo.
                </p>
              </div>
              <button onClick={() => { setExParseState("idle"); setExParsePreview(null); setExEditMode(false); }}
                className="text-gray-400 hover:text-gray-900 text-2xl leading-none shrink-0">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* Preview as candidate sees it */}
              <ExercisePreview exercise={exParsePreview} />

              {/* Collapsible edit panel */}
              <button type="button" onClick={() => setExEditMode(v => !v)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-xl text-sm font-semibold text-gray-700 transition-colors">
                <span>✏️ Ajustar antes de añadir</span>
                <span className="text-gray-400">{exEditMode ? "▲" : "▼"}</span>
              </button>

              {exEditMode && (
                <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                  <div>
                    <label className={lbl}>Título del ejercicio</label>
                    <input className={inp}
                      value={exParsePreview.title}
                      onChange={e => setExParsePreview(p => ({ ...p, title: e.target.value }))} />
                  </div>
                  <div>
                    <label className={lbl}>Enunciado</label>
                    <MarkdownEditor
                      value={exParsePreview.description}
                      onChange={v => setExParsePreview(p => ({ ...p, description: v }))}
                      rows={10}
                      small />
                  </div>
                  <div>
                    <label className={lbl}>Criterios de evaluación</label>
                    <div className="space-y-1.5 mt-1">
                      {exParsePreview.criteria.map((c, i) => (
                        <div key={i} className="flex gap-2 items-start bg-gray-50 rounded-lg p-2">
                          <div className="flex-1 min-w-0 space-y-1">
                            <input className={inp + " text-xs"} placeholder="Área"
                              value={c.area}
                              onChange={e => setExParsePreview(p => ({ ...p, criteria: p.criteria.map((cc, j) => j === i ? { ...cc, area: e.target.value } : cc) }))} />
                            <input className={inp + " text-xs"} placeholder="Indicadores"
                              value={c.indicators}
                              onChange={e => setExParsePreview(p => ({ ...p, criteria: p.criteria.map((cc, j) => j === i ? { ...cc, indicators: e.target.value } : cc) }))} />
                          </div>
                          <input type="number" min={1} max={10}
                            className="w-12 border border-gray-200 rounded-lg px-2 py-1.5 text-xs text-center"
                            value={c.maxScore}
                            onChange={e => setExParsePreview(p => ({ ...p, criteria: p.criteria.map((cc, j) => j === i ? { ...cc, maxScore: parseInt(e.target.value) || 5 } : cc) }))} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex gap-2 shrink-0">
              <button onClick={() => { setExParseState("idle"); setExParsePreview(null); setExEditMode(false); }}
                className="flex-1 py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={acceptParsedExercise}
                className="flex-[2] py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800">
                ✅ Añadir al proceso
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Criteria upload confirmation modal (per exercise) ── */}
      {critParseTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setCritParseTarget(null)}>
          <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">📋 Criterios de evaluación</h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  Desde <strong>{critParseTarget.fileName}</strong> · ejercicio{' '}
                  <strong>{data.exercises.find(x => x.id === critParseTarget.exerciseId)?.title || ""}</strong>
                </p>
              </div>
              <button onClick={() => setCritParseTarget(null)} className="text-gray-400 hover:text-gray-900 text-2xl leading-none shrink-0">×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              {critParseTarget.status === "parsing" && (
                <div className="flex items-center justify-center gap-3 py-8">
                  <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                  <span className="text-sm text-gray-600">Analizando criterios...</span>
                </div>
              )}
              {critParseTarget.status === "error" && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
                  ⚠️ {critParseTarget.error}
                </div>
              )}
              {critParseTarget.status === "preview" && critParseTarget.criteria && (
                <>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">
                    Criterios detectados ({critParseTarget.criteria.length})
                  </p>
                  <div className="space-y-2">
                    {critParseTarget.criteria.map((c, i) => (
                      <div key={i} className="bg-gray-50 border border-gray-100 rounded-lg p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900">{c.area}</p>
                            <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{c.indicators}</p>
                          </div>
                          <span className="shrink-0 text-xs font-bold text-gray-500 bg-white border border-gray-200 rounded px-2 py-0.5">
                            Máx. {c.maxScore}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
            {critParseTarget.status === "preview" && (
              <div className="px-6 py-4 border-t border-gray-100 flex flex-wrap gap-2 shrink-0">
                <button onClick={() => setCritParseTarget(null)}
                  className="py-2.5 px-4 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
                  Cancelar
                </button>
                <button onClick={() => applyCriteria("append")}
                  className="py-2.5 px-4 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
                  + Añadir a los existentes
                </button>
                <button onClick={() => applyCriteria("replace")}
                  className="flex-1 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800">
                  ↻ Reemplazar criterios
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex items-start sm:items-center justify-center px-6 pb-8">
        <div className="max-w-2xl w-full">
          {current.section && (
            <div className="flex justify-center mb-5">
              <span className="text-xs font-semibold text-gray-600 bg-gray-100 rounded-full px-3 py-1.5">
                {current.section} · Paso {current.n} de {current.total}
              </span>
            </div>
          )}

          <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8">
            {renderQuestion()}
          </div>

          <div className="flex justify-between items-center mt-5">
            {!isIntro ? (
              <button onClick={back} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 font-medium transition-colors">← Atrás</button>
            ) : <span />}

            {isReview ? (
              <div className="flex gap-2 flex-wrap justify-end">
                <button onClick={() => onPublish(data)}
                  className="px-5 py-3 border-2 border-gray-200 bg-white text-gray-700 rounded-xl text-sm font-bold hover:bg-gray-50 hover:border-gray-400 transition-colors">
                  💾 Guardar sin publicar
                </button>
                <button onClick={() => onPublishAndShare(data)}
                  className="px-6 py-3 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 transition-colors">
                  🚀 Publicar y compartir
                </button>
              </div>
            ) : (
              <button onClick={next} disabled={!canAdvance}
                className="px-6 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                {isIntro ? "Comenzar →" : "Siguiente →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Shared top bar for all candidate-facing screens ─────────────────────────
function CandidateTopBar({ counterText }) {
  return (
    <div className="border-b border-gray-100 bg-white">
      <div className="max-w-2xl mx-auto px-6 py-5 flex justify-between items-center">
        <span className="text-xl font-black text-gray-900 tracking-tight">RecruitAI</span>
        {counterText && <span className="text-xs text-gray-400 font-medium">{counterText}</span>}
      </div>
    </div>
  );
}

function JobPreviewScreen({ job, onApply, onBack }) {
  const exCount = job.exercises?.length || 1;
  return (
    <div className="min-h-screen bg-white">
      <div className="border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-6 py-5 flex justify-between items-center">
          {onBack ? (
            <button onClick={onBack} className="text-sm text-gray-400 hover:text-gray-900 font-medium">← Volver</button>
          ) : <span />}
          <span className="text-xl font-black text-gray-900 tracking-tight">RecruitAI</span>
          <span style={{ width: 50 }} />
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-8 sm:py-10">
        {/* Company + position hero */}
        <div className="bg-white rounded-3xl border border-gray-200 overflow-hidden mb-5">
          <div className="p-6 sm:p-8 border-b border-gray-100">
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 bg-gray-900 rounded-2xl flex items-center justify-center text-white text-2xl font-black shrink-0">
                {job.company?.name?.[0] || "R"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-500 font-medium">{job.company?.name}</p>
                <h1 className="text-2xl sm:text-3xl font-black text-gray-900 tracking-tight leading-tight">
                  {job.position?.title || getPositionTitle(job.position)}
                </h1>
                <p className="text-sm text-gray-500 mt-1">
                  {[job.company?.location, job.company?.modality, job.position?.contract].filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 mt-4">
              {job.company?.sector && (
                <span className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full font-medium">{job.company.sector}</span>
              )}
              {job.company?.salaryMin && (
                <span className="text-xs bg-green-50 text-green-700 px-3 py-1.5 rounded-full font-medium">
                  {Number(job.company.salaryMin).toLocaleString()} – {Number(job.company.salaryMax).toLocaleString()} {job.company.currency}/año
                </span>
              )}
              {job.position?.experience && (
                <span className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full font-medium">+{job.position.experience} años exp.</span>
              )}
              {job.position?.hoursPerWeek && (
                <span className="text-xs bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full font-medium">{job.position.hoursPerWeek}h/sem</span>
              )}
            </div>

            <button onClick={onApply}
              className="mt-5 w-full bg-gray-900 text-white py-3.5 rounded-xl font-bold hover:bg-gray-800 text-sm transition-colors">
              Solicitar empleo
            </button>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {job.company?.description && (
              <section>
                <h3 className="font-bold text-gray-500 mb-2 text-xs uppercase tracking-wide">Sobre {job.company.name}</h3>
                <MarkdownContent>{job.company.description}</MarkdownContent>
              </section>
            )}
            {job.position?.responsibilities && (
              <section>
                <h3 className="font-bold text-gray-500 mb-2 text-xs uppercase tracking-wide">Responsabilidades</h3>
                <MarkdownContent>{job.position.responsibilities}</MarkdownContent>
              </section>
            )}
            {job.position?.skills && (
              <section>
                <h3 className="font-bold text-gray-500 mb-2 text-xs uppercase tracking-wide">Habilidades requeridas</h3>
                <div className="flex flex-wrap gap-2">
                  {job.position.skills.split(",").filter(s => s.trim()).map((s, i) => (
                    <span key={i} className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded-full text-xs font-medium">{s.trim()}</span>
                  ))}
                </div>
              </section>
            )}
            {job.position?.benefits && (
              <section>
                <h3 className="font-bold text-gray-500 mb-2 text-xs uppercase tracking-wide">Otros beneficios</h3>
                <MarkdownContent>{job.position.benefits}</MarkdownContent>
              </section>
            )}
          </div>
        </div>

        {/* Process explainer */}
        <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 mb-6">
          <p className="font-bold text-gray-900 mb-3 text-sm">📋 Cómo es el proceso de selección</p>
          <ol className="space-y-2 text-sm text-gray-700">
            <li className="flex gap-2"><span className="text-gray-400">1.</span><span>Rellenas tus datos básicos — 2 minutos</span></li>
            <li className="flex gap-2"><span className="text-gray-400">2.</span><span>Resuelves {exCount} ejercicio{exCount !== 1 ? "s" : ""} práctico{exCount !== 1 ? "s" : ""} con respuesta escrita + vídeo de defensa en Loom</span></li>
            <li className="flex gap-2"><span className="text-gray-400">3.</span><span>El equipo revisa tu candidatura y te responde en 48-72h</span></li>
          </ol>
        </div>

        <button onClick={onApply}
          className="w-full bg-gray-900 text-white py-4 rounded-xl font-bold hover:bg-gray-800 transition-colors">
          🚀 Solicitar empleo
        </button>
      </div>
    </div>
  );
}

function CandidateApplyScreen({ job, onNext }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", linkedin: "", presentation: "" });
  const up = (f, v) => setForm((d) => ({ ...d, [f]: v }));
  const valid = form.name && form.email && form.presentation.trim().length > 20;
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <CandidateTopBar counterText="Paso 1 de 2" />

      <div className="flex-1 flex items-start justify-center px-6 py-8 sm:py-12">
        <div className="max-w-xl w-full">
          <div className="flex justify-center mb-5">
            <span className="text-xs font-semibold text-gray-600 bg-gray-100 rounded-full px-3 py-1.5">
              📝 Tu aplicación · {job.company?.name}
            </span>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mb-2">Cuéntanos quién eres</h1>
            <p className="text-gray-500 leading-relaxed mb-6">
              Aplicas a <strong>{job.position?.title || getPositionTitle(job.position)}</strong>. Rellena tus datos y añade una presentación breve antes de pasar a los ejercicios.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Nombre completo *</label>
                  <input className={inp} value={form.name} onChange={(e) => up("name", e.target.value)} placeholder="Nombre y apellidos" />
                </div>
                <div>
                  <label className={lbl}>Teléfono</label>
                  <input className={inp} value={form.phone} onChange={(e) => up("phone", e.target.value)} placeholder="+34 600 000 000" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Email *</label>
                  <input className={inp} type="email" value={form.email} onChange={(e) => up("email", e.target.value)} placeholder="tu@email.com" />
                </div>
                <div>
                  <label className={lbl}>LinkedIn</label>
                  <input className={inp} value={form.linkedin} onChange={(e) => up("linkedin", e.target.value)} placeholder="linkedin.com/in/..." />
                </div>
              </div>
              <div>
                <label className={lbl}>Presentación personal *</label>
                <textarea className={inp} rows={5} value={form.presentation} onChange={(e) => up("presentation", e.target.value)}
                  placeholder="Cuéntanos sobre ti, tu trayectoria y por qué crees que eres el perfil ideal para este puesto..." />
                <p className="text-xs text-gray-400 mt-1.5">
                  {form.presentation.trim().length} caracteres · mínimo 20
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end items-center mt-5">
            <button onClick={() => onNext(form)} disabled={!valid}
              className="px-6 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              Continuar con los ejercicios →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExercisesScreen({ job, candidate, onSubmit, submitting }) {
  const [idx, setIdx] = useState(0);
  const [resps, setResps] = useState(job.exercises.map((e) => ({ exerciseId: e.id, response: "", loomUrl: "" })));
  const ex = job.exercises[idx];
  const resp = resps.find((r) => r.exerciseId === ex.id);
  const upR = (f, v) => setResps(rs => rs.map(r => r.exerciseId === ex.id ? { ...r, [f]: v } : r));
  const canNext = resp?.response?.trim().length > 30 && resp?.loomUrl?.trim().length > 5;
  const isLast = idx === job.exercises.length - 1;
  return (
    <div className="min-h-screen bg-white flex flex-col">
      <CandidateTopBar counterText="Paso 2 de 2" />

      <div className="flex-1 flex items-start justify-center px-6 py-8 sm:py-12">
        <div className="max-w-2xl w-full">
          <div className="flex justify-center mb-5">
            <span className="text-xs font-semibold text-gray-600 bg-gray-100 rounded-full px-3 py-1.5">
              🎯 Ejercicio {idx + 1} de {job.exercises.length}
            </span>
          </div>

          <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 mb-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mb-4">{ex.title}</h1>
            <MarkdownContent className="mb-5">{ex.description}</MarkdownContent>

            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 mb-5">
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">📋 Criterios que se evalúan</p>
              <ul className="space-y-1.5">
                {ex.criteria.map((c, i) => (
                  <li key={i} className="text-xs text-gray-700 leading-relaxed">
                    <strong className="text-gray-900">{c.area}:</strong> {c.indicators}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-5">
              <div>
                <label className={lbl}>Tu respuesta escrita *</label>
                <textarea className={inp} rows={10} value={resp?.response || ""} onChange={e => upR("response", e.target.value)}
                  placeholder="Desarrolla tu propuesta aquí. Sé específico, cita ejemplos y muestra tu método..." />
                <p className="text-xs text-gray-400 mt-1.5">{(resp?.response || "").split(/\s+/).filter(Boolean).length} palabras</p>
              </div>
              <div>
                <label className={lbl}>Enlace de Loom — Vídeo de defensa *</label>
                <input className={inp} type="url" value={resp?.loomUrl || ""} onChange={e => upR("loomUrl", e.target.value)}
                  placeholder="https://www.loom.com/share/..." />
                <p className="text-xs text-gray-500 mt-1.5 flex items-start gap-1.5">
                  <span className="shrink-0">🎥</span>
                  <span>Graba un vídeo en <a href="https://loom.com" target="_blank" rel="noreferrer" className="text-gray-900 underline font-medium">Loom</a> (máx. 5 min) defendiendo tu propuesta y pega el enlace aquí. La IA también analiza la transcripción del vídeo.</span>
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-between items-center">
            {idx > 0 ? (
              <button onClick={() => setIdx(i => i - 1)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 font-medium">
                ← Ejercicio anterior
              </button>
            ) : <span />}
            {!isLast ? (
              <button onClick={() => setIdx(i => i + 1)} disabled={!canNext}
                className="px-6 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                Siguiente ejercicio →
              </button>
            ) : (
              <button onClick={() => onSubmit(resps)} disabled={!canNext || submitting}
                className="px-6 py-3 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                {submitting ? "Enviando..." : "✅ Enviar solicitud"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmationScreen({ candidate, onNext }) {
  const firstName = (candidate?.name || "").split(" ")[0];
  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-10 text-center">
          <div className="text-6xl mb-4">🎉</div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-3">
            ¡Solicitud enviada{firstName ? `, ${firstName}` : ""}!
          </h1>
          <p className="text-gray-500 leading-relaxed mb-6">
            Hemos recibido tu candidatura. El equipo revisará tu perfil y te responderemos en 48-72h con los siguientes pasos.
          </p>

          <div className="bg-gray-50 rounded-2xl p-5 text-left space-y-2 mb-6">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Qué pasa ahora</p>
            <p className="text-sm text-gray-700">1. El equipo revisa tu aplicación y el vídeo de defensa</p>
            <p className="text-sm text-gray-700">2. Recibirás confirmación por email</p>
            <p className="text-sm text-gray-700">3. Si encajamos, agendamos una entrevista</p>
          </div>

          {onNext && (
            <button onClick={onNext}
              className="w-full py-3.5 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition-colors">
              Ver evaluación →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function RecruiterReviewScreen({ job, candidate, evaluation, onApprove, onReject }) {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-4">
          <div className="flex items-center justify-between mb-4">
            <div><h2 className="font-bold text-gray-800">Revisión: {candidate?.name}</h2><p className="text-xs text-gray-400">{job?.company?.name}</p></div>
            <div className="text-right"><ScoreDial score={evaluation?.overall || 0} /><p className="text-xs text-gray-400 mt-1">Puntuación IA</p></div>
          </div>
          <div className="flex gap-3">
            <button onClick={onApprove} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700">✅ Avanzar a entrevista</button>
            <button onClick={onReject} className="flex-1 py-3 border-2 border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-50">❌ Descartar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InterviewInviteScreen({ job, candidate, onSchedule }) {
  const slots = ["Lunes 14 Abr, 10:00", "Martes 15 Abr, 16:00", "Miércoles 16 Abr, 11:00"];
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full">
        <h2 className="font-black text-xl text-gray-900 mb-4">🗓 Agendar entrevista</h2>
        {slots.map(s => <button key={s} onClick={() => onSchedule(s)} className="w-full mb-2 py-3 border-2 border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50">{s}</button>)}
      </div>
    </div>
  );
}

function InterviewAnalysisScreen({ analysis, candidate, job, onFinish }) {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-4">
          <h2 className="font-bold text-gray-800 mb-4">Análisis de entrevista: {candidate?.name}</h2>
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-gray-500">Candidato</p><Badge type={analysis?.candidate?.rec} /></div>
            <ScoreDial score={analysis?.candidate?.score || 0} />
          </div>
        </div>
        <button onClick={onFinish} className="w-full py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900">Ver resumen final →</button>
      </div>
    </div>
  );
}

function FinalSummaryScreen({ job, candidate, evaluation, interview, onRestart }) {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto text-center">
        <div className="text-5xl mb-3">🏁</div>
        <h1 className="text-2xl font-black text-gray-900 mb-6">Proceso completado</h1>
        <button onClick={onRestart} className="w-full py-3 border-2 border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-50">🔄 Crear nuevo proceso</button>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
          <img src="/iso-on-dark.png" alt="" className="w-10 h-10 object-contain" />
        </div>
        <p className="text-gray-500 text-sm">Cargando RecruitAI...</p>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, loading, onEmailAuth, emailLoading, emailError, resetSent, onClearAuthState }) {
  const [mode, setMode] = useState("choose"); // "choose" | "signin" | "signup" | "reset"
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  const resetForm = () => { setEmail(""); setPassword(""); setName(""); onClearAuthState?.(); };
  const goToChooser = () => { setMode("choose"); resetForm(); };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (mode === "reset") onEmailAuth({ mode: "reset", email });
    else if (mode === "signup") onEmailAuth({ mode: "signup", email, password, name });
    else onEmailAuth({ mode: "signin", email, password });
  };

  const GoogleIcon = () => (
    <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
  );

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 gap-4">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-8 sm:p-10 max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-7">
          <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <img src="/iso-on-dark.png" alt="" className="w-10 h-10 object-contain" />
          </div>
          <h1 className="text-4xl font-black text-gray-900 mb-2 tracking-tight">RecruitAI</h1>
          <p className="text-gray-500 leading-relaxed text-sm">Automatización de selección para agencias digitales</p>
        </div>

        {mode === "choose" && (
          <>
            <button onClick={onLogin} disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3.5 px-6 border-2 border-gray-200 rounded-xl font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-all disabled:opacity-50 mb-3">
              {loading ? <span className="text-sm">Iniciando sesión...</span> : (<><GoogleIcon /><span>Continuar con Google</span></>)}
            </button>

            <div className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400 font-medium">o</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <button onClick={() => setMode("signin")}
              className="w-full py-3.5 px-6 border-2 border-gray-200 rounded-xl font-semibold text-gray-700 hover:border-gray-400 hover:bg-gray-50 transition-colors mb-3">
              ✉️ Iniciar sesión con email
            </button>
            <button onClick={() => setMode("signup")}
              className="w-full py-3.5 px-6 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 transition-colors">
              Crear cuenta nueva
            </button>
          </>
        )}

        {mode !== "choose" && (
          <>
            {mode !== "reset" && (
              <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-5">
                <button onClick={() => { setMode("signin"); setName(""); onClearAuthState?.(); }}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${mode === "signin" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-900"}`}>
                  Iniciar sesión
                </button>
                <button onClick={() => { setMode("signup"); onClearAuthState?.(); }}
                  className={`flex-1 py-2 text-sm font-semibold rounded-lg transition-all ${mode === "signup" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-900"}`}>
                  Crear cuenta
                </button>
              </div>
            )}

            {mode === "reset" && (
              <p className="text-sm text-gray-600 leading-relaxed mb-4">
                Introduce tu email y te enviaremos un enlace para restablecer tu contraseña.
              </p>
            )}

            <form onSubmit={handleSubmit} className="space-y-3">
              {mode === "signup" && (
                <div>
                  <label className={lbl}>Nombre completo</label>
                  <input type="text" className={inp} value={name} onChange={e => setName(e.target.value)} required autoFocus placeholder="Tu nombre" />
                </div>
              )}
              <div>
                <label className={lbl}>Email</label>
                <input type="email" className={inp} value={email} onChange={e => setEmail(e.target.value)} required autoFocus={mode !== "signup"} placeholder="tu@email.com" />
              </div>
              {mode !== "reset" && (
                <div>
                  <label className={lbl}>Contraseña{mode === "signup" ? " (mín. 6 caracteres)" : ""}</label>
                  <input type="password" className={inp} value={password} onChange={e => setPassword(e.target.value)} required minLength={mode === "signup" ? 6 : 1} placeholder="••••••••" />
                </div>
              )}

              {emailError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{emailError}</div>
              )}
              {resetSent && (
                <div className="bg-green-50 border border-green-200 rounded-xl px-3 py-2.5 text-sm text-green-700">
                  ✅ Email enviado. Revisa tu bandeja (y spam) para restablecer la contraseña.
                </div>
              )}

              <button type="submit" disabled={emailLoading}
                className="w-full py-3.5 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 disabled:opacity-50 transition-colors">
                {emailLoading ? "Un momento..." : mode === "reset" ? "Enviar email de recuperación" : mode === "signup" ? "Crear cuenta" : "Iniciar sesión"}
              </button>

              {mode === "signin" && (
                <button type="button" onClick={() => { setMode("reset"); onClearAuthState?.(); }}
                  className="w-full text-xs text-gray-500 hover:text-gray-900 py-2">
                  ¿Olvidaste tu contraseña?
                </button>
              )}
              {mode === "reset" && (
                <button type="button" onClick={() => { setMode("signin"); onClearAuthState?.(); }}
                  className="w-full text-xs text-gray-500 hover:text-gray-900 py-2">
                  ← Volver al login
                </button>
              )}
            </form>

            <div className="mt-5 pt-5 border-t border-gray-100">
              <button onClick={goToChooser}
                className="w-full text-xs text-gray-400 hover:text-gray-900">
                ← Usar otro método de login
              </button>
            </div>
          </>
        )}

        <p className="text-xs text-gray-400 mt-6 text-center">Tus datos se guardan de forma segura en Firebase</p>
      </div>
      <BrandFooter />
    </div>
  );
}

// ─── PUBLIC CANDIDATE SCREEN ──────────────────────────────────────────────────
function CandidatePublicScreen({ processId }) {
  const [processData, setProcessData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState("preview");
  const [candidate, setCandidate] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "publicProcesses", processId));
        if (snap.exists()) setProcessData(snap.data());
        else setError("Este proceso no está disponible o el link ha expirado.");
      } catch (e) { setError("No se pudo cargar el proceso."); }
      setLoading(false);
    };
    load();
  }, [processId]);

  const handleSubmit = async (responses) => {
    setSubmitting(true);
    try {
      const appRef = await addDoc(collection(db, "publicProcesses", processId, "applications"), {
        name: candidate?.name || "", email: candidate?.email || "", phone: candidate?.phone || "",
        linkedin: candidate?.linkedin || "", presentation: candidate?.presentation || "",
        responses, submittedAt: new Date().toISOString(),
        estado: "Pendiente", progreso: "Ingreso", entrevistador: "", notas: "", phase: "applied",
      });

      // Fire-and-forget auto-evaluation. The IA runs server-side against the
      // recruiter's custom criteria + brand manual, and writes the result back
      // onto the application doc. Takes 20-60s depending on exercise count;
      // the candidate does NOT wait for it — they see "submitted" immediately.
      // When the recruiter later imports candidates, the evaluation is already
      // populated.
      fetch("/api/autoEvaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ processId, applicationId: appRef.id }),
      }).catch(e => console.error("Auto-evaluate trigger error:", e));

      // Send confirmation email to candidate
      const emailData = {
        candidateName: candidate?.name || "Candidato",
        candidateEmail: candidate?.email || "",
        companyName: processData?.company?.name || "La empresa",
        positionTitle: processData?.position?.title || processData?.positionType || "la posición",
        recruiterEmail: processData?.recruiterEmail || "",
        recruiterName: processData?.recruiterName || "Equipo de selección",
      };

      const emailConfig = processData?.emailConfig || { provider: "none" };
      if (emailConfig.provider !== "none") {
        await Promise.allSettled([
          candidate?.email && fetch("/api/sendEmail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "application_received", data: emailData, emailConfig }),
          }),
          processData?.recruiterEmail && fetch("/api/sendEmail", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "new_application_alert", data: emailData, emailConfig }),
          }),
        ]);
      }

      // Slack notification — server-side lookup of the webhook for security.
      // The webhook URL is NOT stored in the public process doc (sensitive),
      // so the server reads it from the recruiter's private doc via Admin SDK.
      // Fire-and-forget: we don't want to block the candidate's confirmation on Slack.
      fetch("/api/notifyApplication", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          processId,
          candidateName: candidate?.name || "Candidato",
          candidateEmail: candidate?.email || "",
        }),
      }).catch(e => console.error("Slack notify error:", e));

      setSubmitted(true);
    } catch (e) { alert("Error al enviar. Inténtalo de nuevo."); }
    setSubmitting(false);
  };

  if (loading) return <LoadingScreen />;
  if (error) return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center">
        <div className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-10">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Proceso no disponible</h1>
          <p className="text-gray-500 text-sm leading-relaxed">{error}</p>
        </div>
      </div>
    </div>
  );
  if (submitted) {
    const firstName = (candidate?.name || "").split(" ")[0];
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-3xl border border-gray-200 p-8 sm:p-10 text-center">
            <div className="text-6xl mb-4">🎉</div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight mb-3">
              ¡Solicitud enviada{firstName ? `, ${firstName}` : ""}!
            </h1>
            <p className="text-gray-500 leading-relaxed mb-6">
              Hemos recibido tu candidatura para <strong>{processData?.company?.name}</strong>. El equipo te responderá en 48-72h con los siguientes pasos.
            </p>
            <div className="bg-gray-50 rounded-2xl p-5 text-left space-y-2">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Lo que ya está hecho</p>
              <p className="text-sm text-gray-700">✅ Datos personales recibidos</p>
              <p className="text-sm text-gray-700">✅ Ejercicios y vídeo de defensa enviados</p>
              <p className="text-sm text-gray-700">📧 Recibirás confirmación en <strong>{candidate?.email}</strong></p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (phase === "preview") return <JobPreviewScreen job={processData} onApply={() => setPhase("apply")} onBack={null} />;
  if (phase === "apply") return <CandidateApplyScreen job={processData} onNext={(form) => { setCandidate(form); setPhase("exercises"); }} />;
  if (phase === "exercises") return <ExercisesScreen job={processData} candidate={candidate} onSubmit={handleSubmit} submitting={submitting} />;
  return null;
}

// ─── EMAIL SETUP WIZARD (shared) ─────────────────────────────────────────────
function EmailSetupWizard({ emailConfig, onChange }) {
  const [provider, setProvider] = useState(emailConfig?.provider || "app");
  const [resendApiKey, setResendApiKey] = useState(emailConfig?.resendApiKey || "");
  const [fromEmail, setFromEmail] = useState(emailConfig?.fromEmail || "");
  const [fromName, setFromName] = useState(emailConfig?.fromName || "");
  const [showDns, setShowDns] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testStatus, setTestStatus] = useState(null);

  const emit = (updates) => {
    const next = { provider, resendApiKey, fromEmail, fromName, ...updates };
    onChange(next);
  };

  // Auto-emit "app" as default on first mount
  useEffect(() => {
    if (!emailConfig?.provider) onChange({ provider: "app", fromName: "" });
  }, []);

  const handleTestEmail = async () => {
    if (!testEmail) return;
    setTestStatus("sending");
    try {
      const cfg = { provider, resendApiKey, fromEmail, fromName };
      const res = await fetch("/api/sendEmail", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "test", data: { candidateEmail: testEmail, candidateName: "Test", companyName: fromName || "Tu agencia", positionTitle: "Email de prueba" }, emailConfig: cfg }),
      });
      const json = await res.json();
      setTestStatus(json.success ? "ok" : "error");
    } catch { setTestStatus("error"); }
    setTimeout(() => setTestStatus(null), 4000);
  };

  const PROVIDERS = [
    { id: "app", icon: "✨", title: "RecruitAI Mail", sub: "Sin configuración · Activado al momento · Gratis", badge: "Recomendado" },
    { id: "resend_domain", icon: "🏢", title: "Tu dominio propio", sub: "Emails desde tu dirección corporativa · Máxima marca", badge: "Avanzado" },
  ];

  return (
    <div className="space-y-4">
      {/* Provider cards */}
      <div className="space-y-2">
        {PROVIDERS.map(({ id, icon, title, sub, badge }) => (
          <div key={id} onClick={() => { setProvider(id); emit({ provider: id }); }}
            className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${provider === id ? "border-gray-900 bg-gray-50" : "border-gray-200 hover:border-gray-300 bg-white"}`}>
            <div className={`w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0 ${provider === id ? "border-gray-900 bg-gray-900" : "border-gray-300"}`}>
              {provider === id && <div className="w-2 h-2 bg-white rounded-full" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-800">{icon} {title}</span>
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full shrink-0">{badge}</span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* RecruitAI Mail: zero config */}
      {provider === "app" && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-xl">✅</span>
            <p className="text-sm font-bold text-green-800">¡Ya está activado!</p>
          </div>
          <p className="text-xs text-green-700">Los emails se enviarán automáticamente desde RecruitAI. No necesitas configurar nada más.</p>
          <div>
            <label className={lbl}>Nombre del remitente (opcional)</label>
            <input className={inp} type="text" placeholder="Selección · Tu Agencia"
              value={fromName} onChange={e => { setFromName(e.target.value); emit({ fromName: e.target.value }); }} />
            <p className="text-xs text-gray-400 mt-1">Los candidatos verán: "{fromName || "Tu Agencia"} · RecruitAI"</p>
          </div>
        </div>
      )}

      {/* Domain provider */}
      {provider === "resend_domain" && (
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-4">
          <p className="text-sm font-semibold text-purple-800">Configura tu dominio en 3 pasos:</p>
          <div className="space-y-3">
            {[
              { n: 1, text: "Crea una cuenta gratuita en Resend", link: "https://resend.com/signup", linkLabel: "Crear cuenta en Resend →" },
              { n: 2, text: "Ve a Domains → Add Domain → añade tu dominio y copia los registros DNS en tu proveedor (Cloudflare, GoDaddy, etc.)" },
              { n: 3, text: "Ve a API Keys → Create API Key → copia la clave y pégala abajo" },
            ].map(({ n, text, link, linkLabel }) => (
              <div key={n} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-purple-200 text-purple-800 text-xs font-bold flex items-center justify-center shrink-0">{n}</div>
                <div>
                  <p className="text-xs text-purple-900">{text}</p>
                  {link && <a href={link} target="_blank" rel="noreferrer" className="text-xs text-gray-900 underline">{linkLabel}</a>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setShowDns(v => !v)} className="text-xs text-purple-600 underline">
            {showDns ? "Ocultar" : "¿Qué registros DNS necesito?"} →
          </button>
          {showDns && (
            <div className="bg-white rounded-lg p-3 text-xs text-gray-700 border border-purple-200 space-y-1">
              <p className="font-semibold">Resend te dará 3 registros TXT para copiar en tu DNS:</p>
              <p>• <strong>SPF</strong>: verifica que puedes enviar desde tu dominio</p>
              <p>• <strong>DKIM</strong>: firma los emails para evitar spam</p>
              <p>• <strong>DMARC</strong>: política de seguridad del dominio</p>
              <p className="text-gray-400 pt-1">Cópialos exactamente como aparecen en Resend. Tarda 5–10 min en verificarse.</p>
            </div>
          )}
          <div className="space-y-3 pt-2 border-t border-purple-200">
            <div>
              <label className={lbl}>API Key de Resend</label>
              <input className={inp} type="password" placeholder="re_xxxxxxxxxxxxxxxxxxxx"
                value={resendApiKey} onChange={e => { setResendApiKey(e.target.value); emit({ resendApiKey: e.target.value }); }} />
            </div>
            <div>
              <label className={lbl}>Email de envío</label>
              <input className={inp} type="email" placeholder="reclutamiento@tuagencia.com"
                value={fromEmail} onChange={e => { setFromEmail(e.target.value); emit({ fromEmail: e.target.value }); }} />
            </div>
            <div>
              <label className={lbl}>Nombre del remitente</label>
              <input className={inp} type="text" placeholder="Selección · Tu Agencia"
                value={fromName} onChange={e => { setFromName(e.target.value); emit({ fromName: e.target.value }); }} />
            </div>
          </div>
        </div>
      )}

      {/* Test email */}
      <div className="bg-gray-50 rounded-xl p-4 space-y-2 border border-gray-200">
        <label className={lbl}>📬 Enviar email de prueba</label>
        <div className="flex gap-2">
          <input className={inp + " flex-1"} type="email" placeholder="tu@email.com" value={testEmail} onChange={e => setTestEmail(e.target.value)} />
          <button onClick={handleTestEmail} disabled={testStatus === "sending" || !testEmail}
            className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-bold hover:bg-gray-900 disabled:opacity-40 whitespace-nowrap">
            {testStatus === "sending" ? "Enviando..." : "Probar"}
          </button>
        </div>
        {testStatus === "ok" && <p className="text-xs text-green-600 font-medium">✅ Email recibido correctamente — ¡todo listo!</p>}
        {testStatus === "error" && <p className="text-xs text-red-500">✗ Error. Revisa los datos e inténtalo de nuevo.</p>}
      </div>
    </div>
  );
}

// ─── ONBOARDING SCREEN ────────────────────────────────────────────────────────
// Skip warnings per step
const SKIP_WARNINGS = {
  all: {
    title: "¿Seguro que quieres omitir la configuración?",
    impact: [
      "❌ La IA evaluará candidatos sin contexto de tu agencia",
      "❌ Los candidatos no recibirán emails de confirmación",
      "❌ No recibirás alertas de nuevas solicitudes",
      "❌ Sin resúmenes ni notificaciones en Slack",
    ],
    manual: "Tendrás que revisar la app manualmente para ver nuevas solicitudes y gestionar todo el proceso sin automatización.",
  },
  brand: {
    title: "¿Omitir el manual de marca?",
    impact: [
      "❌ La IA no conocerá los valores de tu agencia",
      "❌ La evaluación de compatibilidad cultural será genérica",
      "❌ Las puntuaciones de actitud y cultura serán menos precisas",
    ],
    manual: "Deberás configurarlo después en ⚙️ Configuración → Marca antes de evaluar candidatos con IA.",
  },
  email: {
    title: "¿Omitir la configuración de email?",
    impact: [
      "❌ Los candidatos no recibirán confirmación al aplicar",
      "❌ No recibirás alertas de nuevas solicitudes por email",
      "❌ Las decisiones finales no se comunicarán automáticamente",
    ],
    manual: "Tendrás que comunicarte con los candidatos manualmente en cada etapa del proceso.",
  },
  slack: {
    title: "¿Omitir la conexión con Slack?",
    impact: [
      "❌ No recibirás avisos cuando llegue un nuevo candidato",
      "❌ Sin resumen diario del estado del pipeline",
      "❌ Las evaluaciones de IA y decisiones no se notificarán al equipo",
    ],
    manual: "Tendrás que entrar a la app para ver actualizaciones. Puedes configurarlo después en ⚙️ Configuración → Slack.",
  },
};

function SkipWarningModal({ warningKey, onConfirm, onCancel }) {
  const w = SKIP_WARNINGS[warningKey];
  if (!w) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="p-6 space-y-4">
          <div className="text-3xl text-center">⚠️</div>
          <h3 className="text-base font-black text-gray-900 text-center">{w.title}</h3>
          <div className="bg-red-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-red-700 uppercase tracking-wide">Sin esta configuración:</p>
            {w.impact.map((item, i) => <p key={i} className="text-xs text-red-700">{item}</p>)}
          </div>
          <div className="bg-amber-50 rounded-xl p-3">
            <p className="text-xs text-amber-800"><strong>Proceso manual:</strong> {w.manual}</p>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800">
            ← Volver a configurar
          </button>
          <button onClick={onConfirm} className="flex-1 py-2.5 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50">
            Omitir de todas formas
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Brand-manual generator: 9 conversational prompts fed to Claude ──────────
const BRAND_GEN_QUESTIONS = [
  { id: "name", title: "¿Cómo se llama tu agencia?", subtitle: "El nombre que quieres que aparezca en el manual.", placeholder: "Acme Studio, Brand Lab, Tu Agencia...", minLength: 2, rows: 1 },
  { id: "history", title: "¿Cómo nació tu agencia y por qué existe hoy?", subtitle: "Desde dónde empezasteis, qué os movió a montar algo distinto, qué problema veíais que nadie resolvía bien.", placeholder: "Empezamos en 2020 porque veíamos que las agencias cobraban fortunas y entregaban cosas mediocres...", minLength: 30, rows: 5 },
  { id: "whatYouDo", title: "¿Qué hacéis, para quién, y qué consiguen trabajando con vosotros?", subtitle: "Lo más específico posible. Sectores, tipo de cliente, resultados medibles si puedes.", placeholder: "Llevamos paid media de ecommerce ya validados hasta 7 cifras. Nuestros clientes duplican ingresos en 12 meses...", minLength: 30, rows: 4 },
  { id: "differentiator", title: "¿Qué os hace diferentes de otras agencias parecidas?", subtitle: "2-3 cosas concretas con evidencia, método o experiencia detrás. No frases genéricas.", placeholder: "18M invertidos y 50M generados en 2024. Trabajamos con máximo 8 clientes a la vez. Te atiende el CEO, no un becario...", minLength: 30, rows: 4 },
  { id: "values", title: "¿Cuáles son los 3-4 valores innegociables en vuestro equipo?", subtitle: "Cada uno con una frase explicándolo. Los que si alguien no los comparte, no encaja.", placeholder: "Libertad: nadie vino al mundo para cumplir horarios eternos. Disciplina: sin esfuerzo no hay magia. Honestidad: no prometemos lo que no podemos entregar...", minLength: 40, rows: 5 },
  { id: "idealClient", title: "Describe a vuestro cliente perfecto", subtitle: "Cómo es, qué le preocupa, qué quiere conseguir. Cuanto más específico mejor — nombre tipo, edad, negocio, contexto vital.", placeholder: "Fundadores de ecommerce o SaaS, 35-45 años, facturan 500k-5M, están quemados haciendo marketing a medias, necesitan un socio que les lleve la parte...", minLength: 40, rows: 5 },
  { id: "tone", title: "¿Cómo os gusta comunicaros?", subtitle: "Directos, cercanos, con humor, formales... y dame la primera línea de un email que escribirías a un cliente nuevo.", placeholder: "Somos cercanos y directos. Evitamos corporate speak. Un email típico: 'Hola Ana, he visto tu anuncio en Meta y tengo 3 observaciones rápidas que te pueden subir el ROAS...'", minLength: 30, rows: 5 },
  { id: "redFlags", title: "¿Qué conductas harían que despidierais a un fichaje en su primer mes?", subtitle: "2-3 ejemplos concretos. Los 'no negociables' de comportamiento en el equipo.", placeholder: "Faltar a reuniones sin avisar. Entregar tarde sin pedir ayuda antes. Hablar mal de un cliente en Slack...", minLength: 20, rows: 4 },
  { id: "idealProfile", title: "¿Qué tipo de persona encaja en vuestro equipo?", subtitle: "Actitud, mentalidad, soft skills. Más allá del CV — qué actitud buscas en el día a día.", placeholder: "Proactivos. Curiosos. Capaces de escribir un email claro en 10 minutos sin que el CEO los revise. Con criterio propio. Que pregunten cuando no saben...", minLength: 30, rows: 5 },
];

// ── Markdown → DOCX converter with dynamic import of `docx` library ──────────
async function downloadBrandAsDocx(markdownContent, agencyName) {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun, AlignmentType } = await import("docx");

  const makeRuns = (text) => {
    // Parse inline **bold** into TextRun list
    const parts = text.split(/(\*\*[^*]+\*\*)/);
    const runs = [];
    for (const p of parts) {
      if (!p) continue;
      if (p.startsWith("**") && p.endsWith("**")) runs.push(new TextRun({ text: p.slice(2, -2), bold: true }));
      else runs.push(new TextRun({ text: p }));
    }
    return runs;
  };

  const children = [];
  for (const rawLine of markdownContent.split("\n")) {
    const line = rawLine.trim();
    if (!line) { children.push(new Paragraph({ children: [] })); continue; }
    if (line.startsWith("# ")) {
      children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1, alignment: AlignmentType.LEFT, spacing: { before: 200, after: 200 } }));
    } else if (line.startsWith("## ")) {
      children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } }));
    } else if (line.startsWith("### ")) {
      children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 } }));
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      children.push(new Paragraph({ children: makeRuns(line.slice(2)), bullet: { level: 0 } }));
    } else {
      children.push(new Paragraph({ children: makeRuns(line) }));
    }
  }

  const doc = new Document({ sections: [{ children }] });
  const blob = await Packer.toBlob(doc);
  const safe = (agencyName || "agencia").replace(/[^a-z0-9]+/gi, "_").toLowerCase();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `manual_de_marca_${safe}.docx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Conversational onboarding (Rumbo-style: one question per screen) ────────
function OnboardingScreen({ user, onComplete }) {
  const _saved = (() => { try { return JSON.parse(localStorage.getItem("recruitai_onboarding") || "{}"); } catch { return {}; } })();

  const [step, setStep] = useState(_saved.step ?? 0);
  const [brandChoice, setBrandChoice] = useState(_saved.brandChoice || "");   // "paste" | "upload" | "generate" | "skip"
  const [brandManual, setBrandManual] = useState(_saved.brandManual || "");
  const [brandAnswers, setBrandAnswers] = useState(_saved.brandAnswers || {}); // { name, history, whatYouDo, ... }
  const [generatedManual, setGeneratedManual] = useState(_saved.generatedManual || "");
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [emailProvider, setEmailProvider] = useState(_saved.emailProvider || ""); // "app" | "resend_domain"
  const [fromName, setFromName] = useState(_saved.fromName || "");
  const [resendApiKey, setResendApiKey] = useState(_saved.resendApiKey || "");
  const [fromEmail, setFromEmail] = useState(_saved.fromEmail || "");
  const [slackChoice, setSlackChoice] = useState(_saved.slackChoice || ""); // "connect" | "later"
  const [slackConfig, setSlackConfig] = useState(_saved.slackConfig || { webhookUrl: "", notifications: { newApplication: "both", aiEvaluation: "instant", finalDecision: "both", dailyDigest: true } });
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState(_saved.fileName || "");
  const fileRef = useRef(null);

  // Dynamic flow: steps are computed from answers so branches don't create dead screens.
  // Each entry: { id, section?, n?, total? }
  const flow = (() => {
    const f = [{ id: "welcome" }];
    // Section 1 — Tu marca
    let brandTotal = 1; // just the choice
    if (brandChoice === "paste" || brandChoice === "upload") brandTotal = 2;
    if (brandChoice === "generate") brandTotal = 1 + BRAND_GEN_QUESTIONS.length + 1; // choice + 9 questions + result
    f.push({ id: "brand_choice", section: "🎨 Tu marca", n: 1, total: brandTotal });
    if (brandChoice === "paste" || brandChoice === "upload") {
      f.push({ id: "brand_content", section: "🎨 Tu marca", n: 2, total: 2 });
    }
    if (brandChoice === "generate") {
      BRAND_GEN_QUESTIONS.forEach((q, i) => {
        f.push({ id: `gen_${q.id}`, section: "🎨 Tu marca", n: 2 + i, total: brandTotal });
      });
      f.push({ id: "brand_gen_result", section: "🎨 Tu marca", n: brandTotal, total: brandTotal });
    }
    // Section 2 — Emails a candidatos
    const emailTotal = emailProvider ? 2 : 1;
    f.push({ id: "email_choice", section: "📧 Emails a candidatos", n: 1, total: emailTotal });
    if (emailProvider) {
      f.push({ id: "email_details", section: "📧 Emails a candidatos", n: 2, total: 2 });
    }
    // Section 3 — Notificaciones
    const slackTotal = slackChoice === "connect" ? 2 : 1;
    f.push({ id: "slack_choice", section: "🔔 Notificaciones en Slack", n: 1, total: slackTotal });
    if (slackChoice === "connect") {
      f.push({ id: "slack_connect", section: "🔔 Notificaciones en Slack", n: 2, total: 2 });
    }
    f.push({ id: "done" });
    return f;
  })();
  // Keep step within bounds when the flow shrinks (e.g. user changes answer)
  const safeStep = Math.min(step, flow.length - 1);
  const current = flow[safeStep];

  useEffect(() => {
    localStorage.setItem("recruitai_onboarding", JSON.stringify({
      step: safeStep, brandChoice, brandManual, brandAnswers, generatedManual,
      emailProvider, fromName, resendApiKey, fromEmail, slackChoice, slackConfig, fileName,
    }));
  }, [safeStep, brandChoice, brandManual, brandAnswers, generatedManual, emailProvider, fromName, resendApiKey, fromEmail, slackChoice, slackConfig, fileName]);

  // Return from Slack OAuth redirect — jump to the connect question
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const webhookUrl = params.get("slackWebhook");
    const channel = params.get("slackChannel");
    if (webhookUrl) {
      setSlackConfig(s => ({ ...s, webhookUrl, channelName: channel || "" }));
      setSlackChoice("connect");
      // Jump to slack_connect step (after flow rebuilds)
      setTimeout(() => {
        const idx = flow.findIndex(f => f.id === "slack_connect");
        if (idx > -1) setStep(idx);
      }, 0);
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("slackError")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true); setFileName(file.name);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "txt") setBrandManual(await file.text());
      else if (ext === "docx") {
        const mammoth = await import("mammoth");
        const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        setBrandManual(r.value);
      } else if (ext === "pdf") {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let t = ""; for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const ct = await pg.getTextContent(); t += ct.items.map(x => x.str).join(" ") + "\n"; }
        setBrandManual(t.trim());
      }
    } catch { /* ignore */ }
    setUploading(false);
  };

  const next = () => setStep(s => Math.min(s + 1, flow.length - 1));
  const back = () => setStep(s => Math.max(0, s - 1));

  const finish = () => {
    localStorage.removeItem("recruitai_onboarding");
    const finalEmailConfig =
      emailProvider === "app"
        ? { provider: "app", fromName: fromName.trim() }
        : emailProvider === "resend_domain"
          ? { provider: "resend_domain", resendApiKey: resendApiKey.trim(), fromEmail: fromEmail.trim(), fromName: fromName.trim() }
          : { provider: "none" };
    const finalSlack = slackChoice === "connect"
      ? slackConfig
      : { webhookUrl: "", notifications: { newApplication: "both", aiEvaluation: "instant", finalDecision: "both", dailyDigest: true } };
    // Pick the right brand manual source: pasted/uploaded, generated by AI, or skipped.
    const finalBrandManual =
      brandChoice === "skip" ? ""
      : brandChoice === "generate" ? (generatedManual || "")
      : brandManual;
    onComplete({
      brandManual: finalBrandManual,
      emailConfig: finalEmailConfig,
      slackConfig: finalSlack,
      onboardingCompleted: true,
    });
  };

  // Auto-fire generation when the user first lands on the result screen.
  // The effect is keyed to current.id so it only runs on step transition.
  useEffect(() => {
    if (current.id === "brand_gen_result" && !generatedManual && !generating && !generateError) {
      runGenerateBrand();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.id]);

  // Call the server to generate the brand manual from the 9 answers.
  const runGenerateBrand = async () => {
    setGenerating(true); setGenerateError("");
    try {
      const res = await fetch("/api/generateBrand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: brandAnswers, agencyName: brandAnswers.name || "" }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Error desconocido");
      setGeneratedManual(json.manual || "");
    } catch (e) {
      setGenerateError(e.message || "No se pudo generar el manual. Inténtalo de nuevo.");
    }
    setGenerating(false);
  };

  // ── Validate current step ──────────────────────────────────────────────────
  const canAdvance = (() => {
    if (current.id.startsWith("gen_")) {
      const qKey = current.id.slice(4);
      const q = BRAND_GEN_QUESTIONS.find(x => x.id === qKey);
      const answer = brandAnswers[qKey] || "";
      return answer.trim().length >= (q?.minLength || 10);
    }
    switch (current.id) {
      case "welcome": return true;
      case "brand_choice": return !!brandChoice;
      case "brand_content": return brandManual.trim().length > 10;
      case "brand_gen_result": return !!generatedManual && !generating;
      case "email_choice": return !!emailProvider;
      case "email_details":
        if (emailProvider === "app") return true; // fromName is optional
        return resendApiKey.trim() && fromEmail.trim();
      case "slack_choice": return !!slackChoice;
      case "slack_connect": return !!slackConfig.webhookUrl;
      case "done": return true;
      default: return false;
    }
  })();

  // ── Question renderers ─────────────────────────────────────────────────────
  const ChoiceCard = ({ selected, onClick, icon, title, subtitle, badge }) => (
    <button onClick={onClick}
      className={`w-full text-left rounded-2xl border-2 p-5 transition-all ${
        selected ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white hover:border-gray-400"
      }`}>
      <div className="flex items-start gap-3">
        <div className="text-2xl shrink-0">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-bold text-sm ${selected ? "text-white" : "text-gray-900"}`}>{title}</span>
            {badge && <span className={`text-xs px-2 py-0.5 rounded-full ${selected ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}`}>{badge}</span>}
          </div>
          <p className={`text-xs mt-1 leading-relaxed ${selected ? "text-white/80" : "text-gray-500"}`}>{subtitle}</p>
        </div>
      </div>
    </button>
  );

  const renderQuestion = () => {
    // ── Dynamic brand-generation questions ───────────────────────────────────
    if (current.id.startsWith("gen_")) {
      const qKey = current.id.slice(4);
      const q = BRAND_GEN_QUESTIONS.find(x => x.id === qKey);
      if (!q) return null;
      const value = brandAnswers[qKey] || "";
      const Input = q.rows > 1 ? "textarea" : "input";
      return (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{q.title}</h2>
          <p className="text-gray-500 mb-5 leading-relaxed">{q.subtitle}</p>
          <Input
            className={inp}
            {...(q.rows > 1 ? { rows: q.rows } : { type: "text" })}
            value={value}
            onChange={e => setBrandAnswers(a => ({ ...a, [qKey]: e.target.value }))}
            placeholder={q.placeholder}
          />
          <p className="text-xs text-gray-400 mt-2">
            {value.trim().length} caracteres · mínimo {q.minLength}
          </p>
        </div>
      );
    }

    // ── Brand generation result screen ───────────────────────────────────────
    if (current.id === "brand_gen_result") {
      return (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            {generating ? "✨ Generando tu manual..." : generateError ? "⚠️ Algo falló" : "✅ Tu manual está listo"}
          </h2>
          <p className="text-gray-500 mb-5 leading-relaxed">
            {generating
              ? "Estoy escribiendo un manual de ~2000 palabras con tu voz y estructura. Esto tarda 20-40 segundos."
              : generateError
                ? "La IA no pudo generar el manual esta vez. Puedes reintentar o volver atrás a revisar las respuestas."
                : "Puedes editarlo aquí, descargarlo como .docx para compartir con tu equipo, o continuar tal cual."}
          </p>

          {generating && (
            <div className="bg-gray-50 border border-gray-100 rounded-2xl p-8 flex items-center justify-center">
              <div className="flex items-center gap-3 text-gray-600">
                <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                <span className="text-sm">Redactando tu manual...</span>
              </div>
            </div>
          )}

          {generateError && (
            <div className="space-y-3">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">{generateError}</div>
              <button onClick={runGenerateBrand}
                className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800">
                🔄 Reintentar
              </button>
            </div>
          )}

          {generatedManual && !generating && (
            <>
              <textarea
                className={inp + " font-mono text-xs"}
                rows={14}
                value={generatedManual}
                onChange={e => setGeneratedManual(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">
                {generatedManual.split(/\s+/).filter(Boolean).length} palabras · puedes editarlo antes de continuar
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={() => downloadBrandAsDocx(generatedManual, brandAnswers.name)}
                  className="flex-1 min-w-[140px] py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors">
                  📥 Descargar .docx
                </button>
                <button onClick={() => { navigator.clipboard.writeText(generatedManual); }}
                  className="py-3 px-4 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
                  📋 Copiar
                </button>
                <button onClick={() => { setGeneratedManual(""); setGenerateError(""); runGenerateBrand(); }}
                  className="py-3 px-4 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50">
                  🔄 Regenerar
                </button>
              </div>
            </>
          )}
        </div>
      );
    }

    switch (current.id) {
      case "welcome":
        return (
          <div className="text-center py-6 space-y-5">
            <div className="text-6xl">👋</div>
            <div>
              <h2 className="text-3xl font-black text-gray-900 tracking-tight">Hola, {user?.displayName?.split(" ")[0] || "bienvenido"}</h2>
              <p className="text-gray-500 mt-3 leading-relaxed">Vamos a configurar tu cuenta en 3 minutos. Te haré unas preguntas sobre tu agencia para adaptar la IA a tu estilo.</p>
            </div>
            <div className="pt-2 grid grid-cols-3 gap-2 text-xs text-gray-400">
              <div><span className="font-bold text-gray-700 block">🎨</span>Tu marca</div>
              <div><span className="font-bold text-gray-700 block">📧</span>Emails</div>
              <div><span className="font-bold text-gray-700 block">🔔</span>Notificaciones</div>
            </div>
          </div>
        );

      case "brand_choice":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">¿Tienes un manual de marca o valores de tu agencia?</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">La IA lo usará para evaluar si cada candidato encaja con tu cultura. Sin esto, la evaluación cultural será genérica.</p>
            <div className="space-y-2.5">
              <ChoiceCard selected={brandChoice === "paste"} onClick={() => setBrandChoice("paste")}
                icon="✏️" title="Sí, lo escribo o lo pego" subtitle="Copia-pega el texto o escríbelo a mano" />
              <ChoiceCard selected={brandChoice === "upload"} onClick={() => setBrandChoice("upload")}
                icon="📄" title="Sí, lo subo como documento" subtitle="Extraigo el texto automáticamente de un .pdf, .docx o .txt" />
              <ChoiceCard selected={brandChoice === "generate"} onClick={() => setBrandChoice("generate")}
                icon="✨" title="No tengo manual, créalo conmigo" subtitle="Respondes 9 preguntas y la IA genera un manual completo basado en tus respuestas. Podrás descargarlo." badge="Nuevo" />
              <ChoiceCard selected={brandChoice === "skip"} onClick={() => setBrandChoice("skip")}
                icon="⏭" title="Aún no, lo configuro más tarde" subtitle="Podrás añadirlo en ⚙️ Configuración cuando quieras" />
            </div>
          </div>
        );

      case "brand_content":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {brandChoice === "upload" ? "Sube tu documento" : "Pega aquí tu manual"}
            </h2>
            <p className="text-gray-500 mb-5 leading-relaxed">
              {brandChoice === "upload"
                ? "Formatos admitidos: .txt, .docx, .pdf. Extraigo el texto y lo muestro abajo para que lo revises."
                : "Cuanta más contexto des a la IA (valores, tono, qué buscáis, qué evitáis), mejor evaluará la compatibilidad cultural."}
            </p>
            {brandChoice === "upload" && (
              <div className="mb-4">
                <div onClick={() => fileRef.current?.click()}
                  className="border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center cursor-pointer hover:border-gray-400 hover:bg-gray-50 transition-all">
                  {uploading ? <p className="text-sm text-gray-700 font-medium">Extrayendo texto...</p> : (
                    <>
                      <p className="text-3xl mb-2">📁</p>
                      <p className="text-sm font-medium text-gray-700">{fileName ? `✓ ${fileName}` : "Haz clic para seleccionar archivo"}</p>
                      <p className="text-xs text-gray-400 mt-1">.txt · .docx · .pdf</p>
                    </>
                  )}
                </div>
                <input ref={fileRef} type="file" accept=".txt,.docx,.pdf" onChange={handleFile} className="hidden" />
              </div>
            )}
            <textarea className={inp} rows={brandChoice === "upload" ? 6 : 10}
              value={brandManual} onChange={e => setBrandManual(e.target.value)}
              placeholder="Somos una agencia orientada a resultados medibles. Buscamos perfiles con proactividad y pensamiento estratégico. Tono: cercano, directo, sin tecnicismos..." />
            <p className="text-xs text-gray-400 mt-2">{brandManual.split(/\s+/).filter(Boolean).length} palabras</p>
          </div>
        );

      case "email_choice":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">¿Cómo quieres enviar emails a los candidatos?</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">Los candidatos reciben confirmación al aplicar, y los contactas automáticamente al tomar decisiones finales.</p>
            <div className="space-y-2.5">
              <ChoiceCard selected={emailProvider === "app"} onClick={() => setEmailProvider("app")}
                icon="✨" title="Con RecruitAI Mail" subtitle="Sin configuración · activado al momento · gratis" badge="Recomendado" />
              <ChoiceCard selected={emailProvider === "resend_domain"} onClick={() => setEmailProvider("resend_domain")}
                icon="🏢" title="Con mi dominio propio" subtitle="Los candidatos ven tu dirección corporativa · máxima marca" badge="Avanzado" />
            </div>
          </div>
        );

      case "email_details":
        if (emailProvider === "app") {
          return (
            <div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">¿Cómo quieres firmar los emails?</h2>
              <p className="text-gray-500 mb-6 leading-relaxed">El nombre que verán los candidatos en la bandeja de entrada. Opcional.</p>
              <div>
                <label className={lbl}>Nombre del remitente</label>
                <input className={inp} type="text" value={fromName} onChange={e => setFromName(e.target.value)}
                  placeholder="Selección · Tu Agencia" />
                <p className="text-xs text-gray-400 mt-2">Los candidatos verán: "<strong>{fromName || "Tu Agencia"}</strong> · RecruitAI"</p>
              </div>
            </div>
          );
        }
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Conecta tu cuenta de Resend</h2>
            <p className="text-gray-500 mb-5 leading-relaxed">Necesitas una cuenta en Resend con tu dominio verificado. <a href="https://resend.com/signup" target="_blank" rel="noreferrer" className="text-gray-900 underline">Crear cuenta gratis →</a></p>
            <div className="space-y-4">
              <div>
                <label className={lbl}>API Key de Resend</label>
                <input className={inp} type="password" value={resendApiKey} onChange={e => setResendApiKey(e.target.value)}
                  placeholder="re_..." />
              </div>
              <div>
                <label className={lbl}>Email remitente (de tu dominio verificado)</label>
                <input className={inp} type="email" value={fromEmail} onChange={e => setFromEmail(e.target.value)}
                  placeholder="seleccion@tu-agencia.com" />
              </div>
              <div>
                <label className={lbl}>Nombre del remitente</label>
                <input className={inp} type="text" value={fromName} onChange={e => setFromName(e.target.value)}
                  placeholder="Selección · Tu Agencia" />
              </div>
            </div>
          </div>
        );

      case "slack_choice":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">¿Quieres avisos en Slack cuando llegue un candidato?</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">Recibirás notificaciones instantáneas + un resumen diario del pipeline. También se avisa cuando la IA termina una evaluación o cuando tomas una decisión.</p>
            <div className="space-y-2.5">
              <ChoiceCard selected={slackChoice === "connect"} onClick={() => setSlackChoice("connect")}
                icon="🔔" title="Sí, conectar Slack" subtitle="1 clic para autorizar · elige el canal donde quieres los avisos" />
              <ChoiceCard selected={slackChoice === "later"} onClick={() => setSlackChoice("later")}
                icon="⏭" title="Más tarde" subtitle="Puedes conectarlo cuando quieras en ⚙️ Configuración → Slack" />
            </div>
          </div>
        );

      case "slack_connect":
        return (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Autoriza RecruitAI en Slack</h2>
            <p className="text-gray-500 mb-6 leading-relaxed">
              {slackConfig.webhookUrl
                ? "✅ Slack conectado correctamente. Elige qué notificaciones quieres recibir."
                : "Al hacer clic abajo se abrirá Slack para elegir el workspace y el canal. Después te traemos de vuelta aquí."}
            </p>
            {!slackConfig.webhookUrl ? (
              <a href="/api/slack/install"
                className="block text-center w-full py-4 bg-[#4A154B] text-white rounded-2xl font-bold hover:opacity-90 transition-opacity">
                🔗 Conectar con Slack
              </a>
            ) : (
              <div className="space-y-3">
                <div className="bg-gray-50 rounded-xl p-4 flex items-center gap-3">
                  <div className="text-2xl">✅</div>
                  <div>
                    <p className="text-sm font-bold text-gray-900">Conectado</p>
                    {slackConfig.channelName && <p className="text-xs text-gray-500">Canal: {slackConfig.channelName}</p>}
                  </div>
                </div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide pt-2">Preferencias</p>
                {[
                  ["newApplication", "🔔 Nueva aplicación", ["both", "instant"]],
                  ["aiEvaluation", "🤖 Evaluación IA terminada", ["both", "instant"]],
                  ["finalDecision", "✅ Decisión final tomada", ["both", "instant"]],
                ].map(([key, label, onValues]) => (
                  <label key={key} className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-4 py-3 cursor-pointer">
                    <span className="text-sm text-gray-700 font-medium">{label}</span>
                    <input type="checkbox" checked={onValues.includes(slackConfig.notifications?.[key])}
                      onChange={e => setSlackConfig(s => ({ ...s, notifications: { ...s.notifications, [key]: e.target.checked ? "instant" : "off" } }))}
                      className="w-5 h-5 accent-gray-900" />
                  </label>
                ))}
                <label className="flex items-center justify-between bg-white border border-gray-100 rounded-xl px-4 py-3 cursor-pointer">
                  <span className="text-sm text-gray-700 font-medium">📊 Resumen diario del pipeline</span>
                  <input type="checkbox" checked={!!slackConfig.notifications?.dailyDigest}
                    onChange={e => setSlackConfig(s => ({ ...s, notifications: { ...s.notifications, dailyDigest: e.target.checked } }))}
                    className="w-5 h-5 accent-gray-900" />
                </label>
              </div>
            )}
          </div>
        );

      case "done":
        return (
          <div className="text-center py-4 space-y-5">
            <div className="text-6xl">🎉</div>
            <div>
              <h2 className="text-3xl font-black text-gray-900 tracking-tight">¡Todo listo, {user?.displayName?.split(" ")[0] || ""}!</h2>
              <p className="text-gray-500 mt-3 leading-relaxed">Tu cuenta está configurada. Ya puedes crear tu primer proceso de selección.</p>
            </div>
            <div className="bg-gray-50 rounded-2xl p-5 text-left space-y-2">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Resumen</p>
              {(() => {
                const effective = brandChoice === "generate" ? generatedManual : brandManual;
                const words = effective ? effective.split(/\s+/).filter(Boolean).length : 0;
                const source = brandChoice === "generate" ? "generado con IA" : brandChoice === "upload" ? "desde documento" : brandChoice === "paste" ? "añadido a mano" : "";
                return <p className="text-sm text-gray-800">{effective ? "✅" : "⚪"} Manual de marca {effective ? `(${words} palabras · ${source})` : "— pendiente"}</p>;
              })()}
              <p className="text-sm text-gray-800">{emailProvider === "app" ? "✅ Email · RecruitAI Mail" : emailProvider === "resend_domain" ? "✅ Email · dominio propio" : "⚪ Email — pendiente"}</p>
              <p className="text-sm text-gray-800">{slackConfig.webhookUrl ? "✅ Slack conectado" : "⚪ Slack — pendiente"}</p>
            </div>
          </div>
        );

      default: return null;
    }
  };

  // ── Layout ─────────────────────────────────────────────────────────────────
  const isWelcome = current.id === "welcome";
  const isDone = current.id === "done";

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top bar */}
      <div className="px-6 py-5 flex justify-between items-center max-w-2xl mx-auto w-full">
        <span className="text-xl font-black text-gray-900 tracking-tight">RecruitAI</span>
        <span className="text-xs text-gray-400 font-medium">{safeStep + 1} de {flow.length}</span>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-start sm:items-center justify-center px-6 pb-8">
        <div className="max-w-lg w-full">
          {/* Section pill */}
          {current.section && (
            <div className="flex justify-center mb-5">
              <span className="text-xs font-semibold text-gray-600 bg-gray-100 rounded-full px-3 py-1.5">
                {current.section} · Pregunta {current.n} de {current.total}
              </span>
            </div>
          )}

          {/* Card */}
          <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8">
            {renderQuestion()}
          </div>

          {/* Footer nav */}
          <div className="flex justify-between items-center mt-5">
            {!isWelcome ? (
              <button onClick={back}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-900 font-medium transition-colors">
                ← Atrás
              </button>
            ) : <span />}

            {isDone ? (
              <button onClick={finish}
                className="px-6 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 transition-colors">
                🚀 Ir al dashboard
              </button>
            ) : (
              <button onClick={next} disabled={!canAdvance}
                className="px-6 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                {isWelcome ? "Comenzar →" : "Siguiente →"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SLACK HELPER ─────────────────────────────────────────────────────────────
async function sendSlackNotification(slackConfig, type, data) {
  const { webhookUrl, notifications } = slackConfig || {};
  if (!webhookUrl) return;
  const notifKey = { new_application: "newApplication", ai_evaluation: "aiEvaluation", final_decision: "finalDecision", daily_digest: "dailyDigest" }[type];
  const setting = notifications?.[notifKey];
  const isInstant = type === "daily_digest" ? true : (setting === "instant" || setting === "both");
  if (!isInstant && type !== "daily_digest") return;
  try {
    await fetch("/api/slackNotify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data, webhookUrl }),
    });
  } catch (e) { console.error("Slack notify error:", e); }
}

// ─── SLACK SETUP WIZARD ───────────────────────────────────────────────────────
function SlackSetupWizard({ slackConfig, onChange }) {
  const [webhookUrl, setWebhookUrl] = useState(slackConfig?.webhookUrl || "");
  const [channelName, setChannelName] = useState(slackConfig?.channelName || "");
  const [notifications, setNotifications] = useState(slackConfig?.notifications || {
    newApplication: "both", aiEvaluation: "instant", finalDecision: "both",
    dailyDigest: true,
  });
  const [testStatus, setTestStatus] = useState(null);
  const [showManual, setShowManual] = useState(false);

  const emit = (updates) => onChange({ webhookUrl, channelName, notifications, ...updates });
  const setNotif = (key, value) => {
    const n = { ...notifications, [key]: value };
    setNotifications(n); emit({ notifications: n });
  };

  const handleTest = async () => {
    if (!webhookUrl) return;
    setTestStatus("sending");
    try {
      const res = await fetch("/api/slackNotify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "new_application", webhookUrl, data: { candidateName: "Test Candidato", candidateEmail: "test@ejemplo.com", positionTitle: "Media Buyer", companyName: "Tu Agencia" } }),
      });
      const json = await res.json();
      setTestStatus(json.success ? "ok" : "error");
    } catch { setTestStatus("error"); }
    setTimeout(() => setTestStatus(null), 4000);
  };

  const handleAddToSlack = () => {
    window.location.href = "/api/slack/install";
  };

  const handleDisconnect = () => {
    setWebhookUrl(""); setChannelName("");
    emit({ webhookUrl: "", channelName: "" });
  };

  const NOTIF_OPTIONS = [
    { key: "newApplication", label: "🔔 Nueva solicitud", desc: "Cuando un candidato aplica a un proceso" },
    { key: "aiEvaluation", label: "🤖 Evaluación IA completada", desc: "Cuando la IA termina de analizar un ejercicio o entrevista" },
    { key: "finalDecision", label: "✅ Decisión final tomada", desc: "Cuando el reclutador decide contratar, descartar, etc." },
  ];

  // ── Connected state ────────────────────────────────────────────────────────
  if (webhookUrl) {
    return (
      <div className="space-y-5">
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <div>
              <p className="text-sm font-bold text-green-800">Slack conectado</p>
              {channelName && <p className="text-xs text-green-600">Canal: {channelName}</p>}
            </div>
          </div>
          <button onClick={handleDisconnect} className="text-xs text-red-400 hover:text-red-600 hover:underline">Desconectar</button>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleTest} disabled={testStatus === "sending"}
            className="px-4 py-2 bg-gray-800 text-white rounded-xl text-sm font-bold hover:bg-gray-900 disabled:opacity-40">
            {testStatus === "sending" ? "Enviando..." : "📨 Enviar mensaje de prueba"}
          </button>
          {testStatus === "ok" && <p className="text-xs text-green-600 font-medium">✅ ¡Mensaje recibido en Slack!</p>}
          {testStatus === "error" && <p className="text-xs text-red-500">✗ Error. Revisa la webhook URL.</p>}
        </div>

        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-700">¿Cuándo quieres recibir notificaciones?</p>
          {NOTIF_OPTIONS.map(({ key, label, desc }) => (
            <div key={key} className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div>
                <p className="text-sm font-semibold text-gray-800">{label}</p>
                <p className="text-xs text-gray-500">{desc}</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                {[
                  { val: "none", icon: "🔕", text: "Ninguna" },
                  { val: "instant", icon: "⚡", text: "Al momento" },
                  { val: "daily", icon: "📅", text: "Resumen diario" },
                  { val: "both", icon: "✨", text: "Ambas" },
                ].map(({ val, icon, text }) => (
                  <button key={val} onClick={() => setNotif(key, val)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${notifications[key] === val ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
                    {icon} {text}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-800">📊 Resumen diario del pipeline</p>
                <p className="text-xs text-gray-500">Estado general de todos los procesos activos, enviado al abrir la app cada día</p>
              </div>
              <button onClick={() => setNotif("dailyDigest", !notifications.dailyDigest)}
                className={`w-12 h-6 rounded-full transition-all relative ${notifications.dailyDigest ? "bg-gray-900" : "bg-gray-300"}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow absolute top-0.5 transition-all ${notifications.dailyDigest ? "left-6" : "left-0.5"}`} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Not connected state ────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Primary: Add to Slack OAuth button */}
      <div className="rounded-2xl p-6 text-center space-y-4" style={{ background: "#4A154B" }}>
        <div className="text-4xl">💬</div>
        <p className="text-white font-bold text-base">Conecta RecruitAI con tu Slack</p>
        <p className="text-sm" style={{ color: "#c9b3ca" }}>Elige un canal y listo. Sin configuraciones técnicas.</p>
        <button onClick={handleAddToSlack}
          className="inline-flex items-center gap-2 bg-white font-bold px-6 py-3 rounded-xl hover:bg-gray-100 transition-all text-sm"
          style={{ color: "#4A154B" }}>
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
            <path d="M6.194 14.144c0 1.073-.87 1.944-1.943 1.944-1.073 0-1.943-.87-1.943-1.944 0-1.072.87-1.942 1.943-1.942h1.943v1.942zm.974 0c0-1.072.87-1.942 1.943-1.942s1.943.87 1.943 1.942v4.862c0 1.073-.87 1.943-1.943 1.943s-1.943-.87-1.943-1.943v-4.862zM9.111 6.2c-1.073 0-1.943-.87-1.943-1.943 0-1.073.87-1.943 1.943-1.943s1.943.87 1.943 1.943v1.943H9.11zm0 .974c1.073 0 1.943.87 1.943 1.942 0 1.073-.87 1.944-1.943 1.944H4.25c-1.073 0-1.944-.87-1.944-1.944 0-1.072.87-1.942 1.944-1.942h4.862zm7.906 1.942c0-1.072.87-1.942 1.943-1.942 1.073 0 1.943.87 1.943 1.942 0 1.073-.87 1.944-1.943 1.944h-1.943V9.116zm-.974 0c0 1.073-.87 1.944-1.943 1.944s-1.943-.87-1.943-1.944V4.254c0-1.073.87-1.943 1.943-1.943s1.943.87 1.943 1.943v4.862zm-1.943 7.9c1.073 0 1.943.87 1.943 1.944 0 1.073-.87 1.943-1.943 1.943s-1.943-.87-1.943-1.943v-1.943h1.943zm0-.974c-1.073 0-1.943-.87-1.943-1.942 0-1.073.87-1.944 1.943-1.944h4.862c1.073 0 1.943.87 1.943 1.944 0 1.072-.87 1.942-1.943 1.942H14.1z"/>
          </svg>
          Añadir a Slack
        </button>
      </div>

      {/* Manual fallback (collapsed by default) */}
      <div>
        <button onClick={() => setShowManual(v => !v)} className="text-xs text-gray-400 hover:text-gray-600 underline">
          {showManual ? "Ocultar opción manual ↑" : "¿Prefieres introducir la URL manualmente? →"}
        </button>
        {showManual && (
          <div className="mt-3 space-y-3">
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-xs text-gray-600 space-y-1.5">
              <p className="font-semibold text-gray-700">Para obtener la Webhook URL manualmente:</p>
              <p>1. Ve a <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="text-gray-900 underline">api.slack.com/apps</a> → Create New App → From scratch</p>
              <p>2. Activa "Incoming Webhooks" en el menú lateral</p>
              <p>3. Clic en "Add New Webhook to Workspace" → elige el canal</p>
              <p>4. Copia la URL que empieza por hooks.slack.com...</p>
            </div>
            <div>
              <label className={lbl}>Webhook URL</label>
              <input className={inp} type="url" placeholder="https://hooks.slack.com/services/..."
                value={webhookUrl} onChange={e => { setWebhookUrl(e.target.value); emit({ webhookUrl: e.target.value }); }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AGENCY SETTINGS MODAL ───────────────────────────────────────────────────
function AgencySettingsModal({ settings, onSave, onClose, initialSection = "marca" }) {
  const [section, setSection] = useState(initialSection);
  const [brandManual, setBrandManual] = useState(settings?.brandManual || "");
  const [brandTab, setBrandTab] = useState("text");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fileName, setFileName] = useState("");
  const [emailConfig, setEmailConfig] = useState(settings?.emailConfig || { provider: "none" });
  const [slackConfig, setSlackConfig] = useState(settings?.slackConfig || { webhookUrl: "", notifications: { newApplication: "both", aiEvaluation: "instant", finalDecision: "both", dailyDigest: true } });
  const fileRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploadError(""); setUploading(true); setFileName(file.name);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "txt") { setBrandManual(await file.text()); setBrandTab("text"); }
      else if (ext === "docx") { const mammoth = await import("mammoth"); const r = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() }); setBrandManual(r.value); setBrandTab("text"); }
      else if (ext === "pdf") {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let t = ""; for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const ct = await pg.getTextContent(); t += ct.items.map(x => x.str).join(" ") + "\n"; }
        setBrandManual(t.trim()); setBrandTab("text");
      } else { setUploadError("Formato no soportado. Usa .txt, .docx o .pdf"); }
    } catch { setUploadError("Error al leer. Prueba con .txt."); }
    setUploading(false);
  };

  const handleSave = () => { onSave({ brandManual, emailConfig, slackConfig }); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="font-bold text-gray-800">⚙️ Configuración de agencia</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-gray-100 shrink-0">
          {[["marca", "🎨 Marca"], ["email", "📧 Email"], ["slack", "🔔 Slack"]].map(([id, label]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`flex-1 py-3 text-sm font-semibold transition-colors ${section === id ? "border-b-2 border-gray-900 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 p-6 space-y-4">

          {/* ── MARCA ── */}
          {section === "marca" && (
            <>
              <div className="flex gap-2 bg-gray-100 p-1 rounded-xl">
                {[["text", "✏️ Escribir / Pegar"], ["upload", "📄 Subir documento"]].map(([id, label]) => (
                  <button key={id} onClick={() => setBrandTab(id)}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${brandTab === id ? "bg-white shadow text-gray-800" : "text-gray-500 hover:text-gray-700"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {brandTab === "text" && (
                <div>
                  <label className={lbl}>Manual de marca / Valores de la agencia</label>
                  <textarea className={inp} rows={10} value={brandManual} onChange={e => setBrandManual(e.target.value)}
                    placeholder={"Pega aquí tu manual de marca o los valores clave de tu agencia.\n\nEjemplo:\n- Somos una agencia orientada a resultados medibles...\n- Buscamos perfiles que se alineen con nuestros valores de...\n- Tono: cercano, profesional, directo..."} />
                  {fileName && <p className="text-xs text-green-600 mt-1">✓ Extraído de: {fileName}</p>}
                  <p className="text-xs text-gray-400 mt-1">La IA usará este texto para evaluar la alineación cultural de cada candidato.</p>
                </div>
              )}
              {brandTab === "upload" && (
                <div>
                  <div onClick={() => fileRef.current?.click()}
                    className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-gray-300 hover:bg-gray-50 transition-all">
                    {uploading ? <p className="text-sm text-gray-900 font-medium">Extrayendo texto...</p> : (
                      <><p className="text-3xl mb-2">📁</p>
                        <p className="text-sm font-medium text-gray-700">Haz clic para seleccionar archivo</p>
                        <p className="text-xs text-gray-400 mt-1">Formatos: .txt, .docx, .pdf</p></>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept=".txt,.docx,.pdf" onChange={handleFile} className="hidden" />
                  {uploadError && <p className="text-xs text-red-500 mt-2">{uploadError}</p>}
                </div>
              )}
            </>
          )}

          {/* ── EMAIL ── */}
          {section === "email" && (
            <EmailSetupWizard emailConfig={emailConfig} onChange={setEmailConfig} />
          )}

          {/* ── SLACK ── */}
          {section === "slack" && (
            <SlackSetupWizard slackConfig={slackConfig} onChange={setSlackConfig} />
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50">Cancelar</button>
          <button onClick={handleSave} className="flex-1 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800">Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ─── CANDIDATE EVALUATION PANEL ──────────────────────────────────────────────
const REC_COLORS = {
  AVANZAR: "bg-green-100 text-green-800", REVISAR: "bg-yellow-100 text-yellow-800",
  DESCARTAR: "bg-red-100 text-red-700", CONTRATAR: "bg-emerald-100 text-emerald-800",
  SEGUNDA_ENTREVISTA: "bg-gray-100 text-gray-700", EN_CARTERA: "bg-yellow-100 text-yellow-800",
};
const REC_LABELS = {
  AVANZAR: "✅ Avanzar", REVISAR: "⚠️ Revisar", DESCARTAR: "❌ Descartar",
  CONTRATAR: "🎉 Contratar", SEGUNDA_ENTREVISTA: "🔄 Segunda entrevista", EN_CARTERA: "📁 En cartera",
};

function CandidateEvaluationPanel({ candidate, process, agencySettings, onUpdateCandidate, onClose }) {
  const [tab, setTab] = useState("exercise");
  const [evaluatingEx, setEvaluatingEx] = useState(false);
  const [evaluatingInt, setEvaluatingInt] = useState(false);
  const [interviewTranscript, setInterviewTranscript] = useState(candidate.interviewTranscript || "");
  const [error, setError] = useState(null);
  // Decision + reevaluation confirmations — prevent accidental destructive/
  // external-effect actions (sending emails to candidates, wiping evaluations).
  const [pendingDecision, setPendingDecision] = useState(null);
  const [pendingReeval, setPendingReeval] = useState(null); // "exercise" | "interview"

  const exerciseEval = candidate.exerciseEvaluation;
  const interviewEval = candidate.interviewEvaluation;
  const responses = candidate.responses || [];
  const position = getPositionTitle(process.position);

  const evaluateExercise = async () => {
    setEvaluatingEx(true); setError(null);
    try {
      const exercises = process.exercises || [];
      if (exercises.length === 0) throw new Error("Este proceso no tiene ejercicios definidos.");

      // Evaluate each exercise individually with its own criteria. Running
      // sequentially keeps the Claude API rate comfortable and the UX
      // predictable (one fail doesn't corrupt the whole set).
      const perExercise = [];
      for (const exercise of exercises) {
        const response = responses.find(r => r.exerciseId === exercise.id) || {};
        const res = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "exercise",
            data: {
              exerciseTitle: exercise.title || "Ejercicio",
              exerciseDescription: exercise.description || "",
              criteria: exercise.criteria || [],
              writtenResponse: response.response || "",
              loomUrl: response.loomUrl || "",
              position,
              brandManual: agencySettings?.brandManual || "",
              companyName: process.company?.name || "",
            },
          }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error);
        perExercise.push({
          exerciseId: exercise.id,
          exerciseTitle: exercise.title,
          loomTranscriptFetched: !!json.loomTranscriptFetched,
          ...json.evaluation,
        });
      }

      // Aggregate: single summary object for the overview panel + detailed
      // per-exercise list for the expandable breakdown.
      const validEvals = perExercise.filter(e => e && typeof e.overall === "number");
      const aggOverall = validEvals.length > 0
        ? Math.round(validEvals.reduce((s, e) => s + (e.overall || 0), 0) / validEvals.length)
        : 0;
      // Pick the WORST recommendation across exercises (conservative).
      const recWeight = { AVANZAR: 2, REVISAR: 1, DESCARTAR: 0 };
      const worstRec = validEvals
        .map(e => e.recommendation)
        .filter(r => r in recWeight)
        .sort((a, b) => recWeight[a] - recWeight[b])[0] || "REVISAR";
      const allStrengths = [...new Set(perExercise.flatMap(e => e.strengths || []))].slice(0, 6);
      const allGaps = [...new Set(perExercise.flatMap(e => e.gaps || []))].slice(0, 6);
      const aggSummary = perExercise
        .map(e => `${e.exerciseTitle}: ${e.summary || "—"}`)
        .join(" · ");

      const aggregate = {
        overall: aggOverall,
        recommendation: worstRec,
        strengths: allStrengths,
        gaps: allGaps,
        summary: aggSummary,
        // Expose the per-exercise breakdown so the panel can render details.
        exercises: perExercise,
      };

      onUpdateCandidate({ ...candidate, exerciseEvaluation: aggregate });
      sendSlackNotification(agencySettings?.slackConfig, "ai_evaluation", {
        candidateName: candidate.name, positionTitle: position,
        evaluationType: "exercise", recommendation: aggregate.recommendation,
      });
    } catch (e) { setError("Error al evaluar: " + e.message); }
    setEvaluatingEx(false);
  };

  const evaluateInterview = async () => {
    if (!interviewTranscript.trim()) return;
    setEvaluatingInt(true); setError(null);
    try {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "interview",
          data: { transcript: interviewTranscript, position, brandManual: agencySettings?.brandManual || "", companyName: process.company?.name || "" },
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      onUpdateCandidate({ ...candidate, interviewEvaluation: json.evaluation, interviewTranscript });
      // Slack notification
      sendSlackNotification(agencySettings?.slackConfig, "ai_evaluation", {
        candidateName: candidate.name, positionTitle: position,
        evaluationType: "interview", recommendation: json.evaluation?.candidate?.overall?.recommendation,
        score: json.evaluation?.candidate?.weights ? Math.round(json.evaluation.candidate.weights.reduce((s, w) => s + (w.score * w.weight / 100), 0)) : null,
      });
    } catch (e) { setError("Error al evaluar: " + e.message); }
    setEvaluatingInt(false);
  };

  const setFinalDecision = async (decision) => {
    const finalStates = ["Contratado", "Descartado", "En cartera"];
    const update = { ...candidate, estado: decision, finalDecision: decision };
    if (finalStates.includes(decision) && !candidate.decidedAt) {
      update.decidedAt = new Date().toISOString();
    }
    onUpdateCandidate(update);

    const emailTypeMap = {
      "Contratado": "decision_contratado",
      "Segunda entrevista": "decision_segunda_entrevista",
      "En cartera": "decision_en_cartera",
      "Descartado": "decision_descartado",
    };
    const emailType = emailTypeMap[decision];
    const emailConfig = agencySettings?.emailConfig || { provider: "none" };
    if (!emailType || !candidate.email || emailConfig.provider === "none") return;

    try {
      await fetch("/api/sendEmail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: emailType,
          emailConfig,
          data: {
            candidateName: candidate.name || "Candidato",
            candidateEmail: candidate.email,
            companyName: process.company?.name || "La empresa",
            positionTitle: getPositionTitle(process.position) || process.positionType || "la posición",
            schedulingUrl: process?.schedulingUrl || "",
          },
        }),
      });
    } catch (e) { console.error("Email error:", e); }

    // Slack notification
    sendSlackNotification(agencySettings?.slackConfig, "final_decision", {
      candidateName: candidate.name || "Candidato",
      positionTitle: getPositionTitle(process.position) || process.positionType || "la posición",
      decision,
    });
  };

  const weightedScore = interviewEval?.candidate?.weights
    ? Math.round(interviewEval.candidate.weights.reduce((s, w) => s + (w.score * w.weight / 100), 0))
    : null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div>
            <h2 className="font-bold text-gray-900">{candidate.name}</h2>
            <p className="text-xs text-gray-400">{candidate.email} · {position}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 shrink-0">
          {[["exercise", "🎯 Ejercicio"], ["interview", "🎤 Entrevista"], ["decision", "✅ Decisión"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${tab === id ? "border-b-2 border-gray-900 text-gray-900" : "text-gray-400 hover:text-gray-600"}`}>{label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700">{error}</div>}

          {/* ── EXERCISE TAB ── */}
          {tab === "exercise" && (
            <div className="space-y-4">
              {responses.length === 0 ? (
                <div className="text-center py-8 text-gray-400"><p className="text-2xl mb-2">📋</p><p className="text-sm">Este candidato no envió su ejercicio a través del link público.</p></div>
              ) : (
                <>
                  {responses.map((r, i) => {
                    const ex = process.exercises?.find(e => e.id === r.exerciseId) || process.exercises?.[i] || {};
                    return (
                      <div key={i} className="border border-gray-100 rounded-xl p-4 bg-gray-50">
                        <p className="font-semibold text-gray-800 text-sm mb-2">{ex.title || `Ejercicio ${i + 1}`}</p>
                        <p className="text-xs text-gray-500 mb-3 whitespace-pre-wrap line-clamp-3">{r.response}</p>
                        {r.loomUrl && <a href={r.loomUrl} target="_blank" rel="noreferrer" className="text-xs text-gray-900 hover:underline flex items-center gap-1">🎥 Ver vídeo de defensa en Loom →</a>}
                      </div>
                    );
                  })}
                  {!exerciseEval && (
                    <button onClick={evaluateExercise} disabled={evaluatingEx} className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                      {evaluatingEx ? "🤖 Evaluando con IA..." : "🤖 Evaluar ejercicio con IA"}
                    </button>
                  )}
                </>
              )}

              {exerciseEval && (
                <div className="space-y-3">
                  {/* Overall aggregate across all exercises */}
                  <div className="flex items-center justify-between bg-indigo-50 rounded-xl p-4">
                    <div className="min-w-0 flex-1 pr-3">
                      <p className="font-bold text-indigo-800">Resultado global</p>
                      <p className="text-xs text-indigo-500 mt-0.5 line-clamp-3">{exerciseEval.summary}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-3xl font-black text-indigo-700">{exerciseEval.overall}<span className="text-sm font-medium text-indigo-400">/100</span></p>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${REC_COLORS[exerciseEval.recommendation] || "bg-gray-100 text-gray-700"}`}>{REC_LABELS[exerciseEval.recommendation] || exerciseEval.recommendation}</span>
                    </div>
                  </div>

                  {/* Per-exercise breakdown (new multi-exercise format) */}
                  {exerciseEval.exercises && exerciseEval.exercises.length > 0 ? (
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Desglose por ejercicio</p>
                      {exerciseEval.exercises.map((ex, idx) => (
                        <div key={ex.exerciseId || idx} className="bg-white border border-gray-100 rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-gray-400">#{idx + 1}</p>
                              <p className="text-sm font-bold text-gray-800">{ex.exerciseTitle}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-lg font-black text-indigo-700">{ex.overall}<span className="text-xs font-medium text-gray-400">/100</span></p>
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${REC_COLORS[ex.recommendation] || "bg-gray-100 text-gray-700"}`}>{REC_LABELS[ex.recommendation] || ex.recommendation}</span>
                            </div>
                          </div>
                          <p className="text-xs text-gray-500 mb-2 leading-relaxed">{ex.summary}</p>
                          <div className="space-y-1.5">
                            {(ex.criteria || []).map((c, i) => (
                              <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg p-2">
                                <div className="shrink-0 w-9 rounded text-center font-black text-gray-700 text-xs py-1">
                                  {c.score}<span className="text-[9px] text-gray-400">/{c.maxScore || 5}</span>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-[11px] font-bold text-gray-700">{c.name}</p>
                                  <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{c.feedback}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                          {ex.loomTranscriptFetched && (
                            <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1"><span>🎥</span> Transcripción de Loom incluida</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    /* Legacy single-exercise format (backward compat) */
                    <div className="space-y-2">
                      {(exerciseEval.criteria || []).map((c, i) => (
                        <div key={i} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl p-3">
                          <div className="shrink-0 w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center font-black text-gray-700">{c.score}<span className="text-xs text-gray-400">/{c.maxScore || 10}</span></div>
                          <div className="flex-1 min-w-0"><p className="text-xs font-bold text-gray-700">{c.name}</p><p className="text-xs text-gray-500 mt-0.5">{c.feedback}</p></div>
                        </div>
                      ))}
                    </div>
                  )}

                  {exerciseEval.strengths?.length > 0 && <div className="bg-green-50 rounded-xl p-3"><p className="text-xs font-bold text-green-700 mb-1">✅ Puntos fuertes</p>{exerciseEval.strengths.map((s, i) => <p key={i} className="text-xs text-green-600">· {s}</p>)}</div>}
                  {exerciseEval.gaps?.length > 0 && <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs font-bold text-gray-800 mb-1">⚠️ Áreas de mejora</p>{exerciseEval.gaps.map((s, i) => <p key={i} className="text-xs text-gray-900">· {s}</p>)}</div>}
                  <button onClick={() => setPendingReeval("exercise")} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">Reevaluar</button>
                </div>
              )}
            </div>
          )}

          {/* ── INTERVIEW TAB ── */}
          {tab === "interview" && (
            <div className="space-y-4">
              {!interviewEval ? (
                <>
                  <div>
                    <label className={lbl}>Transcripción de la entrevista</label>
                    <textarea className={inp} rows={10} value={interviewTranscript} onChange={e => setInterviewTranscript(e.target.value)}
                      placeholder={"Pega aquí la transcripción completa de la entrevista.\n\nCompatible con:\n· Granola\n· Google Meet (Gemini)\n· Zoom AI\n· Fathom, Otter, etc.\n\nFormato: texto plano, con turnos de palabra si es posible."} />
                    <p className="text-xs text-gray-400 mt-1">{interviewTranscript.split(/\s+/).filter(Boolean).length} palabras</p>
                  </div>
                  <button onClick={evaluateInterview} disabled={evaluatingInt || !interviewTranscript.trim()} className="w-full py-3 bg-purple-600 text-white rounded-xl font-bold hover:bg-purple-700 disabled:opacity-50 transition-colors">
                    {evaluatingInt ? "🤖 Analizando entrevista..." : "🤖 Analizar entrevista con IA"}
                  </button>
                </>
              ) : (
                <div className="space-y-4">
                  {/* Candidate analysis */}
                  <div className="bg-purple-50 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="font-bold text-purple-800">Análisis del candidato</p>
                      <div className="text-right"><p className="text-2xl font-black text-purple-700">{weightedScore ?? interviewEval.candidate?.overall}<span className="text-sm font-medium text-purple-400">%</span></p><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${REC_COLORS[interviewEval.candidate?.recommendation] || "bg-gray-100 text-gray-700"}`}>{REC_LABELS[interviewEval.candidate?.recommendation] || interviewEval.candidate?.recommendation}</span></div>
                    </div>
                    <p className="text-xs text-purple-600 mb-3">{interviewEval.candidate?.summary}</p>
                    <div className="space-y-2">
                      {(interviewEval.candidate?.weights || []).map((w, i) => (
                        <div key={i} className="bg-white rounded-lg p-2.5 flex items-start gap-2">
                          <div className="shrink-0 text-right"><p className="text-sm font-black text-gray-700">{w.score}<span className="text-xs text-gray-400">%</span></p><p className="text-xs text-gray-400">×{w.weight}%</p></div>
                          <div><p className="text-xs font-bold text-gray-700">{w.name}</p><p className="text-xs text-gray-500">{w.feedback}</p></div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Sections */}
                  {(interviewEval.candidate?.sections || []).length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Por secciones</p>
                      {interviewEval.candidate.sections.map((s, i) => (
                        <div key={i} className="bg-white border border-gray-100 rounded-xl p-3"><p className="text-xs font-bold text-gray-700 mb-1">{s.name}</p><p className="text-xs text-gray-500">{s.feedback}</p></div>
                      ))}
                    </div>
                  )}
                  {/* Interviewer analysis */}
                  {interviewEval.interviewer && (
                    <div className="bg-slate-50 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-2"><p className="font-bold text-slate-700 text-sm">Análisis del entrevistador</p><span className="text-lg font-black text-slate-600">{interviewEval.interviewer.overall_score}<span className="text-xs text-slate-400">/100</span></span></div>
                      <p className="text-xs text-slate-500 mb-2">{interviewEval.interviewer.summary}</p>
                      {(interviewEval.interviewer.strengths || []).length > 0 && <div className="mb-2">{interviewEval.interviewer.strengths.map((s, i) => <p key={i} className="text-xs text-green-600">✓ {s}</p>)}</div>}
                      {(interviewEval.interviewer.improvements || []).length > 0 && <div>{interviewEval.interviewer.improvements.map((s, i) => <p key={i} className="text-xs text-gray-900">→ {s}</p>)}</div>}
                    </div>
                  )}
                  <button onClick={() => setPendingReeval("interview")} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">Reevaluar entrevista</button>
                </div>
              )}
            </div>
          )}

          {/* ── DECISION TAB ── */}
          {tab === "decision" && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Resumen de evaluaciones</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white rounded-xl p-3 text-center border border-gray-100">
                    <p className="text-xs text-gray-400 mb-1">Ejercicio</p>
                    {exerciseEval ? <><p className="text-2xl font-black text-indigo-700">{exerciseEval.overall}</p><span className={`text-xs px-2 py-0.5 rounded-full ${REC_COLORS[exerciseEval.recommendation] || "bg-gray-100 text-gray-700"}`}>{REC_LABELS[exerciseEval.recommendation] || "—"}</span></> : <p className="text-gray-400 text-sm">Sin evaluar</p>}
                  </div>
                  <div className="bg-white rounded-xl p-3 text-center border border-gray-100">
                    <p className="text-xs text-gray-400 mb-1">Entrevista</p>
                    {interviewEval ? <><p className="text-2xl font-black text-purple-700">{weightedScore ?? interviewEval.candidate?.overall}</p><span className={`text-xs px-2 py-0.5 rounded-full ${REC_COLORS[interviewEval.candidate?.recommendation] || "bg-gray-100 text-gray-700"}`}>{REC_LABELS[interviewEval.candidate?.recommendation] || "—"}</span></> : <p className="text-gray-400 text-sm">Sin evaluar</p>}
                  </div>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Tu decisión final</p>
                <div className="grid grid-cols-2 gap-2">
                  {[["Contratado", "🎉 Contratar", "bg-green-600 hover:bg-green-700 text-white"], ["Segunda entrevista", "🔄 Segunda entrevista", "bg-gray-900 hover:bg-gray-800 text-white"], ["En cartera", "📁 En cartera", "bg-yellow-500 hover:bg-yellow-600 text-white"], ["Descartado", "❌ Descartar", "bg-red-500 hover:bg-red-600 text-white"]].map(([val, label, cls]) => (
                    <button key={val} onClick={() => setPendingDecision(val)} className={`py-3 rounded-xl font-bold text-sm transition-colors ${cls} ${candidate.estado === val ? "ring-4 ring-offset-2 ring-gray-300" : ""}`}>{label}</button>
                  ))}
                </div>
                {candidate.finalDecision && <p className="text-xs text-center text-gray-400 mt-3">Decisión registrada: <strong>{candidate.finalDecision}</strong></p>}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Decision confirmation modal ─── */}
      {(() => {
        if (!pendingDecision) return null;
        const DECISION_PREVIEW = {
          "Contratado": {
            icon: "🎉", title: "¿Confirmar oferta de trabajo?", subject: "¡Enhorabuena! Oferta de trabajo",
            impact: "Le notificaremos al candidato por email que tiene una oferta. Este suele ser el paso previo a la firma.",
            confirmLabel: "Sí, enviar oferta", confirmStyle: "bg-green-600 hover:bg-green-700",
          },
          "Segunda entrevista": {
            icon: "🔄", title: "¿Invitar a segunda entrevista?", subject: "Siguiente paso en tu proceso",
            impact: "El candidato recibirá un email invitándole a continuar con una segunda entrevista (con el link de agendamiento si lo tienes configurado).",
            confirmLabel: "Sí, enviar invitación", confirmStyle: "bg-gray-900 hover:bg-gray-800",
          },
          "En cartera": {
            icon: "📁", title: "¿Guardar en cartera?", subject: `Tu candidatura en ${process.company?.name || "la empresa"}`,
            impact: "El candidato recibirá un email avisándole de que su perfil queda en base de talento para futuras oportunidades.",
            confirmLabel: "Sí, guardar", confirmStyle: "bg-yellow-500 hover:bg-yellow-600",
          },
          "Descartado": {
            icon: "❌", title: "¿Descartar al candidato?", subject: "Actualización sobre tu candidatura",
            impact: "El candidato recibirá un email informándole de que el proceso continúa con otros perfiles. Este paso cierra el proceso para esta persona.",
            confirmLabel: "Sí, descartar", confirmStyle: "bg-red-500 hover:bg-red-600",
          },
        };
        const p = DECISION_PREVIEW[pendingDecision];
        if (!p) return null;
        const emailConfig = agencySettings?.emailConfig || { provider: "none" };
        const emailWillBeSent = !!candidate.email && emailConfig.provider !== "none";
        return (
          <ConfirmModal
            open={true}
            onClose={() => setPendingDecision(null)}
            onConfirm={() => { setFinalDecision(pendingDecision); setPendingDecision(null); }}
            icon={p.icon}
            title={p.title}
            description={`Candidato: ${candidate.name}`}
            confirmLabel={p.confirmLabel}
            confirmStyle={p.confirmStyle}
          >
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 space-y-3 mt-3">
              <div>
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">Qué pasará</p>
                <p className="text-sm text-gray-700 leading-relaxed">{p.impact}</p>
              </div>
              {emailWillBeSent ? (
                <div className="flex items-start gap-2 pt-3 border-t border-gray-200">
                  <span className="text-base shrink-0">📧</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500">Email automático a <strong className="text-gray-800">{candidate.email}</strong></p>
                    <p className="text-xs text-gray-700 mt-0.5 italic truncate">"{p.subject} – {position}"</p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 pt-3 border-t border-gray-200">
                  <span className="text-base shrink-0">ℹ️</span>
                  <p className="text-xs text-gray-500">{!candidate.email ? "Sin email del candidato, no se enviará notificación." : "Email no configurado en tu agencia, no se enviará notificación."}</p>
                </div>
              )}
              {candidate.estado && candidate.estado !== pendingDecision && (
                <p className="text-xs text-gray-400 pt-2 border-t border-gray-200">
                  Estado: <strong>{candidate.estado}</strong> → <strong>{pendingDecision}</strong>
                </p>
              )}
            </div>
          </ConfirmModal>
        );
      })()}

      {/* ── Reevaluation confirmation ─── */}
      <ConfirmModal
        open={!!pendingReeval}
        onClose={() => setPendingReeval(null)}
        onConfirm={() => {
          if (pendingReeval === "exercise") {
            onUpdateCandidate({ ...candidate, exerciseEvaluation: null });
          } else if (pendingReeval === "interview") {
            onUpdateCandidate({ ...candidate, interviewEvaluation: null, interviewTranscript: "" });
            setInterviewTranscript("");
          }
          setPendingReeval(null);
        }}
        icon="🔄"
        title={pendingReeval === "exercise" ? "¿Volver a evaluar el ejercicio?" : "¿Volver a evaluar la entrevista?"}
        description={
          pendingReeval === "exercise"
            ? "Se borrará la evaluación actual del ejercicio. Podrás generar una nueva llamada a la IA."
            : "Se borrará la evaluación actual de la entrevista y su transcripción. Podrás pegar una nueva."
        }
        confirmLabel="Sí, empezar de nuevo"
      />
    </div>
  );
}

// ─── PIPELINE CONSTANTS ───────────────────────────────────────────────────────
const ESTADO_OPTIONS = ["Pendiente", "Primera entrevista", "Segunda entrevista", "En cartera", "Descartado", "Contratado"];
const PROGRESO_OPTIONS = ["Ingreso", "Prueba técnica", "Entrevista", "Onboarding", "Descalificado", "En cartera", "Desiste", "Validación prueba técnica", "Entrevista RRHH"];
const ESTADO_COLORS = { "Pendiente": "bg-gray-100 text-gray-700", "Primera entrevista": "bg-gray-100 text-gray-800", "Segunda entrevista": "bg-indigo-100 text-indigo-700", "En cartera": "bg-yellow-100 text-yellow-700", "Descartado": "bg-red-100 text-red-700", "Contratado": "bg-green-100 text-green-700" };
const PROGRESO_COLORS = { "Ingreso": "bg-purple-100 text-purple-700", "Prueba técnica": "bg-gray-100 text-gray-800", "Entrevista": "bg-indigo-100 text-indigo-700", "Onboarding": "bg-teal-100 text-teal-700", "Descalificado": "bg-red-100 text-red-700", "En cartera": "bg-yellow-100 text-yellow-700", "Desiste": "bg-gray-100 text-gray-800", "Validación prueba técnica": "bg-cyan-100 text-cyan-700", "Entrevista RRHH": "bg-violet-100 text-violet-700" };

// ─── PROCESS DETAIL SCREEN ───────────────────────────────────────────────────
function ProcessDetailScreen({ process, onBack, onUpdate, onUpdateProcess, user, onStartDemo, agencySettings, onOpenSettings, autoShareOnEntry, clearAutoShare }) {
  // What's required before the user can generate a public link / receive candidates.
  // brandManual + emailConfig are blocking (IA needs context, candidates need confirmations).
  // Slack is considered a nice-to-have, not blocking.
  const hasBrand = !!(agencySettings?.brandManual && agencySettings.brandManual.trim());
  const hasEmail = agencySettings?.emailConfig?.provider && agencySettings.emailConfig.provider !== "none";
  const missingForPublish = [
    !hasBrand && { label: "Manual de marca", hint: "Sin esto la IA no puede evaluar la compatibilidad cultural de los candidatos." },
    !hasEmail && { label: "Email", hint: "Sin esto los candidatos no reciben confirmación al aplicar ni los mensajes de decisión final." },
  ].filter(Boolean);
  const [showMissingConfigModal, setShowMissingConfigModal] = useState(false);
  const [candidates, setCandidates] = useState((process.candidates || []).map(c => ({ estado: "Pendiente", progreso: "Ingreso", entrevistador: "", notas: "", ...c })));
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [publicLink, setPublicLink] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [evalCandidate, setEvalCandidate] = useState(null);

  const FINAL_ESTADOS = ["Contratado", "Descartado", "En cartera"];
  const updateCandidate = (id, field, value) => {
    const u = candidates.map(c => {
      if (c.id !== id) return c;
      const next = { ...c, [field]: value };
      // Stamp decidedAt when the candidate reaches a terminal state for the first time.
      // Used by the analytics panel to compute average time-to-decision.
      if (field === "estado" && FINAL_ESTADOS.includes(value) && !c.decidedAt) {
        next.decidedAt = new Date().toISOString();
      }
      return next;
    });
    setCandidates(u); onUpdate(process.id, u);
  };
  const updateCandidateFull = (updated) => { const u = candidates.map(c => c.id === updated.id ? updated : c); setCandidates(u); onUpdate(process.id, u); if (evalCandidate?.id === updated.id) setEvalCandidate(updated); };
  const addCandidate = () => { if (!newName.trim()) return; const nc = { id: `c_${Date.now()}`, name: newName.trim(), email: newEmail.trim(), phase: "applied", estado: "Pendiente", progreso: "Ingreso", entrevistador: user?.displayName || "", notas: "" }; const u = [...candidates, nc]; setCandidates(u); onUpdate(process.id, u); setNewName(""); setNewEmail(""); setShowAddForm(false); };
  const [removeTarget, setRemoveTarget] = useState(null);
  const requestRemoveCandidate = (c) => setRemoveTarget(c);
  const confirmRemoveCandidate = () => {
    if (!removeTarget) return;
    const u = candidates.filter(c => c.id !== removeTarget.id);
    setCandidates(u); onUpdate(process.id, u);
    setRemoveTarget(null);
  };

  const generatePublicLink = async () => {
    // Block public publication until minimum config is set.
    if (missingForPublish.length > 0) {
      setShowMissingConfigModal(true);
      return;
    }
    setPublishing(true);
    try {
      // Strip secrets before writing to the public document.
      // publicProcesses/{id} is readable by anyone — never expose API keys or webhooks.
      const ec = agencySettings?.emailConfig || { provider: "none" };
      const publicEmailConfig = {
        provider: ec.provider || "none",
        fromName: ec.fromName || "",
        fromEmail: ec.fromEmail || "",
      };
      const sc = agencySettings?.slackConfig || {};
      const publicSlackConfig = {
        // Webhook URL is sensitive: anyone with it can post to the Slack channel.
        // Keep only notification preferences; the server will look up the real webhook
        // from the recruiter's private doc when needed.
        notifications: sc.notifications || {},
      };

      await setDoc(doc(db, "publicProcesses", process.id), {
        ...process,
        recruiterUid: user?.uid || "",
        publishedAt: new Date().toISOString(),
        recruiterEmail: user?.email || "",
        recruiterName: user?.displayName || "Equipo de selección",
        emailConfig: publicEmailConfig,
        slackConfig: publicSlackConfig,
      });
      const url = `${window.location.origin}/#apply/${process.id}`;
      setPublicLink(url);
      await navigator.clipboard.writeText(url);
      setLinkCopied(true); setTimeout(() => setLinkCopied(false), 3000);
      // Stamp publishedAt on the process the first time the link is generated
      // so the dashboard roadmap can mark the "🚀 Link público" milestone done.
      if (!process.publishedAt && onUpdateProcess) {
        onUpdateProcess({ id: process.id, publishedAt: new Date().toISOString() });
      }
    } catch (e) { alert("Error al generar el link."); }
    setPublishing(false);
  };

  const copyLink = async () => { if (!publicLink) return; await navigator.clipboard.writeText(publicLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); };

  // ── Publish post generator (LinkedIn + Instagram Story + internal email) ──
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishPosts, setPublishPosts] = useState(null);
  const [generatingPosts, setGeneratingPosts] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [activePostTab, setActivePostTab] = useState("linkedin");
  const [copiedPost, setCopiedPost] = useState(false);

  const generatePublishPosts = async () => {
    setGeneratingPosts(true); setPublishError(""); setPublishPosts(null);
    try {
      const res = await fetch("/api/generatePublishPost", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          process,
          brandManual: agencySettings?.brandManual || "",
          publicUrl: publicLink || `${window.location.origin}/#apply/${process.id}`,
          recruiterName: user?.displayName || "",
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "Error al generar.");
      setPublishPosts(json.posts);
    } catch (e) {
      setPublishError(e.message || "No se pudo generar la publicación.");
    }
    setGeneratingPosts(false);
  };

  const openPublishModal = () => {
    setShowPublishModal(true);
    setActivePostTab("linkedin");
    if (!publishPosts && !generatingPosts) generatePublishPosts();
  };

  // When we arrive here via 'Publicar y compartir' from the setup flow,
  // auto-run the publish + open the posts modal once the component mounts.
  // Skips if the agency config is incomplete (generatePublicLink will show
  // the missing-config modal instead).
  useEffect(() => {
    if (!autoShareOnEntry) return;
    clearAutoShare?.();
    (async () => {
      await generatePublicLink();
      // If publication actually happened (missing config modal wasn't opened
      // as a result), open the posts modal. Check after the publish promise.
      setTimeout(() => {
        // publicLink state may not be set synchronously, so re-read from
        // context via a small defer. showMissingConfigModal gate is enough:
        // if it's open we don't want to cover it with the posts modal.
        if (!showMissingConfigModal) openPublishModal();
      }, 300);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoShareOnEntry]);

  const copyCurrentPost = async () => {
    if (!publishPosts) return;
    let text = "";
    if (activePostTab === "linkedin") text = publishPosts.linkedin?.text || "";
    else if (activePostTab === "instagram_story") text = publishPosts.instagram_story?.text || "";
    else if (activePostTab === "email_internal") {
      text = `Asunto: ${publishPosts.email_internal?.subject || ""}\n\n${publishPosts.email_internal?.body || ""}`;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedPost(true);
      setTimeout(() => setCopiedPost(false), 2000);
    } catch { /* clipboard blocked, ignore */ }
  };

  const updateCurrentPost = (newText) => {
    setPublishPosts(p => {
      if (!p) return p;
      const updated = { ...p };
      if (activePostTab === "linkedin") updated.linkedin = { ...updated.linkedin, text: newText };
      else if (activePostTab === "instagram_story") updated.instagram_story = { ...updated.instagram_story, text: newText };
      return updated;
    });
  };
  const updateEmailField = (field, value) => {
    setPublishPosts(p => ({ ...p, email_internal: { ...p.email_internal, [field]: value } }));
  };

  const importApplications = async () => {
    setImporting(true);
    try {
      const snap = await getDocs(collection(db, "publicProcesses", process.id, "applications"));
      const apps = snap.docs.map(d => ({ id: `app_${d.id}`, ...d.data() }));
      const existingIds = new Set(candidates.map(c => c.id));
      const newApps = apps.filter(a => !existingIds.has(a.id));
      if (newApps.length > 0) { const u = [...candidates, ...newApps]; setCandidates(u); onUpdate(process.id, u); setImportCount(newApps.length); setTimeout(() => setImportCount(0), 4000); }
      else { setImportCount(-1); setTimeout(() => setImportCount(0), 3000); }
    } catch (e) { console.error(e); }
    setImporting(false);
  };

  const statsByEstado = ESTADO_OPTIONS.map(e => ({ label: e, count: candidates.filter(c => (c.estado || "Pendiente") === e).length }));
  const statColors = ["bg-gray-50 text-gray-700", "bg-gray-50 text-gray-800", "bg-indigo-50 text-indigo-700", "bg-yellow-50 text-yellow-700", "bg-red-50 text-red-600", "bg-green-50 text-green-700"];

  // ── Pipeline analytics ──────────────────────────────────────────────────────
  const analytics = (() => {
    const total = candidates.length;
    const interviewStates = ["Primera entrevista", "Segunda entrevista", "Contratado"];
    const interviewed = candidates.filter(c => interviewStates.includes(c.estado)).length;
    const hired = candidates.filter(c => c.estado === "Contratado").length;
    const decided = candidates.filter(c => FINAL_ESTADOS.includes(c.estado)).length;

    const weekAgoTs = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const newThisWeek = candidates.filter(c => c.submittedAt && new Date(c.submittedAt).getTime() > weekAgoTs).length;

    const appToInterview = total > 0 ? Math.round((interviewed / total) * 100) : 0;
    const interviewToHire = interviewed > 0 ? Math.round((hired / interviewed) * 100) : 0;
    const overallHireRate = total > 0 ? Math.round((hired / total) * 100) : 0;

    const decisionTimesDays = candidates
      .filter(c => c.submittedAt && c.decidedAt)
      .map(c => (new Date(c.decidedAt).getTime() - new Date(c.submittedAt).getTime()) / (1000 * 60 * 60 * 24));
    const avgDecisionDays = decisionTimesDays.length > 0
      ? Math.round(decisionTimesDays.reduce((a, b) => a + b, 0) / decisionTimesDays.length)
      : null;

    return { total, interviewed, hired, decided, newThisWeek, appToInterview, interviewToHire, overallHireRate, avgDecisionDays };
  })();

  // ── CSV export ──────────────────────────────────────────────────────────────
  const exportCSV = () => {
    if (candidates.length === 0) return;
    const headers = ["Nombre", "Email", "Teléfono", "LinkedIn", "Estado", "Progreso", "Entrevistador", "Fecha aplicación", "Fecha decisión", "Score ejercicio", "Recom. ejercicio", "Score entrevista", "Recom. entrevista", "Decisión final", "Notas"];
    const rows = candidates.map(c => [
      c.name || "",
      c.email || "",
      c.phone || "",
      c.linkedin || "",
      c.estado || "",
      c.progreso || "",
      c.entrevistador || "",
      c.submittedAt ? new Date(c.submittedAt).toLocaleDateString("es-ES") : "",
      c.decidedAt ? new Date(c.decidedAt).toLocaleDateString("es-ES") : "",
      c.exerciseEvaluation?.overall ?? "",
      c.exerciseEvaluation?.recommendation ?? "",
      c.interviewEvaluation?.candidate?.overall ?? "",
      c.interviewEvaluation?.candidate?.recommendation ?? "",
      c.finalDecision || "",
      (c.notas || "").replace(/[\r\n]+/g, " "),
    ]);
    const escape = (v) => {
      const s = String(v ?? "");
      return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [headers, ...rows].map(r => r.map(escape).join(",")).join("\n");
    // BOM prefix so Excel opens it as UTF-8
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const safeTitle = getPositionTitle(process.position).replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    const a = document.createElement("a");
    a.href = url;
    a.download = `candidatos_${safeTitle}_${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {evalCandidate && <CandidateEvaluationPanel candidate={evalCandidate} process={process} agencySettings={agencySettings} onUpdateCandidate={updateCandidateFull} onClose={() => setEvalCandidate(null)} />}
      <ConfirmModal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={confirmRemoveCandidate}
        icon="🗑️"
        title={removeTarget ? `¿Eliminar a ${removeTarget.name || "este candidato"}?` : ""}
        description="Se perderán sus datos, respuestas y evaluaciones. Esta acción no se puede deshacer."
        confirmLabel="Sí, eliminar"
        confirmStyle="bg-red-500 hover:bg-red-600"
      />

      {showPublishModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setShowPublishModal(false)}>
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">✨ Publicación para compartir</h2>
                <p className="text-xs text-gray-500 mt-0.5">Copy generado con la voz de tu marca, listo para copiar y publicar.</p>
              </div>
              <button onClick={() => setShowPublishModal(false)} className="text-gray-400 hover:text-gray-900 text-2xl leading-none shrink-0">×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 shrink-0 overflow-x-auto">
              {[
                ["linkedin", "💼 LinkedIn"],
                ["instagram_story", "📸 Instagram Story"],
                ["email_internal", "✉️ Email interno"],
              ].map(([id, label]) => (
                <button key={id} onClick={() => setActivePostTab(id)}
                  className={`flex-1 py-3 text-sm font-semibold transition-colors whitespace-nowrap min-w-max px-4 ${activePostTab === id ? "border-b-2 border-gray-900 text-gray-900" : "text-gray-400 hover:text-gray-900"}`}>
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6">
              {generatingPosts && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin" />
                  <p className="text-sm text-gray-500">Redactando con IA... ~20 segundos</p>
                </div>
              )}
              {publishError && !generatingPosts && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700 mb-3">{publishError}</div>
              )}
              {publishPosts && !generatingPosts && (
                <>
                  {activePostTab === "linkedin" && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className={lbl}>Texto del post</label>
                        <span className="text-xs text-gray-400">{(publishPosts.linkedin?.text || "").length} caracteres</span>
                      </div>
                      <textarea className={inp + " font-sans"} rows={16}
                        value={publishPosts.linkedin?.text || ""}
                        onChange={e => updateCurrentPost(e.target.value)} />
                      <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                        💡 <strong>Tip:</strong> reemplaza el placeholder <code className="text-[11px] bg-gray-100 px-1 rounded">@{process.company?.name}</code> por la mención real a la página de empresa en LinkedIn antes de publicar.
                      </p>
                    </div>
                  )}
                  {activePostTab === "instagram_story" && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className={lbl}>Texto del story</label>
                        <span className="text-xs text-gray-400">{(publishPosts.instagram_story?.text || "").length} caracteres</span>
                      </div>
                      <textarea className={inp + " font-sans"} rows={5}
                        value={publishPosts.instagram_story?.text || ""}
                        onChange={e => updateCurrentPost(e.target.value)} />
                      <div className="mt-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3 space-y-2">
                        <p className="text-xs text-indigo-900 font-bold leading-relaxed">
                          📌 Al publicar en Instagram:
                        </p>
                        <ol className="text-xs text-indigo-800 space-y-1 pl-4 list-decimal">
                          <li>Sube tu foto o vídeo a la story.</li>
                          <li>Añade el <strong>sticker de "Enlace"</strong> (icono con la cadena 🔗).</li>
                          <li>Pega el URL del link público:</li>
                        </ol>
                        {publicLink && (
                          <div className="flex items-center gap-2 bg-white border border-indigo-200 rounded-lg px-2 py-1.5 mt-1">
                            <span className="text-[11px] text-gray-600 font-mono truncate flex-1">{publicLink}</span>
                            <button type="button" onClick={() => navigator.clipboard?.writeText(publicLink)}
                              className="shrink-0 text-[11px] bg-indigo-600 text-white px-2 py-1 rounded font-bold hover:bg-indigo-700">
                              Copiar URL
                            </button>
                          </div>
                        )}
                        <p className="text-xs text-indigo-700 leading-relaxed pt-1">
                          💡 Cuando pegas el texto como pie/overlay en la story, menciona el sticker con una flecha 👆 para que los candidatos lo toquen y apliquen sin salir de Instagram.
                        </p>
                      </div>
                    </div>
                  )}
                  {activePostTab === "email_internal" && (
                    <div className="space-y-4">
                      <div>
                        <label className={lbl}>Asunto</label>
                        <input className={inp} type="text"
                          value={publishPosts.email_internal?.subject || ""}
                          onChange={e => updateEmailField("subject", e.target.value)} />
                      </div>
                      <div>
                        <label className={lbl}>Cuerpo del email</label>
                        <textarea className={inp + " font-sans"} rows={12}
                          value={publishPosts.email_internal?.body || ""}
                          onChange={e => updateEmailField("body", e.target.value)} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {publishPosts && !generatingPosts && (
              <div className="px-6 py-4 border-t border-gray-100 flex flex-wrap gap-2 shrink-0">
                <button onClick={generatePublishPosts}
                  className="py-2.5 px-4 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
                  🔄 Regenerar todo
                </button>
                <button onClick={copyCurrentPost}
                  className="flex-1 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800">
                  {copiedPost ? "✓ Copiado al portapapeles" : "📋 Copiar este post"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showMissingConfigModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl max-w-md w-full">
            <div className="p-8 text-center">
              <div className="text-5xl mb-3">⚠️</div>
              <h2 className="text-2xl font-bold text-gray-900 tracking-tight mb-2">Completa tu configuración antes de publicar</h2>
              <p className="text-gray-500 leading-relaxed text-sm">
                Tu proceso está guardado. Para poder compartir el link con candidatos, primero necesitas completar:
              </p>
            </div>
            <div className="px-8 pb-6">
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
                {missingForPublish.map((item, i) => (
                  <div key={i}>
                    <p className="text-sm font-bold text-amber-900">⚪ {item.label}</p>
                    <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">{item.hint}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-2">
              <button onClick={() => setShowMissingConfigModal(false)}
                className="flex-1 py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
                Seguir editando
              </button>
              <button onClick={() => { setShowMissingConfigModal(false); onOpenSettings?.(); }}
                className="flex-1 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800">
                Ir a Configuración →
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-700 text-sm shrink-0">← Panel</button>
          <div className="w-px h-4 bg-gray-200 shrink-0" />
          <span className="text-xl font-black text-gray-900 shrink-0">RecruitAI</span>
          <div className="w-px h-4 bg-gray-200 shrink-0" />
          <div className="flex-1 min-w-0"><span className="font-bold text-gray-900 text-sm truncate block">{getPositionTitle(process.position)}</span><span className="text-xs text-gray-400">{process.company?.name}</span></div>
          <button onClick={onStartDemo} className="shrink-0 px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg text-xs font-medium hover:bg-gray-50">Ver oferta →</button>
        </div>
      </div>
      <div className="max-w-6xl mx-auto p-6">
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${process.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{process.status === "active" ? "● Activo" : "● Pausado"}</span>
          {process.position?.contract && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position.contract}</span>}
          {process.position?.hoursPerWeek && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position.hoursPerWeek}h/sem</span>}
          {process.company?.salaryMin && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">{Number(process.company.salaryMin).toLocaleString()}–{Number(process.company.salaryMax).toLocaleString()} {process.company.currency}</span>}
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
          {statsByEstado.map(({ label, count }, i) => (<div key={label} className={`rounded-xl border border-gray-100 p-3 text-center shadow-sm ${statColors[i]}`}><p className="text-2xl font-black leading-none">{count}</p><p className="text-xs leading-tight mt-1 opacity-80">{label}</p></div>))}
        </div>

        {/* ── Analytics panel ─────────────────────────────────────────────── */}
        {candidates.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 text-sm">📊 Analítica del proceso</h3>
              <span className="text-xs text-gray-400">Desde {new Date(process.createdAt).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" })}</span>
            </div>
            {/* KPI cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                <p className="text-xs text-gray-500 font-semibold">Candidatos totales</p>
                <p className="text-2xl font-black text-gray-900 leading-none mt-1">{analytics.total}</p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                <p className="text-xs text-gray-500 font-semibold">Nuevos esta semana</p>
                <p className="text-2xl font-black text-gray-900 leading-none mt-1">
                  {analytics.newThisWeek > 0 ? `+${analytics.newThisWeek}` : "0"}
                </p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                <p className="text-xs text-gray-500 font-semibold">Tasa contratación</p>
                <p className="text-2xl font-black text-gray-900 leading-none mt-1">{analytics.overallHireRate}%</p>
                <p className="text-xs text-gray-400 mt-0.5">{analytics.hired} de {analytics.total}</p>
              </div>
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                <p className="text-xs text-gray-500 font-semibold">Tiempo medio</p>
                <p className="text-2xl font-black text-gray-900 leading-none mt-1">
                  {analytics.avgDecisionDays !== null ? `${analytics.avgDecisionDays}d` : <span className="text-gray-300">—</span>}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">hasta decisión</p>
              </div>
            </div>
            {/* Funnel */}
            <div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-3">Funnel de conversión</p>
              <div className="space-y-2.5">
                {[
                  { label: "Aplicaron", count: analytics.total, from: null },
                  { label: "Llegaron a entrevista", count: analytics.interviewed, from: analytics.total, rate: analytics.appToInterview, fromLabel: "del total" },
                  { label: "Contratados", count: analytics.hired, from: analytics.interviewed, rate: analytics.interviewToHire, fromLabel: "de entrevistas" },
                ].map((row, i) => {
                  const pct = analytics.total > 0 ? (row.count / analytics.total) * 100 : 0;
                  return (
                    <div key={i}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-gray-700 font-medium">{row.label}</span>
                        <span className="text-gray-900 font-bold">
                          {row.count}
                          {row.rate != null && <span className="text-gray-400 text-xs ml-2 font-normal">({row.rate}% {row.fromLabel})</span>}
                        </span>
                      </div>
                      <div className="bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div className="bg-gray-900 h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 2)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {/* Link público */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold text-gray-800 text-sm">🔗 Link público para candidatos</p><p className="text-xs text-gray-400 mt-0.5">Genera un link único que los candidatos abren para aplicar.</p></div>
            <div className="flex gap-2 flex-wrap">
              {publicLink && <button onClick={importApplications} disabled={importing} className="px-3 py-2 border border-gray-200 text-gray-900 rounded-lg text-xs font-semibold hover:bg-gray-50 disabled:opacity-50">{importing ? "Importando..." : "⬇ Importar candidatos"}</button>}
              <button onClick={generatePublicLink} disabled={publishing} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">{publishing ? "Publicando..." : publicLink ? "🔄 Regenerar link" : "🚀 Generar link público"}</button>
            </div>
          </div>
          {publicLink && (<div className="mt-3 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2"><span className="text-xs text-gray-500 font-mono flex-1 truncate">{publicLink}</span><button onClick={copyLink} className={`text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 transition-colors ${linkCopied ? "bg-green-100 text-green-700" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"}`}>{linkCopied ? "✓ Copiado" : "Copiar"}</button></div>)}
          {publicLink && (
            <div className="mt-3 flex items-center justify-between gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2.5">
              <div className="flex-1 min-w-0">
                {publishPosts ? (
                  <>
                    <p className="text-xs font-bold text-indigo-900">✅ Publicación lista para redes</p>
                    <p className="text-[11px] text-indigo-700 mt-0.5 leading-snug">LinkedIn, Instagram Story y email interno — revisa, edita o regenera cuando quieras.</p>
                  </>
                ) : (
                  <>
                    <p className="text-xs font-bold text-indigo-900">✨ ¿Lo compartes en redes?</p>
                    <p className="text-[11px] text-indigo-700 mt-0.5 leading-snug">Genero posts listos para LinkedIn, Instagram Story y email interno con el tono de tu marca.</p>
                  </>
                )}
              </div>
              <button onClick={openPublishModal} className="shrink-0 bg-gray-900 text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-gray-800">
                {publishPosts ? "Ver publicación →" : "Generar publicación →"}
              </button>
            </div>
          )}
          {importCount > 0 && <p className="text-xs text-green-600 font-semibold mt-2">✅ {importCount} nueva{importCount > 1 ? "s" : ""} candidatura{importCount > 1 ? "s" : ""} importada{importCount > 1 ? "s" : ""}</p>}
          {importCount === -1 && <p className="text-xs text-gray-400 mt-2">No hay candidaturas nuevas.</p>}
        </div>
        {/* Candidate Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 gap-2">
            <h2 className="font-bold text-gray-800">Candidatos <span className="text-gray-400 font-normal text-sm">({candidates.length})</span></h2>
            <div className="flex gap-2 flex-wrap">
              <button onClick={exportCSV} disabled={candidates.length === 0}
                className="px-3 py-2 border border-gray-200 text-gray-700 rounded-xl text-xs font-bold hover:bg-gray-50 disabled:opacity-40 transition-colors">
                ⬇ Exportar CSV
              </button>
              <button onClick={() => setShowAddForm(v => !v)} className="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-gray-800">+ Añadir candidato</button>
            </div>
          </div>
          {showAddForm && (
            <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 flex flex-wrap items-end gap-3">
              <div><label className={lbl}>Nombre *</label><input className={inp} style={{ width: "180px" }} value={newName} onChange={e => setNewName(e.target.value)} autoFocus onKeyDown={e => e.key === "Enter" && addCandidate()} /></div>
              <div><label className={lbl}>Email</label><input className={inp} style={{ width: "220px" }} value={newEmail} onChange={e => setNewEmail(e.target.value)} type="email" /></div>
              <div className="flex gap-2"><button onClick={addCandidate} className="px-4 py-2.5 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-gray-800">Añadir</button><button onClick={() => { setShowAddForm(false); setNewName(""); setNewEmail(""); }} className="px-4 py-2.5 border border-gray-200 bg-white text-gray-500 rounded-lg text-sm">Cancelar</button></div>
            </div>
          )}
          {candidates.length === 0 ? (
            <div className="text-center py-14"><p className="text-4xl mb-3">👥</p><p className="text-gray-400 text-sm font-medium">No hay candidatos en este proceso.</p><button onClick={() => setShowAddForm(true)} className="mt-3 text-gray-900 text-sm hover:underline">+ Añadir el primero</button></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ minWidth: "160px" }}>Candidato</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ minWidth: "170px" }}>Estado</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ minWidth: "190px" }}>Progreso</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ minWidth: "140px" }}>Entrevistador</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ minWidth: "180px" }}>Notas</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{ minWidth: "80px" }}>IA</th>
                  <th className="px-4 py-3 w-8"></th>
                </tr></thead>
                <tbody>
                  {candidates.map((c, i) => (
                    <tr key={c.id} className={`border-b border-gray-50 hover:bg-gray-50/20 transition-colors ${i % 2 === 1 ? "bg-gray-50/30" : ""}`}>
                      <td className="px-4 py-3"><p className="font-semibold text-gray-800 leading-tight">{c.name}</p>{c.email && <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>}</td>
                      <td className="px-4 py-3"><select value={c.estado || "Pendiente"} onChange={e => updateCandidate(c.id, "estado", e.target.value)} className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-300 ${ESTADO_COLORS[c.estado || "Pendiente"] || "bg-gray-100 text-gray-700"}`} style={{ maxWidth: "155px" }}>{ESTADO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td className="px-4 py-3"><select value={c.progreso || "Ingreso"} onChange={e => updateCandidate(c.id, "progreso", e.target.value)} className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-gray-300 ${PROGRESO_COLORS[c.progreso || "Ingreso"] || "bg-gray-100 text-gray-700"}`} style={{ maxWidth: "185px" }}>{PROGRESO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td className="px-4 py-3"><input type="text" value={c.entrevistador || ""} onChange={e => updateCandidate(c.id, "entrevistador", e.target.value)} placeholder="Asignar..." className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-transparent" /></td>
                      <td className="px-4 py-3"><input type="text" value={c.notas || ""} onChange={e => updateCandidate(c.id, "notas", e.target.value)} placeholder="Añadir nota..." className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-gray-300 bg-transparent" /></td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => setEvalCandidate(c)} className={`text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${c.exerciseEvaluation || c.interviewEvaluation ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                          {c.exerciseEvaluation && c.interviewEvaluation ? "✅ Ver" : c.exerciseEvaluation ? "🎤 Entrev." : "🤖 Evaluar"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center"><button onClick={() => requestRemoveCandidate(c)} className="text-gray-300 hover:text-red-400 text-xl leading-none" title={`Eliminar a ${c.name || "candidato"}`}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function getPipelineStats(process) {
  const c = process.candidates || [];
  return { total: c.length, hired: c.filter(x => x.estado === "Contratado" || x.phase === "hired").length, interview: c.filter(x => x.estado === "Primera entrevista" || x.estado === "Segunda entrevista").length };
}

function ProcessCard({ process, onView, onToggle }) {
  const stats = getPipelineStats(process);
  const isActive = process.status === "active";
  const byEstado = ESTADO_OPTIONS.map(e => ({ label: e, val: (process.candidates || []).filter(c => (c.estado || "Pendiente") === e).length }));
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 transition-all ${isActive ? "border-gray-100" : "border-gray-100 opacity-70"}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? "bg-green-400" : "bg-gray-300"}`} /><span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{isActive ? "Activo" : "Pausado"}</span></div>
          <h3 className="font-bold text-gray-900 leading-tight">{getPositionTitle(process.position)}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{process.company?.name} · {process.company?.location}</p>
        </div>
        <button onClick={() => onToggle(process.id)} className={`ml-3 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${isActive ? "border-gray-200 text-gray-900 hover:bg-gray-50" : "border-green-200 text-green-600 hover:bg-green-50"}`}>{isActive ? "⏸ Pausar" : "▶ Activar"}</button>
      </div>
      <div className="grid grid-cols-6 gap-1 mb-4">
        {byEstado.map((s, i) => <div key={s.label} className={`rounded-lg p-1.5 text-center ${["bg-gray-50", "bg-gray-50", "bg-indigo-50", "bg-yellow-50", "bg-red-50", "bg-green-50"][i]}`}><p className="text-base font-black leading-none text-gray-800">{s.val}</p><p className="text-xs text-gray-400 mt-0.5 leading-tight hidden sm:block" style={{ fontSize: "9px" }}>{s.label}</p></div>)}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position?.contract}</span>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position?.hoursPerWeek}h/sem</span>
          {process.company?.salaryMin && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">{Number(process.company.salaryMin).toLocaleString()}–{Number(process.company.salaryMax).toLocaleString()} {process.company.currency}</span>}
        </div>
        <button onClick={() => onView(process)} className="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold hover:bg-gray-800">Ver proceso →</button>
      </div>
    </div>
  );
}

// ─── Onboarding roadmap — from signup to first published process ─────────────
// Rendered at the top of the dashboard until the recruiter has completed
// every required step. Celebrates the final milestone ('🚀 Link público
// publicado') and then hides itself so the dashboard returns to its regular
// look once the user is actively running their first process.
function Roadmap({ user, agencySettings, processes, onNavigate }) {
  const hasBrand = !!(agencySettings?.brandManual && agencySettings.brandManual.trim());
  const hasEmail = agencySettings?.emailConfig?.provider && agencySettings.emailConfig.provider !== "none";
  const hasSlack = !!(agencySettings?.slackConfig?.webhookUrl);
  const hasProcess = processes.length > 0;
  const hasExercisesDefined = processes.some(p => (p.exercises || []).some(ex => ex.description && ex.description.trim().length > 10));
  const hasPublished = processes.some(p => p.publishedAt);
  const firstProcess = processes[0];

  const emailProviderLabel =
    agencySettings?.emailConfig?.provider === "app" ? "RecruitAI Mail"
    : agencySettings?.emailConfig?.provider === "resend_domain" ? "Dominio propio"
    : null;

  const brandWords = hasBrand ? agencySettings.brandManual.split(/\s+/).filter(Boolean).length : 0;

  const steps = [
    {
      id: "account",
      done: true,
      label: "Cuenta creada",
      detail: user?.email || "—",
      action: null,
    },
    {
      id: "brand",
      done: hasBrand,
      label: "Manual de marca",
      detail: hasBrand ? `${brandWords.toLocaleString()} palabras · la IA usa esto para evaluar` : "Para que la IA evalúe la compatibilidad cultural",
      action: { label: "Configurar marca", target: "settings", section: "marca" },
    },
    {
      id: "email",
      done: !!hasEmail,
      label: "Email automático",
      detail: hasEmail ? emailProviderLabel : "Confirmaciones al aplicar + emails de decisión",
      action: { label: "Configurar email", target: "settings", section: "email" },
    },
    {
      id: "slack",
      done: hasSlack,
      optional: true,
      label: "Slack",
      detail: hasSlack ? "Conectado" : "Avisos instantáneos cuando llegue un candidato",
      action: { label: "Conectar Slack", target: "settings", section: "slack" },
    },
    {
      id: "process",
      done: hasProcess,
      label: "Primer proceso creado",
      detail: hasProcess ? `${processes.length} proceso${processes.length > 1 ? "s" : ""} en el sistema` : "Empresa, puesto, ejercicios",
      action: !hasProcess ? { label: "Crear proceso", target: "new" } : null,
    },
    {
      id: "exercises",
      done: hasExercisesDefined,
      label: "Ejercicios con enunciado",
      detail: hasExercisesDefined ? "Listos para que la IA evalúe" : "Respuesta escrita + vídeo Loom por ejercicio",
      action: hasProcess && !hasExercisesDefined ? { label: "Completar ejercicios", target: "firstProcess" } : null,
    },
    {
      id: "publish",
      done: hasPublished,
      milestone: true,
      label: "🚀 Link público publicado",
      detail: hasPublished
        ? "¡Tu primer proceso está en la calle!"
        : "El link que compartes con candidatos. Es el hito que cierra el setup.",
      action: hasProcess && !hasPublished ? { label: "Ir al proceso y publicar", target: "firstProcess" } : null,
    },
  ];

  const requiredSteps = steps.filter(s => !s.optional);
  const doneRequired = requiredSteps.filter(s => s.done).length;
  const pct = Math.round((doneRequired / requiredSteps.length) * 100);
  // Hide the roadmap once every REQUIRED step is done (slack is optional).
  if (doneRequired === requiredSteps.length) return null;

  const handleAction = (action) => {
    if (action.target === "settings") onNavigate("settings", { section: action.section });
    else if (action.target === "new") onNavigate("new");
    else if (action.target === "firstProcess") onNavigate("firstProcess", firstProcess);
  };

  return (
    <div className="bg-white rounded-3xl border border-gray-200 shadow-sm p-6 sm:p-7 mb-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <span>🗺</span><span>Tu hoja de ruta</span>
          </h2>
          <p className="text-xs text-gray-500 mt-1 leading-relaxed">
            De la creación de la cuenta a tu primer proceso publicado. {doneRequired} de {requiredSteps.length} pasos esenciales completados.
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-3xl font-black text-gray-900 leading-none">{pct}%</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="bg-gray-100 rounded-full h-2 overflow-hidden mb-6">
        <div className="bg-gray-900 h-full rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>

      {/* Step list */}
      <div className="space-y-1">
        {steps.map((step, i) => (
          <div key={step.id}
            className={`flex items-start gap-3 py-3 border-b last:border-0 border-gray-50 ${step.milestone && !step.done ? "bg-yellow-50 -mx-3 px-3 rounded-xl border-yellow-100" : ""}`}>
            <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-black transition-colors ${
              step.done
                ? "bg-gray-900 text-white"
                : step.milestone
                  ? "bg-yellow-400 text-gray-900"
                  : "bg-gray-100 text-gray-500"
            }`}>
              {step.done ? "✓" : i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className={`font-bold text-sm ${step.done ? "text-gray-400 line-through" : "text-gray-900"}`}>{step.label}</p>
                {step.optional && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded font-medium">OPCIONAL</span>}
                {step.milestone && !step.done && <span className="text-[10px] bg-yellow-400 text-gray-900 px-1.5 py-0.5 rounded font-black">🎯 HITO FINAL</span>}
              </div>
              <p className="text-xs text-gray-500 mt-0.5 leading-snug">{step.detail}</p>
              {!step.done && step.action && (
                <button onClick={() => handleAction(step.action)}
                  className={`mt-2 inline-flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${
                    step.milestone
                      ? "bg-yellow-400 text-gray-900 hover:bg-yellow-500"
                      : "bg-gray-900 text-white hover:bg-gray-800"
                  }`}>
                  {step.action.label} →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RecruiterDashboard({ processes, onNew, onView, onToggle, user, onLogout, onOpenSettings, agencySettings }) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const active = processes.filter(p => p.status === "active").length;
  const totalCandidates = processes.reduce((s, p) => s + (p.candidates?.length || 0), 0);
  const hired = processes.reduce((s, p) => s + (p.candidates?.filter(c => c.estado === "Contratado" || c.phase === "hired").length || 0), 0);
  const isEmpty = processes.length === 0;
  const firstName = (user?.displayName || "").split(" ")[0];

  // Checklist state for the empty-state hero — tracks what the user already has set up
  const hasBrand = !!(agencySettings?.brandManual && agencySettings.brandManual.trim());
  const hasEmail = agencySettings?.emailConfig?.provider && agencySettings.emailConfig.provider !== "none";
  const hasSlack = !!(agencySettings?.slackConfig?.webhookUrl);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black text-gray-900 tracking-tight">RecruitAI</span>
            <span className="text-xs bg-gray-100 text-gray-900 px-2 py-0.5 rounded-full font-semibold">Panel de reclutador</span>
          </div>
          <div className="flex items-center gap-2">
            {user?.photoURL && <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full border-2 border-gray-200" />}
            <span className="text-sm text-gray-600 hidden sm:block">{firstName}</span>
            <button onClick={onOpenSettings} className="px-3 py-2 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50" title="Configuración de agencia">⚙️</button>
            <button onClick={onNew} className="px-5 py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800">+ Nuevo proceso</button>
            <button onClick={() => setShowLogoutConfirm(true)}
              className="px-3 py-2.5 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 hover:text-gray-900 transition-colors flex items-center gap-1.5"
              title="Cerrar sesión">
              <span>↩</span>
              <span className="hidden sm:inline font-medium">Cerrar sesión</span>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto p-6">
        {/* Roadmap: single source of truth for onboarding progress.
            Hides itself automatically when all required steps are done, and
            the dashboard resumes its 'working' look with just stats + list. */}
        <Roadmap
          user={user}
          agencySettings={agencySettings}
          processes={processes}
          onNavigate={(target, payload) => {
            if (target === "settings") onOpenSettings(payload?.section);
            else if (target === "new") onNew();
            else if (target === "firstProcess" && payload) onView(payload);
          }}
        />

        {isEmpty ? (
          // When there are no processes, the Roadmap is the whole hero.
          // Nothing else needed — the roadmap guides them to create one.
          null
        ) : (
          // Processes exist: show stats + process list.
          <>
            <div className="grid grid-cols-3 gap-4 mb-8">
              {[
                { icon: "📋", label: "Procesos activos", val: active, color: "text-gray-900" },
                { icon: "👥", label: "Candidatos totales", val: totalCandidates, color: "text-gray-800" },
                { icon: "🎉", label: "Contratados", val: hired, color: "text-green-600" },
              ].map(s => (
                <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <p className="text-2xl mb-1">{s.icon}</p>
                  <p className={`text-3xl font-black ${s.color}`}>{s.val}</p>
                  <p className="text-sm text-gray-400 mt-1">{s.label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-black text-gray-900">Procesos de selección</h2>
              <span className="text-sm text-gray-400">{processes.length} en total</span>
            </div>
            <div className="space-y-4">{processes.map(p => <ProcessCard key={p.id} process={p} onView={onView} onToggle={onToggle} />)}</div>
          </>
        )}
      </div>
      <BrandFooter />

      {showLogoutConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl shadow-xl max-w-sm w-full p-6">
            <div className="text-center mb-5">
              <div className="text-4xl mb-2">👋</div>
              <h3 className="font-bold text-gray-900 text-lg mb-1">¿Cerrar sesión?</h3>
              <p className="text-sm text-gray-500 leading-relaxed">Volverás a la pantalla de login. Tus procesos y datos se quedan guardados, al volver a entrar estarán aquí.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
                Cancelar
              </button>
              <button onClick={() => { setShowLogoutConfirm(false); onLogout(); }}
                className="flex-1 py-3 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800">
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Markdown renderer with Tailwind-consistent styling ─────────────────────
// Component overrides are spelled out so no extra typography plugin is needed.
function MarkdownContent({ children, className = "", tone = "default" }) {
  // "default": dark text on white/light bg (exercise description, etc.)
  // "muted": smaller, paler copy (compact previews)
  const isMuted = tone === "muted";
  const base = isMuted ? "text-xs text-gray-600" : "text-sm text-gray-700";

  const components = {
    h1: ({ node, ...props }) => <h1 className="text-xl font-bold text-gray-900 tracking-tight mt-6 mb-3 first:mt-0" {...props} />,
    h2: ({ node, ...props }) => <h2 className="text-lg font-bold text-gray-900 tracking-tight mt-5 mb-2 first:mt-0" {...props} />,
    h3: ({ node, ...props }) => <h3 className="text-base font-bold text-gray-900 mt-4 mb-2 first:mt-0" {...props} />,
    h4: ({ node, ...props }) => <h4 className="text-sm font-bold text-gray-900 mt-3 mb-1.5 first:mt-0" {...props} />,
    p:  ({ node, ...props }) => <p className={`${base} leading-relaxed mb-3 last:mb-0`} {...props} />,
    ul: ({ node, ...props }) => <ul className={`${base} list-disc pl-5 space-y-1 mb-3 last:mb-0`} {...props} />,
    ol: ({ node, ...props }) => <ol className={`${base} list-decimal pl-5 space-y-1 mb-3 last:mb-0`} {...props} />,
    li: ({ node, ...props }) => <li className="leading-relaxed" {...props} />,
    strong: ({ node, ...props }) => <strong className="font-bold text-gray-900" {...props} />,
    em: ({ node, ...props }) => <em className="italic" {...props} />,
    a: ({ node, ...props }) => <a className="text-gray-900 underline hover:opacity-70" target="_blank" rel="noreferrer" {...props} />,
    code: ({ node, inline, ...props }) => inline
      ? <code className="bg-gray-100 text-gray-900 px-1 py-0.5 rounded text-[0.9em] font-mono" {...props} />
      : <code className="block bg-gray-100 text-gray-900 p-3 rounded-lg text-xs font-mono overflow-x-auto" {...props} />,
    blockquote: ({ node, ...props }) => <blockquote className={`${base} border-l-4 border-gray-200 pl-4 italic my-3`} {...props} />,
    hr: () => <hr className="border-gray-200 my-4" />,
    table: ({ node, ...props }) => <div className="overflow-x-auto my-3"><table className={`${base} border-collapse w-full`} {...props} /></div>,
    th: ({ node, ...props }) => <th className="border border-gray-200 bg-gray-50 px-2 py-1 text-left font-bold" {...props} />,
    td: ({ node, ...props }) => <td className="border border-gray-200 px-2 py-1" {...props} />,
  };

  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}

// ─── Markdown-aware editor: textarea + formatting toolbar + optional preview ─
// The recruiter types normally, clicks B/I/H/•/1. to insert markdown around
// the current selection (or at the cursor). Live preview toggles below so
// they see how the candidate will read it. No dependencies beyond what
// MarkdownContent already uses.
function MarkdownEditor({ value, onChange, rows = 6, placeholder, previewTone = "default", allowHeadings = true, small = false }) {
  const ref = useRef(null);
  const [showPreview, setShowPreview] = useState(false);

  // Wrap current selection (or insert at cursor if no selection) with a pair
  // of markers. If wrapping empties (no selection), we place the caret inside.
  const wrapSelection = (marker) => {
    const el = ref.current; if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const selected = value.slice(start, end);
    const inner = selected || "texto";
    const before = value.slice(0, start);
    const after = value.slice(end);
    const next = `${before}${marker}${inner}${marker}${after}`;
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const caretStart = start + marker.length;
      const caretEnd = caretStart + inner.length;
      el.setSelectionRange(caretStart, caretEnd);
    });
  };

  // Prefix every line that intersects the current selection (or the current
  // line if nothing selected) with the given marker. For numbered lists,
  // increments 1. 2. 3. across the selected lines.
  const prefixLines = (marker /* string or "number" */) => {
    const el = ref.current; if (!el) return;
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = value.indexOf("\n", end);
    const stopAt = lineEnd === -1 ? value.length : lineEnd;
    const block = value.slice(lineStart, stopAt);
    const lines = block.split("\n");
    const prefixed = lines.map((line, i) => {
      if (marker === "number") return `${i + 1}. ${line.replace(/^(?:\d+\.\s*|-\s*|##\s*)/, "")}`;
      // Strip other list/heading markers before applying the new one
      const clean = line.replace(/^(?:\d+\.\s*|-\s*|##\s*)/, "");
      return `${marker}${clean}`;
    }).join("\n");
    const next = value.slice(0, lineStart) + prefixed + value.slice(stopAt);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(lineStart, lineStart + prefixed.length);
    });
  };

  const btnBase = `px-2.5 py-1 text-xs rounded-md border transition-colors font-medium border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400`;

  return (
    <div>
      <div className="flex gap-1 mb-1.5 flex-wrap items-center">
        <button type="button" onClick={() => wrapSelection("**")} title="Negrita" className={btnBase + " font-bold"}>B</button>
        <button type="button" onClick={() => wrapSelection("_")} title="Cursiva" className={btnBase + " italic"}>I</button>
        {allowHeadings && (
          <button type="button" onClick={() => prefixLines("## ")} title="Título de sección" className={btnBase}>H</button>
        )}
        <button type="button" onClick={() => prefixLines("- ")} title="Lista con bullets" className={btnBase}>•</button>
        <button type="button" onClick={() => prefixLines("number")} title="Lista numerada" className={btnBase}>1.</button>
        <div className="flex-1" />
        <button type="button" onClick={() => setShowPreview(v => !v)} title="Ver preview"
          className={`px-2.5 py-1 text-xs rounded-md border transition-colors font-medium ${
            showPreview ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400"
          }`}>
          👀 Preview
        </button>
      </div>
      <textarea ref={ref}
        className={inp + (small ? " text-xs" : "") + " font-mono"}
        rows={rows}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder} />
      {showPreview && (value || "").trim() && (
        <div className="mt-2 bg-gray-50 border border-gray-100 rounded-xl p-4">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">Preview</p>
          <MarkdownContent tone={previewTone}>{value}</MarkdownContent>
        </div>
      )}
    </div>
  );
}

// ─── Faithful preview of how a candidate will see an exercise ────────────────
// Mirrors the layout of ExercisesScreen without the surrounding chrome so the
// recruiter can see the actual visual result before committing to add it.
function ExercisePreview({ exercise }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6">
      <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-gray-100 rounded-full px-3 py-1 mb-4">
        <span>👀</span><span>Así lo verá el candidato</span>
      </div>
      <h3 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight mb-3">{exercise.title || "Sin título"}</h3>
      {exercise.description ? (
        <MarkdownContent className="mb-4">{exercise.description}</MarkdownContent>
      ) : (
        <p className="text-gray-300 italic mb-4">(Sin enunciado)</p>
      )}
      <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
        <p className="text-xs font-bold text-gray-900 uppercase tracking-wide mb-2">📋 Criterios que se evalúan</p>
        {(exercise.criteria || []).length > 0 ? (
          <ul className="space-y-1.5">
            {exercise.criteria.map((c, i) => (
              <li key={i} className="text-xs text-gray-700 leading-relaxed">
                <strong className="text-gray-900">{c.area || "(sin área)"}:</strong> {c.indicators || <span className="italic text-gray-400">sin indicadores</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-400 italic">Sin criterios detectados. Tendrás que añadirlos manualmente.</p>
        )}
      </div>
    </div>
  );
}

// ─── Reusable confirmation modal for destructive / external-effect actions ──
// Usage: <ConfirmModal open={...} onClose={...} onConfirm={...} title="..." />
// - onConfirm receives no args; pass a closure with whatever state you need.
// - confirmStyle accepts the full bg/hover tailwind classes, so consumers
//   can override the default black CTA with red/green/etc. for semantic cues.
function ConfirmModal({
  open, onClose, onConfirm,
  icon = "⚠️", title, description,
  confirmLabel = "Confirmar",
  confirmStyle = "bg-gray-900 hover:bg-gray-800",
  cancelLabel = "Cancelar",
  children,
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">{icon}</div>
          <h3 className="font-bold text-gray-900 text-lg mb-1">{title}</h3>
          {description && <p className="text-sm text-gray-500 leading-relaxed">{description}</p>}
        </div>
        {children}
        <div className="flex gap-2 mt-5">
          <button onClick={onClose}
            className="flex-1 py-3 border border-gray-200 text-gray-700 rounded-xl text-sm font-semibold hover:bg-gray-50">
            {cancelLabel}
          </button>
          <button onClick={() => { onConfirm(); }}
            className={`flex-1 py-3 ${confirmStyle} text-white rounded-xl text-sm font-bold transition-colors`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Rumbo Eficiente attribution ─────────────────────────────────────────────
// Footer signature used on LoginScreen and Dashboard. variant="light" targets
// white/gray backgrounds (uses the dark logo), variant="dark" targets dark
// backgrounds (uses the light logo).
function BrandFooter({ variant = "light" }) {
  const src = variant === "dark" ? "/rumbo-on-dark.png" : "/rumbo-on-light.png";
  const opacity = variant === "dark" ? "opacity-70 hover:opacity-100" : "opacity-60 hover:opacity-100";
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 py-6">
      <span className={`text-xs ${variant === "dark" ? "text-gray-400" : "text-gray-400"}`}>RecruitAI por</span>
      <a href="https://rumboeficiente.com" target="_blank" rel="noreferrer"
         className={`transition-opacity ${opacity}`}
         title="Rumbo Eficiente">
        <img src={src} alt="Rumbo Eficiente" className="h-5 sm:h-6 block" />
      </a>
    </div>
  );
}

// ─── In-app feedback widget (beta testing channel) ──────────────────────────
function FeedbackWidget({ user }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("idea");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const reset = () => { setType("idea"); setMessage(""); setSent(false); setError(""); };
  const close = () => { setOpen(false); setTimeout(reset, 200); };

  const send = async (e) => {
    e.preventDefault();
    if (message.trim().length < 3) return;
    setSending(true); setError("");
    try {
      const res = await fetch("/api/sendFeedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          message: message.trim(),
          url: window.location.href,
          userAgent: navigator.userAgent || "",
          userEmail: user?.email || "",
          userName: user?.displayName || "",
          viewport: `${window.innerWidth}×${window.innerHeight}`,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error || "No se pudo enviar");
      if (json.skipped) {
        setError("El servicio de feedback aún no está configurado por el admin (FEEDBACK_SLACK_WEBHOOK).");
      } else {
        setSent(true);
        setTimeout(close, 2200);
      }
    } catch (e) {
      setError(e.message || "Error al enviar. Inténtalo de nuevo.");
    }
    setSending(false);
  };

  const TYPES = [
    { id: "bug",      icon: "🐛", label: "Bug",      hint: "Algo no funciona" },
    { id: "idea",     icon: "💡", label: "Idea",     hint: "Propuesta de mejora" },
    { id: "confused", icon: "😕", label: "Confuso",  hint: "No lo entiendo" },
    { id: "love",     icon: "❤️", label: "Me gusta", hint: "Algo que funciona" },
  ];

  return (
    <>
      {/* Floating launcher */}
      <button onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 bg-gray-900 text-white rounded-full shadow-lg px-4 py-3 font-bold text-sm hover:bg-gray-800 hover:shadow-xl transition-all flex items-center gap-2">
        <span>💬</span><span className="hidden sm:inline">Feedback</span>
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={close}>
          <div className="bg-white rounded-t-3xl sm:rounded-3xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-5 border-b border-gray-100 flex items-start justify-between gap-3">
              <div>
                <h2 className="font-bold text-gray-900 text-lg">💬 Envía feedback</h2>
                <p className="text-xs text-gray-500 mt-0.5">Tu feedback llega directo a nuestro Slack. Lo leemos al momento.</p>
              </div>
              <button onClick={close} className="text-gray-400 hover:text-gray-900 text-2xl leading-none shrink-0">×</button>
            </div>

            {sent ? (
              <div className="p-10 text-center">
                <div className="text-5xl mb-3">✅</div>
                <p className="text-xl font-bold text-gray-900">Feedback enviado</p>
                <p className="text-sm text-gray-500 mt-2 leading-relaxed">Gracias por ayudarnos a mejorar RecruitAI. Lo revisaremos enseguida.</p>
              </div>
            ) : (
              <form onSubmit={send} className="flex-1 overflow-y-auto p-6 space-y-4">
                <div>
                  <label className={lbl}>Tipo de feedback</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                    {TYPES.map(t => (
                      <button key={t.id} type="button" onClick={() => setType(t.id)}
                        className={`p-3 rounded-xl border-2 text-left transition-all ${
                          type === t.id ? "border-gray-900 bg-gray-900" : "border-gray-200 bg-white hover:border-gray-400"
                        }`}>
                        <div className="text-xl mb-1">{t.icon}</div>
                        <p className={`text-xs font-bold ${type === t.id ? "text-white" : "text-gray-900"}`}>{t.label}</p>
                        <p className={`text-[10px] mt-0.5 leading-tight ${type === t.id ? "text-white/70" : "text-gray-500"}`}>{t.hint}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className={lbl}>Cuéntanos (lo más específico mejor)</label>
                  <textarea className={inp} rows={6}
                    value={message} onChange={e => setMessage(e.target.value)}
                    placeholder={
                      type === "bug" ? "¿Qué pasó? ¿Qué esperabas que pasara? Si puedes, los pasos para reproducirlo..."
                      : type === "idea" ? "¿Qué se puede mejorar? ¿Qué te falta? ¿Cómo te ayudaría?"
                      : type === "confused" ? "¿Qué no se entiende? ¿Qué esperabas que hiciera esta pantalla o botón?"
                      : "¿Qué te ha gustado? ¿Qué ha funcionado bien?"
                    }
                    autoFocus />
                  <p className="text-xs text-gray-400 mt-1.5">{message.trim().length} caracteres · mínimo 3</p>
                </div>

                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                  <p className="text-xs text-gray-500 leading-relaxed">
                    Adjuntamos automáticamente: tu nombre, email, URL de la pantalla actual y datos del navegador — para diagnosticar mejor los bugs.
                  </p>
                </div>

                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 text-sm text-red-700">{error}</div>
                )}

                <button type="submit" disabled={sending || message.trim().length < 3}
                  className="w-full py-3.5 bg-gray-900 text-white rounded-xl font-bold hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  {sending ? "Enviando..." : "Enviar feedback"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [publicProcessId] = useState(() => { const m = window.location.hash.match(/^#apply\/(.+)$/); return m ? m[1] : null; });
  if (publicProcessId) return <CandidatePublicScreen processId={publicProcessId} />;

  const [phase, setPhase] = useState("dashboard");
  const [processes, setProcesses] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [interview, setInterview] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [resetSent, setResetSent] = useState(false);
  const [agencySettings, setAgencySettings] = useState({ brandManual: "", emailConfig: { provider: "app" }, slackConfig: { webhookUrl: "", notifications: { newApplication: "both", aiEvaluation: "instant", finalDecision: "both", dailyDigest: true } }, onboardingCompleted: false });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState("marca");
  const openSettings = (section) => {
    setSettingsInitialSection(section || "marca");
    setShowSettings(true);
  };
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  // Onboarding visibility is now decoupled from agencySettings.onboardingCompleted.
  // Shown only on the first-ever login (!snap.exists()); after that, the user
  // goes straight to the dashboard even if they never finished the wizard.
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const ref = doc(db, "recruiters", u.uid);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const data = snap.data();
            if (data.processes?.length > 0) setProcesses(data.processes);
            if (data.settings) setAgencySettings(data.settings);
          } else {
            // First-time user: show onboarding wizard and send welcome email.
            // After this one shot, they go straight to the dashboard on every
            // subsequent login, whether or not they completed all 3 steps.
            setShowOnboarding(true);
            if (u.email) {
              fetch("/api/sendEmail", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  type: "welcome",
                  data: { userName: u.displayName || "", userEmail: u.email, appUrl: window.location.origin },
                  emailConfig: { provider: "app", fromName: "RecruitAI" },
                }),
              }).catch(e => console.error("Welcome email error:", e));
            }
          }
        } catch (e) { console.error("Error loading:", e); }
        setSettingsLoaded(true);
      } else {
        setSettingsLoaded(true);
      }
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    // 400ms debounce (was 1000ms). Short enough that a refresh shortly after
    // creating a process still catches the write; long enough to avoid
    // hammering Firestore during rapid edits in the evaluation panel.
    const t = setTimeout(async () => {
      try { await setDoc(doc(db, "recruiters", user.uid), { processes, settings: agencySettings, updatedAt: new Date().toISOString() }, { merge: true }); }
      catch (e) { console.error("Error saving:", e); }
    }, 400);
    return () => clearTimeout(t);
  }, [processes, agencySettings, user]);

  // ── Slack OAuth callback: detect webhook URL returned from /api/slack/callback ──
  useEffect(() => {
    if (!user || !settingsLoaded) return;
    // During onboarding, OnboardingScreen handles the callback itself
    if (showOnboarding) return;
    const params = new URLSearchParams(window.location.search);
    const slackConnected = params.get("slackConnected");
    const webhookUrl = params.get("slackWebhook");
    const channel = params.get("slackChannel");
    if (slackConnected === "1" && webhookUrl) {
      const newSlackConfig = {
        ...(agencySettings?.slackConfig || {}),
        webhookUrl,
        channelName: channel || "",
        notifications: agencySettings?.slackConfig?.notifications || {
          newApplication: "both", aiEvaluation: "instant", finalDecision: "both", dailyDigest: true,
        },
      };
      const newSettings = { ...agencySettings, slackConfig: newSlackConfig };
      setAgencySettings(newSettings);
      // Save to Firestore
      import("./firebase.js").then(({ db, doc, setDoc }) => {
        setDoc(doc(db, "users", user.uid), { slackConfig: newSlackConfig }, { merge: true });
      }).catch(() => {});
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    }
    if (params.get("slackError")) {
      // Clean URL silently
      window.history.replaceState({}, "", window.location.pathname + window.location.hash);
    }
  }, [user, settingsLoaded]);

  // ── Daily Slack digest: fires once per day when user opens the app ──
  useEffect(() => {
    if (!user || !settingsLoaded) return;
    const slack = agencySettings?.slackConfig;
    if (!slack?.webhookUrl || !slack?.notifications?.dailyDigest) return;
    const today = new Date().toDateString();
    const lastDigest = localStorage.getItem(`recruitai_digest_${user.uid}`);
    if (lastDigest === today) return; // already sent today
    const activeProcesses = processes.filter(p => p.status === "active");
    if (activeProcesses.length === 0) return;
    const date = new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
    sendSlackNotification(slack, "daily_digest", { processes: activeProcesses, date });
    localStorage.setItem(`recruitai_digest_${user.uid}`, today);
  }, [user, settingsLoaded, agencySettings]);

  const handleLogin = async () => { setLoginLoading(true); try { await signInWithPopup(auth, googleProvider); } catch (e) { console.error(e); setLoginLoading(false); } };

  const handleEmailAuth = async ({ mode, email, password, name }) => {
    setEmailLoading(true); setEmailError(""); setResetSent(false);
    try {
      if (mode === "signup") {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        if (name && name.trim()) {
          try { await updateProfile(cred.user, { displayName: name.trim() }); } catch { /* non-fatal */ }
        }
      } else if (mode === "reset") {
        await sendPasswordResetEmail(auth, email);
        setResetSent(true);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e) {
      setEmailError(translateAuthError(e.code) || e.message || "Error de autenticación");
    }
    setEmailLoading(false);
  };

  const clearAuthState = () => { setEmailError(""); setResetSent(false); };
  const handleLogout = async () => { await signOut(auth); setProcesses([]); setAgencySettings({ brandManual: "", emailConfig: { provider: "app" }, slackConfig: { webhookUrl: "" }, onboardingCompleted: false }); setSettingsLoaded(false); setShowOnboarding(false); setPhase("dashboard"); };
  const goToDashboard = () => { setPhase("dashboard"); setActiveJob(null); setCandidate(null); setEvaluation(null); setInterview(null); };
  const handlePublish = (jobData) => {
    // Save-only flow: create the process + return to the dashboard without
    // generating the public link. The recruiter can come back later to
    // publish it from the process detail screen.
    const np = { id: `p_${Date.now()}`, status: "active", createdAt: new Date().toISOString().split("T")[0], ...jobData, candidates: [] };
    setProcesses(ps => [np, ...ps]);
    setActiveJob(null);
    setPhase("dashboard");
  };

  // Publish-and-share flow: create the process AND navigate to its detail
  // screen with an autoShare flag. ProcessDetailScreen detects the flag,
  // auto-generates the public link (with the same missing-config modal if
  // the agency isn't set up), and opens the publish-posts modal on top.
  const [autoShareOnEntry, setAutoShareOnEntry] = useState(false);
  const handlePublishAndShare = (jobData) => {
    const np = { id: `p_${Date.now()}`, status: "active", createdAt: new Date().toISOString().split("T")[0], ...jobData, candidates: [] };
    setProcesses(ps => [np, ...ps]);
    setActiveJob(np);
    setAutoShareOnEntry(true);
    setPhase("process_detail");
  };
  const handleToggle = (id) => setProcesses(ps => ps.map(p => p.id === id ? { ...p, status: p.status === "active" ? "paused" : "active" } : p));
  const handleViewProcess = (process) => { setActiveJob(process); setPhase("process_detail"); };
  const handleStartDemo = (process) => { setActiveJob(process); setPhase("preview"); };
  const handleUpdateCandidates = (processId, updatedCandidates) => {
    setProcesses(ps => ps.map(p => p.id === processId ? { ...p, candidates: updatedCandidates } : p));
    setActiveJob(aj => aj?.id === processId ? { ...aj, candidates: updatedCandidates } : aj);
  };
  // Top-level process mutation (used e.g. to stamp publishedAt when the link
  // is generated — feeds the dashboard roadmap milestone).
  const handleUpdateProcess = (updated) => {
    setProcesses(ps => ps.map(p => p.id === updated.id ? { ...p, ...updated } : p));
    setActiveJob(aj => aj?.id === updated.id ? { ...aj, ...updated } : aj);
  };
  const handleSaveSettings = (newSettings) => { setAgencySettings(s => ({ ...s, ...newSettings })); };

  const handleCompleteOnboarding = (newSettings) => {
    setAgencySettings(s => ({ ...s, ...newSettings, onboardingCompleted: true }));
    setShowOnboarding(false);
  };

  if (authLoading || !settingsLoaded) return <LoadingScreen />;
  if (!user) return <LoginScreen
    onLogin={handleLogin} loading={loginLoading}
    onEmailAuth={handleEmailAuth} emailLoading={emailLoading}
    emailError={emailError} resetSent={resetSent}
    onClearAuthState={clearAuthState}
  />;
  if (showOnboarding) return <OnboardingScreen user={user} onComplete={handleCompleteOnboarding} />;

  return (
    <>
      {showSettings && <AgencySettingsModal settings={agencySettings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} initialSection={settingsInitialSection} />}
      <FeedbackWidget user={user} />
      {phase === "dashboard" && <RecruiterDashboard processes={processes} onNew={() => setPhase("setup")} onView={handleViewProcess} onToggle={handleToggle} user={user} onLogout={handleLogout} onOpenSettings={openSettings} agencySettings={agencySettings} />}
      {phase === "process_detail" && (() => { const lp = processes.find(p => p.id === activeJob?.id) || activeJob; return <ProcessDetailScreen process={lp} onBack={goToDashboard} onUpdate={handleUpdateCandidates} onUpdateProcess={handleUpdateProcess} user={user} onStartDemo={() => handleStartDemo(lp)} agencySettings={agencySettings} onOpenSettings={openSettings} autoShareOnEntry={autoShareOnEntry} clearAutoShare={() => setAutoShareOnEntry(false)} />; })()}
      {phase === "setup" && <RecruiterSetupScreen onPublish={handlePublish} onPublishAndShare={handlePublishAndShare} onBack={goToDashboard} />}
      {phase === "preview" && <JobPreviewScreen job={activeJob} onApply={() => setPhase("apply")} onBack={goToDashboard} />}
      {phase === "apply" && <CandidateApplyScreen job={activeJob} onNext={(form) => { setCandidate(form); setPhase("exercises"); }} />}
      {phase === "exercises" && <ExercisesScreen job={activeJob} candidate={candidate} onSubmit={(resps) => { setEvaluation(generateAIEvaluation(resps, activeJob)); setPhase("confirmation"); }} />}
      {phase === "confirmation" && <ConfirmationScreen candidate={candidate} onNext={() => setPhase("review")} />}
      {phase === "review" && <RecruiterReviewScreen job={activeJob} candidate={candidate} evaluation={evaluation} onApprove={() => setPhase("scheduling")} onReject={goToDashboard} />}
      {phase === "scheduling" && <InterviewInviteScreen job={activeJob} candidate={candidate} onSchedule={(slot) => { setInterview({ ...generateInterviewAnalysis(candidate?.name || "Candidato"), slot }); setPhase("interview"); }} />}
      {phase === "interview" && <InterviewAnalysisScreen analysis={interview} candidate={candidate} job={activeJob} onFinish={() => setPhase("final")} />}
      {phase === "final" && <FinalSummaryScreen job={activeJob} candidate={candidate} evaluation={evaluation} interview={interview} onRestart={goToDashboard} />}
    </>
  );
}

import { useState, useEffect } from "react";
import { auth, db, googleProvider, doc, getDoc, setDoc, signInWithPopup, signOut, onAuthStateChanged } from "./firebase.js";

// ─────────────────────────────────────────────
// UTILITY: AI evaluation engine (simulated)
// ─────────────────────────────────────────────
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
  if (overall >= 78) { rec = "AVANZAR"; summary = "El candidato muestra un perfil técnico sólido y bien argumentado. La IA recomienda avanzar a la fase de entrevista."; }
  else if (overall >= 55) { rec = "REVISAR"; summary = "El candidato presenta aspectos positivos pero también áreas de mejora. Se recomienda revisar en detalle antes de decidir."; }
  else { rec = "DESCARTAR"; summary = "El candidato no alcanza el nivel mínimo requerido. La IA no recomienda avanzar en el proceso."; }
  return { evaluations, overall, rec, summary };
}

function generateInterviewAnalysis(name) {
  return {
    transcript: [
      { who: "Reclutador", text: `Buenos días, ${name.split(" ")[0]}. ¿Puedes presentarte brevemente y contarme tu experiencia más relevante para esta posición?` },
      { who: name, text: "Buenos días. Llevo 6 años en marketing digital, con los últimos 3 especializados en Paid Media. He gestionado presupuestos de hasta 500k€ anuales y lideré un equipo de 4 media buyers. Me apasiona combinar el dato con la estrategia creativa." },
      { who: "Reclutador", text: "¿Cuál ha sido tu mayor reto profesional y cómo lo resolviste?" },
      { who: name, text: "Sin duda, la migración post-iOS 14. Rediseñamos el modelo de atribución, implementamos server-side tracking y creamos dashboards propios. En un trimestre recuperamos el ROAS objetivo y el cliente amplió presupuesto." },
      { who: "Reclutador", text: "¿Cómo gestionas la presión con múltiples clientes simultáneos?" },
      { who: name, text: "Trabajo con sprints semanales, priorización por impacto-urgencia y alertas tempranas. Me anticipo a los problemas antes de que escalen al cliente." },
      { who: "Reclutador", text: "¿Cómo entiendes el encaje con la cultura de trabajo de esta agencia?" },
      { who: name, text: "Valoro la autonomía, la orientación a resultados y la confianza mutua. Me considero alguien que propone, no solo ejecuta." },
    ],
    candidate: {
      score: 84,
      strengths: ["Experiencia técnica multiplataforma sólida", "Capacidad de liderazgo con casos concretos", "Pensamiento estratégico y orientación a datos", "Comunicación clara y segura"],
      gaps: ["Podría profundizar más en gestión de equipos 100% remotos", "Faltó mencionar experiencia con infoproductos"],
      rec: "CONTRATAR",
      summary: `${name} demuestra un perfil técnico y estratégico muy sólido. Se recomienda avanzar a oferta.`,
    },
    recruiter: {
      score: 72,
      did_well: ["Preguntas bien estructuradas y progresivas", "Tono profesional y cercano durante toda la entrevista"],
      improve: ["Faltó explorar motivaciones intrínsecas y proyección de carrera", "No se utilizaron preguntas STAR de forma sistemática"],
      tips: ["Incluir 2-3 preguntas STAR (Situación, Tarea, Acción, Resultado)", "Reservar los últimos 5 min para que el candidato pregunte", "Tomar notas estructuradas durante la entrevista"],
    },
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
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${i < idx ? "bg-green-500 text-white" : i === idx ? "bg-blue-600 text-white shadow-md scale-110" : "bg-gray-100 text-gray-400"}`}>{i < idx ? "✓" : s.icon}</div>
            <span className="text-xs mt-1 hidden sm:block" style={{ color: i <= idx ? "#374151" : "#9CA3AF" }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className={`w-6 sm:w-10 h-0.5 mx-1 ${i < idx ? "bg-green-400" : "bg-gray-200"}`} />}
        </div>
      ))}
    </div>
  );
}

function PhaseBadge({ phase }) {
  const map = { applied: { cls: "bg-blue-100 text-blue-700", label: "Aplicó" }, review: { cls: "bg-yellow-100 text-yellow-700", label: "En revisión" }, interview: { cls: "bg-purple-100 text-purple-700", label: "Entrevista" }, hired: { cls: "bg-green-100 text-green-700", label: "Contratado" }, rejected: { cls: "bg-red-100 text-red-700", label: "Descartado" } };
  const c = map[phase] || { cls: "bg-gray-100 text-gray-600", label: phase };
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.cls}`}>{c.label}</span>;
}

const inp = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white";
const lbl = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1";

const MOCK_PROCESSES = [
  { id: "p1", status: "active", createdAt: "2026-03-10", company: { name: "Proelia Digital", sector: "Marketing Digital", location: "Madrid / Remoto", modality: "Remoto", salaryMin: "40000", salaryMax: "55000", currency: "EUR", description: "Agencia especializada en infoproductos." }, position: { positionType: "media_buyer", specialty: "", customTitle: "", responsibilities: "Liderar la estrategia de paid media.", skills: "Meta Ads, Google Ads, TikTok Ads, liderazgo", experience: "5", contract: "Freelance", hoursPerWeek: "20", schedule: "Flexible", benefits: "" }, exercises: [{ id: 1, title: "Ejercicio Estratégico", description: "Diseña una estrategia de paid media para un lanzamiento de curso online.", criteria: [{ area: "Diagnóstico estratégico", indicators: "Análisis coherente con la situación del cliente", maxScore: 5 }, { area: "Funnel y táctica", indicators: "Claridad en campañas y fases", maxScore: 5 }] }], candidates: [{ id: "c1", name: "Laura Martínez", email: "laura@example.com", phase: "review" }, { id: "c2", name: "Carlos Ruiz", email: "carlos@example.com", phase: "applied" }, { id: "c3", name: "Ana Gómez", email: "ana@example.com", phase: "interview" }, { id: "c4", name: "Pedro Sanz", email: "pedro@example.com", phase: "hired" }] },
  { id: "p2", status: "active", createdAt: "2026-02-20", company: { name: "Proelia Digital", sector: "Marketing Digital", location: "Remoto", modality: "Remoto", salaryMin: "28000", salaryMax: "38000", currency: "EUR", description: "" }, position: { positionType: "media_buyer", specialty: "", customTitle: "", responsibilities: "Gestión de campañas de paid media.", skills: "Meta Ads, Google Ads, análisis de datos", experience: "3", contract: "Contrato directo", hoursPerWeek: "40", schedule: "Mañanas", benefits: "Formación continua" }, exercises: [{ id: 1, title: "Caso Práctico", description: "Analiza las métricas de una cuenta y propón mejoras.", criteria: [{ area: "Análisis de datos", indicators: "Lectura correcta de métricas", maxScore: 5 }] }], candidates: [{ id: "c5", name: "Marta López", email: "marta@example.com", phase: "applied" }, { id: "c6", name: "Javier Torres", email: "javier@example.com", phase: "rejected" }] },
  { id: "p3", status: "paused", createdAt: "2026-01-15", company: { name: "Proelia Digital", sector: "Marketing Digital", location: "Remoto", modality: "Remoto", salaryMin: "24000", salaryMax: "32000", currency: "EUR", description: "" }, position: { positionType: "copywriter", specialty: "Email Marketing", customTitle: "", responsibilities: "Crear y gestionar contenido estratégico.", skills: "Copywriting, SEO, email marketing", experience: "2", contract: "Freelance", hoursPerWeek: "15", schedule: "Flexible", benefits: "" }, exercises: [{ id: 1, title: "Ejercicio de Copy", description: "Escribe una secuencia de 3 emails de venta para un infoproducto.", criteria: [{ area: "Persuasión y estructura", indicators: "Claridad del mensaje y llamada a la acción", maxScore: 5 }] }], candidates: [{ id: "c7", name: "Sofía Blanco", email: "sofia@example.com", phase: "hired" }] },
];

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
    <div className="rounded-xl border-2 border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-4 mt-3">
      <div className="flex items-start gap-2 mb-3">
        <span className="text-lg leading-none">💡</span>
        <div className="flex-1"><p className="text-sm font-bold text-blue-800 leading-none">Referencia salarial de mercado</p><p className="text-xs text-blue-500 mt-0.5">{data.label} · España 2026</p></div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {tiers.map(t => {
          const [lo, hi] = data[t.key].map(v => Math.round(v * adj));
          return (
            <div key={t.key} className="bg-white rounded-lg p-2.5 text-center border border-blue-100 shadow-sm">
              <p className="text-xs font-bold text-gray-500 mb-0.5">{t.label}</p>
              <p className="text-sm font-black text-gray-800">{fmt(lo)}–{fmt(hi)}</p>
              <p className="text-xs text-gray-400 mb-1.5">{t.exp}</p>
              <button type="button" onClick={() => onApplyRanges(lo, hi)} className="w-full text-xs bg-blue-50 hover:bg-blue-100 text-blue-600 font-semibold py-1 rounded-md transition-colors">Usar este rango</button>
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

const defaultJob = {
  company: { name: "Proelia Digital", description: "Agencia de marketing digital especializada en infoproductos y lanzamientos online.", sector: "Marketing Digital", location: "Madrid / Remoto", modality: "Remoto", salaryMin: "", salaryMax: "", currency: "EUR" },
  position: { positionType: "media_buyer", specialty: "", customTitle: "", responsibilities: "", skills: "", experience: "3", contract: "Freelance", hoursPerWeek: "20", schedule: "Flexible", benefits: "" },
  exercises: [{ id: 1, title: "Ejercicio Práctico", description: "", criteria: [{ area: "Análisis y diagnóstico", indicators: "Capacidad de identificar el problema y proponer soluciones", maxScore: 5 }, { area: "Propuesta estratégica", indicators: "Coherencia y calidad de la propuesta presentada", maxScore: 5 }] }],
};
function RecruiterSetupScreen({ onPublish, onBack }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState(defaultJob);
  const [salaryApplied, setSalaryApplied] = useState(false);
  const upC = (f, v) => setData(d => ({ ...d, company: { ...d.company, [f]: v } }));
  const upP = (f, v) => setData(d => ({ ...d, position: { ...d.position, [f]: v } }));
  const applySalary = (lo, hi) => { upC("salaryMin", String(lo)); upC("salaryMax", String(hi)); setSalaryApplied(true); setTimeout(() => setSalaryApplied(false), 3000); };
  const addEx = () => setData(d => ({ ...d, exercises: [...d.exercises, { id: Date.now(), title: `Ejercicio ${d.exercises.length + 1}`, description: "", criteria: [{ area: "", indicators: "", maxScore: 5 }] }] }));
  const delEx = (id) => setData(d => ({ ...d, exercises: d.exercises.filter(e => e.id !== id) }));
  const upEx = (id, f, v) => setData(d => ({ ...d, exercises: d.exercises.map(e => e.id === id ? { ...e, [f]: v } : e) }));
  const addCr = (eid) => setData(d => ({ ...d, exercises: d.exercises.map(e => e.id === eid ? { ...e, criteria: [...e.criteria, { area: "", indicators: "", maxScore: 5 }] } : e) }));
  const delCr = (eid, i) => setData(d => ({ ...d, exercises: d.exercises.map(e => e.id === eid ? { ...e, criteria: e.criteria.filter((_, j) => j !== i) } : e) }));
  const upCr = (eid, i, f, v) => setData(d => ({ ...d, exercises: d.exercises.map(e => e.id === eid ? { ...e, criteria: e.criteria.map((c, j) => j === i ? { ...c, [f]: v } : c) } : e) }));
  const tabs = ["Empresa", "Posición", "Ejercicios"];
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-sm">← Volver al panel</button>
          <div className="w-px h-4 bg-gray-200" />
          <span className="text-2xl font-black text-blue-600">RecruitAI</span>
          <span className="text-xs text-gray-400">/ Nuevo proceso</span>
        </div>
      </div>
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white">⚙️</div>
          <div><h1 className="text-xl font-bold text-gray-900">Configurar proceso de selección</h1><p className="text-gray-400 text-sm">Paso {step + 1} de 3 — {tabs[step]}</p></div>
        </div>
        <div className="flex gap-2 mb-6">
          {tabs.map((t, i) => <button key={t} onClick={() => i < step && setStep(i)} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${i === step ? "bg-blue-600 text-white shadow" : i < step ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>{i < step ? "✓ " : ""}{t}</button>)}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="font-bold text-gray-800 mb-4">Información de la empresa contratadora</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><label className={lbl}>Nombre de la empresa *</label><input className={inp} value={data.company.name} onChange={e => upC("name", e.target.value)} /></div>
                <div className="col-span-2"><label className={lbl}>Descripción de la empresa</label><textarea className={inp} rows={3} value={data.company.description} onChange={e => upC("description", e.target.value)} /></div>
                <div><label className={lbl}>Sector</label><input className={inp} value={data.company.sector} onChange={e => upC("sector", e.target.value)} /></div>
                <div><label className={lbl}>Ubicación</label><input className={inp} value={data.company.location} onChange={e => upC("location", e.target.value)} /></div>
                <div><label className={lbl}>Modalidad</label><select className={inp} value={data.company.modality} onChange={e => upC("modality", e.target.value)}>{["Remoto", "Presencial", "Híbrido"].map(m => <option key={m}>{m}</option>)}</select></div>
              </div>
            </div>
          )}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="font-bold text-gray-800">Posición y requisitos</h2>
              <div>
                <label className={lbl}>Tipo de posición *</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {POSITIONS.map(pos => (
                    <button key={pos.id} type="button" onClick={() => { upP("positionType", pos.id); upP("specialty", ""); }}
                      className={`p-3 rounded-xl border-2 text-left transition-all ${data.position.positionType === pos.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300 hover:bg-gray-50"}`}>
                      <div className="text-xl mb-1">{pos.icon}</div>
                      <p className={`text-xs font-semibold leading-tight ${data.position.positionType === pos.id ? "text-blue-700" : "text-gray-700"}`}>{pos.label}</p>
                    </button>
                  ))}
                </div>
              </div>
              {(() => { const pos = POSITIONS.find(p => p.id === data.position.positionType); return pos && pos.specialties.length > 0 ? (<div><label className={lbl}>Especialidad</label><div className="flex flex-wrap gap-2 mt-1">{pos.specialties.map(sp => (<button key={sp} type="button" onClick={() => upP("specialty", data.position.specialty === sp ? "" : sp)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${data.position.specialty === sp ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:border-blue-300"}`}>{sp}</button>))}</div></div>) : null; })()}
              {data.position.positionType === "otro" && (<div><label className={lbl}>Nombre del puesto personalizado *</label><input className={inp} value={data.position.customTitle || ""} onChange={e => upP("customTitle", e.target.value)} placeholder="ej. Growth Hacker, SEO Specialist..." /></div>)}
              <div><label className={lbl}>Responsabilidades principales</label><textarea className={inp} rows={3} value={data.position.responsibilities} onChange={e => upP("responsibilities", e.target.value)} /></div>
              <div><label className={lbl}>Habilidades requeridas (separadas por comas)</label><textarea className={inp} rows={2} value={data.position.skills} onChange={e => upP("skills", e.target.value)} /></div>
              <div className="border border-gray-200 rounded-xl p-4 space-y-4 bg-gray-50">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Condiciones del contrato</p>
                <div>
                  <label className={lbl}>Tipo de relación contractual *</label>
                  <div className="flex gap-3 mt-1">
                    {[["Freelance", "🤝 Freelance"], ["Contrato directo", "📄 Contrato directo"]].map(([val, label]) => (
                      <button key={val} type="button" onClick={() => upP("contract", val)} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${data.position.contract === val ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-blue-200"}`}>{label}</button>
                    ))}
                  </div>
                </div>
                <SalaryWidget positionType={data.position.positionType} contract={data.position.contract} onApplyRanges={applySalary} />
                {salaryApplied && (<div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 font-medium"><span>✅</span> Rango aplicado — puedes ajustarlo a continuación</div>)}
                <div className="grid grid-cols-3 gap-3">
                  <div><label className={lbl}>Moneda</label><select className={inp} value={data.company.currency} onChange={e => upC("currency", e.target.value)}>{["EUR", "USD", "GBP", "MXN"].map(m => <option key={m}>{m}</option>)}</select></div>
                  <div><label className={lbl}>Salario mín./año</label><input className={inp} type="number" placeholder="ej. 28000" value={data.company.salaryMin} onChange={e => upC("salaryMin", e.target.value)} /></div>
                  <div><label className={lbl}>Salario máx./año</label><input className={inp} type="number" placeholder="ej. 40000" value={data.company.salaryMax} onChange={e => upC("salaryMax", e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={lbl}>Horas semanales * <span className="text-gray-400 normal-case font-normal">(máx. 40h)</span></label>
                    <input className={inp + (parseInt(data.position.hoursPerWeek) > 40 ? " border-red-400" : "")} type="number" min={1} max={40} value={data.position.hoursPerWeek} onChange={e => upP("hoursPerWeek", Math.min(40, parseInt(e.target.value) || 0).toString())} placeholder="ej. 20" />
                    {parseInt(data.position.hoursPerWeek) >= 40 && <p className="text-xs text-orange-500 mt-1">⚠️ Límite máximo: 40h semanales</p>}
                  </div>
                  <div>
                    <label className={lbl}>Horario *</label>
                    <div className="flex flex-col gap-1.5 mt-1">
                      {[["Mañanas", "🌅"], ["Tardes", "🌆"], ["Flexible", "🕐"]].map(([h, icon]) => (<button key={h} type="button" onClick={() => upP("schedule", h)} className={`py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${data.position.schedule === h ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500 hover:border-blue-200"}`}>{icon} {h}</button>))}
                    </div>
                  </div>
                </div>
                <div><label className={lbl}>Años de experiencia mínimos</label><input className={inp} type="number" min={0} max={20} value={data.position.experience} onChange={e => upP("experience", e.target.value)} /></div>
                <div><label className={lbl}>Otros beneficios</label><textarea className={inp} rows={2} value={data.position.benefits} onChange={e => upP("benefits", e.target.value)} placeholder="ej. Formación continua, herramientas incluidas..." /></div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <h2 className="font-bold text-gray-800">Ejercicios prácticos y criterios</h2>
                <button onClick={addEx} className="text-sm bg-blue-50 text-blue-600 px-4 py-1.5 rounded-lg font-medium hover:bg-blue-100">+ Añadir ejercicio</button>
              </div>
              <p className="text-xs text-gray-400 mb-4">Cada ejercicio requiere respuesta escrita + vídeo de defensa del candidato.</p>
              {data.exercises.map(ex => (
                <div key={ex.id} className="border border-gray-200 rounded-xl p-4 mb-4 bg-gray-50">
                  <div className="flex items-center gap-2 mb-3">
                    <input className="flex-1 bg-transparent border-b border-dashed border-gray-300 text-sm font-bold text-gray-800 focus:outline-none focus:border-blue-400 pb-1" value={ex.title} onChange={e => upEx(ex.id, "title", e.target.value)} />
                    {data.exercises.length > 1 && <button onClick={() => delEx(ex.id)} className="text-red-300 hover:text-red-500 text-xl">×</button>}
                  </div>
                  <div className="mb-4">
                    <label className={lbl}>Enunciado del ejercicio</label>
                    <textarea className={inp + " bg-white"} rows={4} value={ex.description} onChange={e => upEx(ex.id, "description", e.target.value)} placeholder="Describe el reto o caso que el candidato deberá resolver..." />
                    <p className="text-xs text-blue-500 mt-1.5 flex items-center gap-1.5"><span>💡</span><span>Cuanto más detallado sea el enunciado, mejores respuestas recibirás del candidato.</span></p>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2"><label className={lbl}>Criterios de evaluación</label><button onClick={() => addCr(ex.id)} className="text-xs text-blue-500 hover:underline">+ Criterio</button></div>
                    {ex.criteria.map((cr, ci) => (
                      <div key={ci} className="flex gap-2 items-start bg-white rounded-lg p-3 mb-2 border border-gray-100">
                        <div className="flex-1 space-y-2">
                          <input className={inp} value={cr.area} onChange={e => upCr(ex.id, ci, "area", e.target.value)} placeholder="Área evaluada" />
                          <input className={inp} value={cr.indicators} onChange={e => upCr(ex.id, ci, "indicators", e.target.value)} placeholder="Indicadores clave de evaluación..." />
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                          <span className="text-xs text-gray-400">Pts</span>
                          <input className="w-14 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-blue-400" type="number" min={1} max={10} value={cr.maxScore} onChange={e => upCr(ex.id, ci, "maxScore", parseInt(e.target.value) || 5)} />
                        </div>
                        {ex.criteria.length > 1 && <button onClick={() => delCr(ex.id, ci)} className="text-red-300 hover:text-red-500 text-xl mt-1">×</button>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex justify-between mt-6 pt-4 border-t border-gray-100">
            {step > 0 ? <button onClick={() => setStep(s => s - 1)} className="px-5 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">← Anterior</button> : <div />}
            {step < 2 ? <button onClick={() => setStep(s => s + 1)} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700">Siguiente →</button> : <button onClick={() => onPublish(data)} className="px-6 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700">🚀 Publicar oferta</button>}
          </div>
        </div>
      </div>
    </div>
  );
}


function JobPreviewScreen({ job, onApply, onBack }) {
  return (
    <div className="min-h-screen bg-gray-200 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-gray-700 text-white rounded-t-xl px-4 py-2.5 flex items-center gap-3">
          <div className="flex gap-1.5"><div className="w-3 h-3 rounded-full bg-red-400" /><div className="w-3 h-3 rounded-full bg-yellow-400" /><div className="w-3 h-3 rounded-full bg-green-400" /></div>
          <div className="flex-1 bg-gray-600 rounded px-3 py-1 text-xs text-gray-300">linkedin.com/jobs/view/head-of-paid-media-{job.company.name.toLowerCase().replace(/\s/g, "-")}</div>
        </div>

        <div className="bg-white px-6 pt-4 pb-2 border-b border-gray-200 flex items-center gap-4">
          <div className="text-2xl font-bold text-blue-700">in</div>
          <div className="flex-1 bg-gray-100 rounded-full px-4 py-2 text-sm text-gray-400">Buscar empleos</div>
        </div>

        <div className="bg-white shadow-xl">
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center text-white text-2xl font-black flex-shrink-0">{job.company.name[0]}</div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{job.position.title}</h1>
                <p className="text-blue-600 font-semibold">{job.company.name}</p>
                <p className="text-gray-500 text-sm">{job.company.location} · {job.company.modality} · {job.position.contract}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">{job.company.sector}</span>
                  {job.company.salaryMin && <span className="text-xs bg-green-50 text-green-700 px-2.5 py-1 rounded-full font-medium">{Number(job.company.salaryMin).toLocaleString()} – {Number(job.company.salaryMax).toLocaleString()} {job.company.currency}/año</span>}
                  <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">+{job.position.experience} años exp.</span>
                </div>
              </div>
            </div>
            <button onClick={onApply} className="mt-4 w-full bg-blue-600 text-white py-2.5 rounded-full font-bold hover:bg-blue-700 text-sm">Solicitar empleo</button>
          </div>

          <div className="p-6 space-y-5 text-sm text-gray-700">
            <section><h3 className="font-bold text-gray-900 mb-2">Sobre {job.company.name}</h3><p>{job.company.description}</p></section>
            <section><h3 className="font-bold text-gray-900 mb-2">Responsabilidades</h3><p className="whitespace-pre-wrap">{job.position.responsibilities}</p></section>
            <section>
              <h3 className="font-bold text-gray-900 mb-2">Habilidades</h3>
              <div className="flex flex-wrap gap-2">{job.position.skills.split(",").map((s) => <span key={s} className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs">{s.trim()}</span>)}</div>
            </section>
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="font-semibold text-blue-800 mb-1">📋 Proceso 100% digital con evaluación IA</p>
              <p className="text-xs text-blue-600">Este proceso incluye {job.exercises.length} ejercicio(s) práctico(s). Cada uno requiere una respuesta escrita y un vídeo de defensa. Recibirás feedback en menos de 48h.</p>
            </div>
          </div>

          <div className="p-6 pt-0">
            <button onClick={onApply} className="w-full bg-blue-600 text-white py-3 rounded-full font-bold hover:bg-blue-700">Solicitar empleo</button>
            <button onClick={onBack} className="w-full mt-2 text-sm text-gray-400 hover:text-gray-600 py-2">← Editar oferta</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 4: CANDIDATE APPLICATION
// ─────────────────────────────────────────────
function CandidateApplyScreen({ job, onNext }) {
  const [form, setForm] = useState({ name: "Ana García López", email: "ana.garcia@email.com", phone: "+34 612 345 678", linkedin: "linkedin.com/in/anagarcia", presentation: "", video: false });
  const up = (f, v) => setForm((d) => ({ ...d, [f]: v }));
  const valid = form.name && form.email && form.presentation.trim().length > 20;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-t-2xl p-6">
          <p className="text-purple-200 text-sm mb-1">Vista candidato</p>
          <h1 className="text-xl font-bold">Aplicar a: {job.position.title}</h1>
          <p className="text-purple-200 text-sm">{job.company.name} · {job.company.location}</p>
        </div>

        <div className="bg-white rounded-b-2xl shadow-lg p-6 space-y-5">
          <h2 className="font-bold text-gray-800">Tus datos</h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1"><label className={lbl}>Nombre completo *</label><input className={inp} value={form.name} onChange={(e) => up("name", e.target.value)} /></div>
            <div className="col-span-2 sm:col-span-1"><label className={lbl}>Teléfono</label><input className={inp} value={form.phone} onChange={(e) => up("phone", e.target.value)} /></div>
            <div><label className={lbl}>Email *</label><input className={inp} value={form.email} onChange={(e) => up("email", e.target.value)} /></div>
            <div><label className={lbl}>LinkedIn</label><input className={inp} value={form.linkedin} onChange={(e) => up("linkedin", e.target.value)} /></div>
          </div>

          <div>
            <label className={lbl}>Presentación personal *</label>
            <textarea className={inp} rows={5} value={form.presentation} onChange={(e) => up("presentation", e.target.value)} placeholder="Cuéntanos sobre ti, tu trayectoria y por qué eres el perfil ideal para esta posición..." />
            <p className="text-xs text-gray-400 mt-1">{form.presentation.split(/\s+/).filter(Boolean).length} palabras</p>
          </div>

          <div className="border-2 border-dashed border-gray-200 rounded-xl p-5 text-center">
            <div className="text-3xl mb-2">🎥</div>
            <p className="font-semibold text-gray-700 text-sm mb-1">Vídeo de presentación personal (máx. 3 min)</p>
            <p className="text-xs text-gray-400 mb-3">Graba o sube un vídeo breve presentándote</p>
            {form.video ? (
              <div className="bg-green-50 text-green-700 text-sm rounded-lg p-3 flex items-center justify-center gap-2">
                <span>✅</span><span>presentacion_ana_garcia.mp4 — 2:47</span>
                <button onClick={() => up("video", false)} className="text-green-400 hover:text-green-600 ml-1">×</button>
              </div>
            ) : (
              <button onClick={() => up("video", true)} className="bg-purple-50 text-purple-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-purple-100">
                📁 Simular subida de vídeo
              </button>
            )}
          </div>

          <button onClick={() => onNext(form)} disabled={!valid} className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Continuar con los ejercicios →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 5: EXERCISES (text + mandatory defence video per exercise)
// ─────────────────────────────────────────────
function ExercisesScreen({ job, candidate, onSubmit }) {
  const [idx, setIdx] = useState(0);
  // Each response tracks: written answer + mandatory defence video
  const [resps, setResps] = useState(
    job.exercises.map((e) => ({ exerciseId: e.id, response: "", defenceVideo: false, file: false }))
  );

  const ex = job.exercises[idx];
  const resp = resps.find((r) => r.exerciseId === ex.id);
  const wc = resp?.response.split(/\s+/).filter(Boolean).length || 0;

  const upResp = (id, field, val) =>
    setResps((rs) => rs.map((r) => r.exerciseId === id ? { ...r, [field]: val } : r));

  // Both written answer AND defence video are required for each exercise
  const currentComplete = resp?.response.trim().length > 10 && resp?.defenceVideo;
  const allComplete = resps.every((r) => r.response.trim().length > 10 && r.defenceVideo);

  const completedCount = resps.filter((r) => r.response.trim().length > 10 && r.defenceVideo).length;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-t-2xl p-6">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-indigo-200 text-sm">Hola, {candidate.name.split(" ")[0]} 👋</p>
              <h1 className="text-xl font-bold mt-0.5">Ejercicios Prácticos</h1>
              <p className="text-indigo-200 text-xs mt-1">Cada ejercicio requiere respuesta escrita + vídeo de defensa</p>
            </div>
            <div className="text-right bg-white/10 rounded-xl px-4 py-2">
              <p className="text-indigo-200 text-xs">Ejercicio</p>
              <p className="text-2xl font-black">{idx + 1}<span className="text-indigo-300 text-base font-normal">/{job.exercises.length}</span></p>
            </div>
          </div>
          {/* Progress dots */}
          <div className="flex gap-1.5 mt-4">
            {job.exercises.map((e, i) => {
              const r = resps.find((r) => r.exerciseId === e.id);
              const done = r?.response.trim().length > 10 && r?.defenceVideo;
              return (
                <div key={i} className={`h-1.5 flex-1 rounded-full transition-all ${done ? "bg-green-400" : i === idx ? "bg-white" : "bg-indigo-400"}`} />
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-b-2xl shadow-lg p-6">
          {/* Exercise title + description */}
          <span className="text-xs font-bold text-indigo-500 uppercase tracking-widest">{ex.title}</span>
          <p className="text-gray-800 text-sm mt-2 mb-4 leading-relaxed">{ex.description}</p>

          {/* Criteria */}
          <div className="bg-indigo-50 rounded-xl p-4 mb-5 border border-indigo-100">
            <p className="text-xs font-bold text-indigo-600 uppercase tracking-wide mb-2">Criterios de evaluación</p>
            {ex.criteria.map((c, i) => (
              <div key={i} className="flex gap-2 mb-1.5 items-start">
                <span className="text-indigo-400 text-xs mt-0.5">▸</span>
                <p className="text-xs text-indigo-800"><span className="font-semibold">{c.area}:</span> {c.indicators} <span className="text-indigo-400">({c.maxScore} pts)</span></p>
              </div>
            ))}
          </div>

          {/* Written answer */}
          <div className="mb-5">
            <div className="flex justify-between mb-1">
              <label className={lbl}>
                Respuesta escrita <span className="text-red-500">*</span>
              </label>
              <span className={`text-xs font-medium ${wc > 150 ? "text-green-600" : wc > 60 ? "text-yellow-600" : "text-gray-400"}`}>{wc} palabras</span>
            </div>
            <textarea
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              rows={9}
              value={resp?.response || ""}
              onChange={(e) => upResp(ex.id, "response", e.target.value)}
              placeholder="Escribe tu respuesta aquí de forma detallada y estructurada..."
            />
          </div>

          {/* Defence video — MANDATORY */}
          <div className={`rounded-xl p-5 border-2 transition-all mb-4 ${resp?.defenceVideo ? "border-green-300 bg-green-50" : "border-dashed border-red-200 bg-red-50"}`}>
            <div className="flex items-start gap-3">
              <div className="text-2xl flex-shrink-0">{resp?.defenceVideo ? "✅" : "🎥"}</div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <p className={`font-semibold text-sm ${resp?.defenceVideo ? "text-green-800" : "text-red-700"}`}>
                    Vídeo de defensa del ejercicio
                  </p>
                  <span className="text-xs font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">OBLIGATORIO</span>
                </div>
                <p className={`text-xs mb-3 ${resp?.defenceVideo ? "text-green-700" : "text-red-600"}`}>
                  Graba un vídeo (máx. 5 min) explicando y defendiendo tu propuesta. El equipo evaluará tanto la respuesta escrita como tu presentación oral.
                </p>
                {resp?.defenceVideo ? (
                  <div className="flex items-center justify-between bg-white rounded-lg px-4 py-2.5 border border-green-200">
                    <div className="flex items-center gap-2 text-sm text-green-700">
                      <span>🎬</span>
                      <span className="font-medium">defensa_{ex.title.toLowerCase().replace(/\s/g, "_")}.mp4</span>
                      <span className="text-green-500">— 4:12 min</span>
                    </div>
                    <button
                      onClick={() => upResp(ex.id, "defenceVideo", false)}
                      className="text-red-400 hover:text-red-600 text-sm"
                    >
                      × Quitar
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => upResp(ex.id, "defenceVideo", true)}
                      className="flex-1 bg-red-600 text-white px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-red-700 transition-colors"
                    >
                      🎬 Subir vídeo de defensa
                    </button>
                    <button
                      onClick={() => upResp(ex.id, "defenceVideo", true)}
                      className="bg-white border border-red-200 text-red-600 px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
                    >
                      🔴 Grabar ahora
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Optional file attachment */}
          <div className="border border-dashed border-gray-200 rounded-xl p-3 text-center mb-5">
            {resp?.file ? (
              <div className="flex items-center justify-center gap-2 text-sm text-green-600">
                <span>📎</span><span>ejercicio_adjunto.pdf</span>
                <button onClick={() => upResp(ex.id, "file", false)} className="text-gray-400 hover:text-gray-600 ml-1">×</button>
              </div>
            ) : (
              <button onClick={() => upResp(ex.id, "file", true)} className="text-gray-400 text-xs hover:text-gray-600">
                📎 Adjuntar archivo de soporte adicional (opcional)
              </button>
            )}
          </div>

          {/* Completion status for this exercise */}
          {!currentComplete && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-xs text-amber-700">
              <span className="font-semibold">Para continuar necesitas:</span>
              {!resp?.response && <span className="ml-2">✏️ Respuesta escrita</span>}
              {!resp?.defenceVideo && <span className="ml-2">🎥 Vídeo de defensa</span>}
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3">
            {idx > 0 && (
              <button onClick={() => setIdx((i) => i - 1)} className="flex-1 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">← Anterior</button>
            )}
            {idx < job.exercises.length - 1 ? (
              <button
                onClick={() => setIdx((i) => i + 1)}
                disabled={!currentComplete}
                className="flex-1 py-3 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Siguiente ejercicio →
              </button>
            ) : (
              <button
                onClick={() => onSubmit(resps)}
                disabled={!allComplete}
                className="flex-1 py-3 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {allComplete ? "Enviar candidatura 🚀" : `Faltan ${job.exercises.length - completedCount} ejercicio(s) por completar`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 6: SUBMITTED CONFIRMATION
// ─────────────────────────────────────────────
function ConfirmationScreen({ candidate, onNext }) {
  const [done, setDone] = useState(false);
  useEffect(() => { const t = setTimeout(() => setDone(true), 2800); return () => clearTimeout(t); }, []);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
        {!done ? (
          <>
            <div className="text-6xl mb-5" style={{ animation: "spin 1.5s linear infinite", display: "inline-block" }}>🤖</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Evaluando tu candidatura...</h2>
            <p className="text-gray-500 text-sm mb-6">La IA está analizando tus respuestas escritas y transcribiendo los vídeos de defensa</p>
            <div className="space-y-2 text-left">
              {["Procesando respuestas escritas...", "Transcribiendo vídeos de defensa...", "Aplicando criterios de evaluación...", "Generando informe preliminar..."].map((step, i) => (
                <div key={i} className="flex items-center gap-3 text-sm text-gray-500">
                  <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  </div>
                  {step}
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="text-6xl mb-4">✅</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">¡Candidatura recibida!</h2>
            <p className="text-gray-600 text-sm mb-5">Hola <strong>{candidate.name.split(" ")[0]}</strong>, hemos recibido tus ejercicios y vídeos de defensa correctamente.</p>
            <div className="bg-gray-50 rounded-xl p-4 text-left text-sm text-gray-600 mb-6 space-y-2 border border-gray-100">
              <p className="font-semibold text-gray-800 mb-2">¿Qué pasa ahora?</p>
              <div className="flex gap-2"><span>🔍</span><span>La IA ha evaluado tus respuestas escritas y transcrito los vídeos de defensa</span></div>
              <div className="flex gap-2"><span>👤</span><span>El reclutador revisará la evaluación preliminar en un máximo de 48h</span></div>
              <div className="flex gap-2"><span>📧</span><span>Recibirás un email en <strong>{candidate.email}</strong> con la respuesta</span></div>
              <div className="flex gap-2"><span>📅</span><span>Si avanzas, tendrás acceso directo al calendario para agendar la entrevista</span></div>
            </div>
            <button onClick={onNext} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700">
              Ver panel del reclutador →
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 7: RECRUITER REVIEW (AI evaluation)
// ─────────────────────────────────────────────
function RecruiterReviewScreen({ job, candidate, evaluation, onApprove, onReject }) {
  const { evaluations, overall, rec, summary } = evaluation;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-2xl">🤖</div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Evaluación IA — Candidatura recibida</h1>
            <p className="text-gray-400 text-sm">Análisis automático de respuestas escritas + vídeos de defensa · Acción requerida</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-purple-100 rounded-full flex items-center justify-center text-2xl font-bold text-purple-600">{candidate.name[0]}</div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">{candidate.name}</h2>
                <p className="text-gray-500 text-sm">{candidate.email} · {candidate.linkedin}</p>
                <p className="text-xs text-gray-400">{job.position.title}</p>
              </div>
            </div>
            <div className="text-right">
              <ScoreDial score={overall} />
              <p className="text-xs text-gray-400 mt-1">Puntuación global</p>
              <div className="mt-2"><Badge type={rec} /></div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-sm text-gray-600 italic bg-gray-50 rounded-lg px-4 py-3">{summary}</p>
          </div>
        </div>

        {evaluations.map((ev, i) => (
          <div key={i} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-4">
            <div className="flex justify-between items-start mb-2">
              <h3 className="font-bold text-gray-800">{ev.exerciseTitle}</h3>
              <div className="text-right">
                <span className="text-3xl font-black text-blue-600">{ev.total}</span>
                <span className="text-gray-400 text-sm font-normal">/{ev.maxTotal}</span>
                <p className="text-xs text-gray-400">{ev.pct}%</p>
              </div>
            </div>

            {/* Video analysis note */}
            <div className="flex items-center gap-2 bg-violet-50 rounded-lg px-3 py-2 mb-4 text-xs text-violet-700 border border-violet-100">
              <span>🎬</span>
              <span><strong>Vídeo de defensa analizado:</strong> Transcripción procesada. Comunicación oral: clara y estructurada. Seguridad en la exposición: alta.</span>
            </div>

            <div className="space-y-4">
              {ev.criteriaScores.map((cs, j) => (
                <div key={j}>
                  <div className="flex justify-between items-center mb-1">
                    <p className="text-sm font-semibold text-gray-700">{cs.area}</p>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, k) => (
                        <div key={k} className={`w-2.5 h-2.5 rounded-full ${k < cs.score ? (cs.score >= 4 ? "bg-green-400" : cs.score >= 3 ? "bg-yellow-400" : "bg-red-400") : "bg-gray-200"}`} />
                      ))}
                      <span className="text-xs text-gray-500 ml-1">{cs.score}/{cs.maxScore}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mb-1">
                    <div className={`h-full rounded-full transition-all ${cs.score >= 4 ? "bg-green-400" : cs.score >= 3 ? "bg-yellow-400" : "bg-red-400"}`} style={{ width: `${(cs.score / cs.maxScore) * 100}%` }} />
                  </div>
                  <p className="text-xs text-gray-500">{cs.comment}</p>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h3 className="font-bold text-gray-800 mb-1">Tu decisión final</h3>
          <p className="text-sm text-gray-500 mb-4">La IA recomienda <Badge type={rec} />. La decisión final es tuya.</p>
          <div className="grid grid-cols-2 gap-4">
            <button onClick={onReject} className="py-3.5 border-2 border-red-200 text-red-600 rounded-xl font-bold hover:bg-red-50 transition-colors">❌ No avanzar</button>
            <button onClick={onApprove} className="py-3.5 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 transition-colors">✅ Avanzar a entrevista</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 8: INTERVIEW INVITE + SCHEDULING
// ─────────────────────────────────────────────
function InterviewInviteScreen({ job, candidate, onSchedule }) {
  const [selected, setSelected] = useState(null);
  const slots = [
    { date: "Mar 28 Mar", time: "10:00h", ok: true },
    { date: "Mar 28 Mar", time: "11:30h", ok: true },
    { date: "Mié 29 Mar", time: "09:00h", ok: false },
    { date: "Mié 29 Mar", time: "16:00h", ok: true },
    { date: "Jue 30 Mar", time: "10:00h", ok: true },
    { date: "Vie 31 Mar", time: "12:00h", ok: true },
  ];

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="bg-slate-800 text-white px-5 py-3 flex items-center gap-3">
            <span className="text-xl">📧</span>
            <div>
              <p className="text-xs text-gray-400">Simulación — Email recibido por el candidato</p>
              <p className="text-sm font-medium">Para: {candidate.email}</p>
            </div>
          </div>
          <div className="p-6">
            <p className="text-xs text-gray-400 mb-3">De: rrhh@{job.company.name.toLowerCase().replace(/\s/g, "")}.com · Hace 2 minutos</p>
            <h3 className="text-lg font-bold text-gray-900 mb-3">🎉 ¡Enhorabuena, {candidate.name.split(" ")[0]}! Has avanzado al siguiente paso</h3>
            <p className="text-gray-600 text-sm mb-3">Tras revisar tu candidatura para <strong>{job.position.title}</strong> en <strong>{job.company.name}</strong>, hemos tomado la decisión de avanzar contigo en el proceso.</p>
            <p className="text-gray-600 text-sm mb-3">El siguiente paso es una <strong>entrevista online de ~45 minutos</strong>. Por favor, selecciona el horario que mejor te encaje en el calendario de abajo.</p>
            <p className="text-gray-600 text-sm">La entrevista se grabará y transcribirá para garantizar un proceso justo y objetivo. ¡Mucho ánimo!</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-6">
          <h3 className="font-bold text-gray-800 mb-4">📅 Selecciona tu horario</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            {slots.map((s, i) => (
              <button key={i} disabled={!s.ok} onClick={() => setSelected(i)}
                className={`p-4 rounded-xl border-2 text-left transition-all ${!s.ok ? "border-gray-100 bg-gray-50 opacity-40 cursor-not-allowed" : selected === i ? "border-green-400 bg-green-50 shadow-sm" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"}`}>
                <p className="font-semibold text-gray-800 text-sm">{s.date}</p>
                <p className="text-gray-500 text-sm">{s.time}</p>
                {!s.ok && <p className="text-xs text-red-400 mt-1">No disponible</p>}
                {selected === i && <p className="text-xs text-green-600 mt-1 font-semibold">✓ Seleccionado</p>}
              </button>
            ))}
          </div>
          <button disabled={selected === null} onClick={() => onSchedule(slots[selected])} className="w-full py-3 bg-green-600 text-white rounded-xl font-bold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Confirmar entrevista →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 9: INTERVIEW TRANSCRIPT + ANALYSIS
// ─────────────────────────────────────────────
function InterviewAnalysisScreen({ analysis, candidate, job, onFinish }) {
  const [tab, setTab] = useState("transcript");

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-2xl">🎤</div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Análisis de entrevista</h1>
            <p className="text-gray-400 text-sm">{candidate.name} · {job.position.title}</p>
          </div>
        </div>

        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-5">
          {[["transcript", "📝 Transcripción"], ["candidate", "🙋 Candidato"], ["recruiter", "👔 Reclutador"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${tab === id ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "transcript" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center gap-2 mb-5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-400 animate-pulse" />
              <span className="text-xs font-medium text-gray-500">Transcripción generada por IA · Grabación procesada</span>
            </div>
            <div className="space-y-5">
              {analysis.transcript.map((line, i) => {
                const isRecruiter = line.who === "Reclutador";
                return (
                  <div key={i} className={`flex gap-3 ${!isRecruiter ? "flex-row-reverse" : ""}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${isRecruiter ? "bg-blue-100 text-blue-600" : "bg-purple-100 text-purple-600"}`}>
                      {isRecruiter ? "R" : line.who[0]}
                    </div>
                    <div className={`max-w-md ${!isRecruiter ? "items-end" : ""}`}>
                      <p className={`text-xs text-gray-400 mb-1 ${!isRecruiter ? "text-right" : ""}`}>{line.who}</p>
                      <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${isRecruiter ? "bg-gray-100 text-gray-800 rounded-tl-sm" : "bg-purple-100 text-purple-900 rounded-tr-sm"}`}>
                        {line.text}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "candidate" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800">Evaluación del candidato</h3>
              <div className="text-right">
                <ScoreDial score={analysis.candidate.score} />
                <div className="mt-1"><Badge type={analysis.candidate.rec} /></div>
              </div>
            </div>
            <p className="text-sm text-gray-600 italic bg-gray-50 rounded-xl px-4 py-3 mb-5">{analysis.candidate.summary}</p>
            <div className="grid sm:grid-cols-2 gap-5">
              <div>
                <p className="text-xs font-bold text-green-600 uppercase tracking-wide mb-3">Puntos fuertes</p>
                {analysis.candidate.strengths.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 mb-2"><span className="text-green-400 mt-0.5">✓</span><span className="text-sm text-gray-700">{s}</span></div>
                ))}
              </div>
              <div>
                <p className="text-xs font-bold text-orange-500 uppercase tracking-wide mb-3">Áreas de mejora</p>
                {analysis.candidate.gaps.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 mb-2"><span className="text-orange-400 mt-0.5">→</span><span className="text-sm text-gray-700">{s}</span></div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === "recruiter" && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="font-bold text-gray-800">Evaluación del reclutador</h3>
                <p className="text-xs text-gray-400">Análisis confidencial para mejora interna del proceso</p>
              </div>
              <div className="text-right">
                <ScoreDial score={analysis.recruiter.score} />
                <p className="text-xs text-gray-400 mt-1">Desempeño</p>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-5 mb-5">
              <div>
                <p className="text-xs font-bold text-green-600 uppercase tracking-wide mb-3">Hizo bien</p>
                {analysis.recruiter.did_well.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 mb-2"><span className="text-green-400 mt-0.5">✓</span><span className="text-sm text-gray-700">{s}</span></div>
                ))}
              </div>
              <div>
                <p className="text-xs font-bold text-orange-500 uppercase tracking-wide mb-3">Puede mejorar</p>
                {analysis.recruiter.improve.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 mb-2"><span className="text-orange-400 mt-0.5">→</span><span className="text-sm text-gray-700">{s}</span></div>
                ))}
              </div>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wide mb-2">💡 Recomendaciones para próximas entrevistas</p>
              {analysis.recruiter.tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-2 mb-1.5"><span className="text-blue-400">→</span><span className="text-sm text-blue-800">{tip}</span></div>
              ))}
            </div>
          </div>
        )}

        <button onClick={onFinish} className="mt-5 w-full py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-colors">
          Ver resumen final del proceso →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN 10: FINAL SUMMARY
// ─────────────────────────────────────────────
function FinalSummaryScreen({ job, candidate, evaluation, interview, onRestart }) {
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🏁</div>
          <h1 className="text-2xl font-black text-gray-900">Proceso completado</h1>
          <p className="text-gray-500 mt-1">{job.position.title} · {job.company.name}</p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4 mb-5">
          {[
            { icon: "📋", label: "Ejercicios", value: `${evaluation.overall}%`, sub: `${evaluation.evaluations.length} evaluados`, color: "text-blue-600" },
            { icon: "🎤", label: "Entrevista", value: `${interview.candidate.score}%`, sub: <Badge type={interview.candidate.rec} />, color: "text-purple-600" },
            { icon: "👔", label: "Reclutador", value: `${interview.recruiter.score}%`, sub: "Feedback generado", color: "text-indigo-600" },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 text-center">
              <div className="text-3xl mb-2">{card.icon}</div>
              <p className="text-xs text-gray-400 mb-1">{card.label}</p>
              <p className={`text-3xl font-black ${card.color}`}>{card.value}</p>
              <div className="mt-1 text-xs text-gray-500">{card.sub}</div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-5">
          <h3 className="font-bold text-gray-800 mb-3">📧 Notificación automática enviada al reclutador</h3>
          <div className="bg-gray-50 rounded-xl p-4 text-sm text-gray-600 border border-gray-200 space-y-1">
            <p className="font-semibold text-gray-900 mb-2">Resumen de candidatura — {candidate.name}</p>
            <p>• Puntuación ejercicios (escrito + vídeo): <strong>{evaluation.overall}%</strong> <Badge type={evaluation.rec} /></p>
            <p>• Puntuación entrevista: <strong>{interview.candidate.score}%</strong> <Badge type={interview.candidate.rec} /></p>
            <p>• Puntuación reclutador: <strong>{interview.recruiter.score}%</strong> (feedback disponible)</p>
            <p className="text-gray-400 text-xs mt-2">Acción requerida: Confirmar oferta final al candidato →</p>
          </div>
        </div>

        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-2xl p-6 text-white mb-5">
          <h3 className="font-bold text-lg mb-3">✨ ¿Qué automatizó RecruitAI en este proceso?</h3>
          <div className="grid sm:grid-cols-2 gap-2">
            {["Publicación de oferta en LinkedIn", "Formulario de aplicación personalizado", "Evaluación escrita + transcripción de vídeos", "Confirmación y gestión de candidatos", "Agendado de entrevista vía calendario", "Transcripción y análisis de entrevista", "Evaluación de candidato post-entrevista", "Feedback al reclutador para mejora"].map((item) => (
              <div key={item} className="flex items-center gap-2 text-sm">
                <span className="text-green-300 flex-shrink-0">✓</span>
                <span className="text-blue-100">{item}</span>
              </div>
            ))}
          </div>
        </div>

        <button onClick={onRestart} className="w-full py-3 border-2 border-gray-200 text-gray-600 rounded-xl font-bold hover:bg-gray-50 transition-colors">
          🔄 Crear nuevo proceso de selección
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// MAIN APP — STATE MACHINE
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// SCREEN: LOADING
// ─────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 animate-pulse">🤖</div>
        <p className="text-gray-500 text-sm">Cargando RecruitAI...</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN: LOGIN
// ─────────────────────────────────────────────
function LoginScreen({ onLogin, loading }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6">🤖</div>
        <h1 className="text-3xl font-black text-gray-900 mb-2">RecruitAI</h1>
        <p className="text-gray-500 mb-2">Automatización de selección de personal para agencias digitales</p>
        <div className="flex flex-col gap-2 text-xs text-gray-400 mb-8">
          <span>✅ Procesos de selección con IA</span>
          <span>✅ Evaluación automática de candidatos</span>
          <span>✅ Datos guardados en la nube</span>
        </div>
        <button onClick={onLogin} disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3.5 px-6 border-2 border-gray-200 rounded-xl font-semibold text-gray-700 hover:border-blue-400 hover:bg-blue-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
          {loading ? <span className="text-sm">Iniciando sesión...</span> : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
              <span>Continuar con Google</span>
            </>
          )}
        </button>
        <p className="text-xs text-gray-400 mt-4">Tus datos se guardan de forma segura en Firebase</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// SCREEN: PROCESS DETAIL (Candidate Pipeline)
// ─────────────────────────────────────────────
const ESTADO_OPTIONS = ["Pendiente", "Primera entrevista", "Segunda entrevista", "En cartera", "Descartado", "Contratado"];
const PROGRESO_OPTIONS = ["Ingreso", "Prueba técnica", "Entrevista", "Onboarding", "Descalificado", "En cartera", "Desiste", "Validación prueba técnica", "Entrevista RRHH"];

const ESTADO_COLORS = {
  "Pendiente": "bg-gray-100 text-gray-700",
  "Primera entrevista": "bg-blue-100 text-blue-700",
  "Segunda entrevista": "bg-indigo-100 text-indigo-700",
  "En cartera": "bg-yellow-100 text-yellow-700",
  "Descartado": "bg-red-100 text-red-700",
  "Contratado": "bg-green-100 text-green-700",
};

const PROGRESO_COLORS = {
  "Ingreso": "bg-purple-100 text-purple-700",
  "Prueba técnica": "bg-blue-100 text-blue-700",
  "Entrevista": "bg-indigo-100 text-indigo-700",
  "Onboarding": "bg-teal-100 text-teal-700",
  "Descalificado": "bg-red-100 text-red-700",
  "En cartera": "bg-yellow-100 text-yellow-700",
  "Desiste": "bg-orange-100 text-orange-700",
  "Validación prueba técnica": "bg-cyan-100 text-cyan-700",
  "Entrevista RRHH": "bg-violet-100 text-violet-700",
};

function ProcessDetailScreen({ process, onBack, onUpdate, user, onStartDemo }) {
  const [candidates, setCandidates] = useState(
    (process.candidates || []).map(c => ({
      estado: "Pendiente",
      progreso: "Ingreso",
      entrevistador: "",
      notas: "",
      ...c,
    }))
  );
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const updateCandidate = (id, field, value) => {
    const updated = candidates.map(c => c.id === id ? { ...c, [field]: value } : c);
    setCandidates(updated);
    onUpdate(process.id, updated);
  };

  const addCandidate = () => {
    if (!newName.trim()) return;
    const newCand = {
      id: `c_${Date.now()}`,
      name: newName.trim(),
      email: newEmail.trim(),
      phase: "applied",
      estado: "Pendiente",
      progreso: "Ingreso",
      entrevistador: user?.displayName || "",
      notas: "",
    };
    const updated = [...candidates, newCand];
    setCandidates(updated);
    onUpdate(process.id, updated);
    setNewName("");
    setNewEmail("");
    setShowAddForm(false);
  };

  const removeCandidate = (id) => {
    if (!window.confirm("¿Eliminar este candidato del proceso?")) return;
    const updated = candidates.filter(c => c.id !== id);
    setCandidates(updated);
    onUpdate(process.id, updated);
  };

  const statsByEstado = ESTADO_OPTIONS.map(e => ({
    label: e,
    count: candidates.filter(c => (c.estado || "Pendiente") === e).length,
  }));

  const statColors = ["bg-gray-50 text-gray-700", "bg-blue-50 text-blue-700", "bg-indigo-50 text-indigo-700", "bg-yellow-50 text-yellow-700", "bg-red-50 text-red-600", "bg-green-50 text-green-700"];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-700 text-sm flex items-center gap-1 shrink-0">← Panel</button>
          <div className="w-px h-4 bg-gray-200 shrink-0" />
          <span className="text-xl font-black text-blue-600 shrink-0">RecruitAI</span>
          <div className="w-px h-4 bg-gray-200 shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="font-bold text-gray-900 text-sm truncate block">{getPositionTitle(process.position)}</span>
            <span className="text-xs text-gray-400">{process.company?.name}</span>
          </div>
          <button onClick={onStartDemo} className="shrink-0 px-3 py-1.5 border border-gray-200 text-gray-500 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors">Ver oferta →</button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6">
        {/* Process info bar */}
        <div className="flex flex-wrap items-center gap-2 mb-5">
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${process.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
            {process.status === "active" ? "● Activo" : "● Pausado"}
          </span>
          {process.position?.contract && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position.contract}</span>}
          {process.position?.hoursPerWeek && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position.hoursPerWeek}h/sem</span>}
          {process.company?.salaryMin && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">{Number(process.company.salaryMin).toLocaleString()}–{Number(process.company.salaryMax).toLocaleString()} {process.company.currency}</span>}
          {process.company?.location && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">📍 {process.company.location}</span>}
        </div>

        {/* Stats by Estado */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
          {statsByEstado.map(({ label, count }, i) => (
            <div key={label} className={`rounded-xl border border-gray-100 p-3 text-center shadow-sm ${statColors[i]}`}>
              <p className="text-2xl font-black leading-none">{count}</p>
              <p className="text-xs leading-tight mt-1 opacity-80">{label}</p>
            </div>
          ))}
        </div>

        {/* Candidate Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-800">Candidatos <span className="text-gray-400 font-normal text-sm">({candidates.length})</span></h2>
            <button onClick={() => setShowAddForm(v => !v)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors">+ Añadir candidato</button>
          </div>

          {/* Add candidate form */}
          {showAddForm && (
            <div className="px-5 py-4 bg-blue-50 border-b border-blue-100 flex flex-wrap items-end gap-3">
              <div>
                <label className={lbl}>Nombre *</label>
                <input className={inp} style={{width: "180px"}} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Nombre del candidato" onKeyDown={e => e.key === "Enter" && addCandidate()} autoFocus />
              </div>
              <div>
                <label className={lbl}>Email</label>
                <input className={inp} style={{width: "220px"}} value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@ejemplo.com" type="email" />
              </div>
              <div className="flex gap-2">
                <button onClick={addCandidate} className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors">Añadir</button>
                <button onClick={() => { setShowAddForm(false); setNewName(""); setNewEmail(""); }} className="px-4 py-2.5 border border-gray-200 bg-white text-gray-500 rounded-lg text-sm hover:bg-gray-50 transition-colors">Cancelar</button>
              </div>
            </div>
          )}

          {candidates.length === 0 ? (
            <div className="text-center py-14">
              <p className="text-4xl mb-3">👥</p>
              <p className="text-gray-400 text-sm font-medium">No hay candidatos en este proceso todavía.</p>
              <button onClick={() => setShowAddForm(true)} className="mt-3 text-blue-500 text-sm hover:underline font-medium">+ Añadir el primer candidato</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{minWidth:"160px"}}>Candidato</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{minWidth:"170px"}}>Estado de la Solicitud</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{minWidth:"190px"}}>Progreso</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{minWidth:"150px"}}>Entrevistador</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide" style={{minWidth:"200px"}}>Notas</th>
                    <th className="px-4 py-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c, i) => (
                    <tr key={c.id} className={`border-b border-gray-50 hover:bg-blue-50/30 transition-colors ${i % 2 === 1 ? "bg-gray-50/40" : ""}`}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-gray-800 leading-tight">{c.name}</p>
                        {c.email && <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={c.estado || "Pendiente"}
                          onChange={e => updateCandidate(c.id, "estado", e.target.value)}
                          className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 appearance-none ${ESTADO_COLORS[c.estado || "Pendiente"] || "bg-gray-100 text-gray-700"}`}
                          style={{maxWidth:"160px"}}
                        >
                          {ESTADO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={c.progreso || "Ingreso"}
                          onChange={e => updateCandidate(c.id, "progreso", e.target.value)}
                          className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 appearance-none ${PROGRESO_COLORS[c.progreso || "Ingreso"] || "bg-gray-100 text-gray-700"}`}
                          style={{maxWidth:"185px"}}
                        >
                          {PROGRESO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={c.entrevistador || ""}
                          onChange={e => updateCandidate(c.id, "entrevistador", e.target.value)}
                          placeholder="Asignar..."
                          className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <input
                          type="text"
                          value={c.notas || ""}
                          onChange={e => updateCandidate(c.id, "notas", e.target.value)}
                          placeholder="Añadir nota..."
                          className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-transparent"
                        />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => removeCandidate(c.id)} className="text-gray-300 hover:text-red-400 transition-colors text-xl leading-none" title="Eliminar candidato">×</button>
                      </td>
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

// ─────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────
function getPipelineStats(process) {
  const c = process.candidates || [];
  return { applied: c.filter(x => x.phase === "applied").length, review: c.filter(x => x.phase === "review").length, interview: c.filter(x => x.phase === "interview").length, hired: c.filter(x => x.phase === "hired").length, rejected: c.filter(x => x.phase === "rejected").length, total: c.length };
}

function ProcessCard({ process, onView, onToggle }) {
  const stats = getPipelineStats(process);
  const isActive = process.status === "active";
  return (
    <div className={`bg-white rounded-2xl border shadow-sm p-5 transition-all ${isActive ? "border-gray-100" : "border-gray-100 opacity-70"}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1"><span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? "bg-green-400" : "bg-gray-300"}`} /><span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{isActive ? "Activo" : "Pausado"}</span></div>
          <h3 className="font-bold text-gray-900 leading-tight">{getPositionTitle(process.position)}</h3>
          <p className="text-xs text-gray-400 mt-0.5">{process.company?.name} · {process.company?.location}</p>
        </div>
        <button onClick={() => onToggle(process.id)} className={`ml-3 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${isActive ? "border-orange-200 text-orange-600 hover:bg-orange-50" : "border-green-200 text-green-600 hover:bg-green-50"}`}>{isActive ? "⏸ Pausar" : "▶ Activar"}</button>
      </div>
      <div className="grid grid-cols-5 gap-1.5 mb-4 text-center">
        {[{ label: "Aplicaron", val: stats.applied, color: "text-blue-600" }, { label: "Revisión", val: stats.review, color: "text-yellow-600" }, { label: "Entrevista", val: stats.interview, color: "text-purple-600" }, { label: "Contrat.", val: stats.hired, color: "text-green-600" }, { label: "Descart.", val: stats.rejected, color: "text-red-400" }].map(s => (
          <div key={s.label} className="bg-gray-50 rounded-lg p-2"><p className={`text-lg font-black leading-none ${s.color}`}>{s.val}</p><p className="text-xs text-gray-400 mt-0.5 leading-tight">{s.label}</p></div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position?.contract}</span>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position?.hoursPerWeek}h/sem</span>
          {process.company?.salaryMin && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">{Number(process.company.salaryMin).toLocaleString()}–{Number(process.company.salaryMax).toLocaleString()} {process.company.currency}</span>}
        </div>
        <button onClick={() => onView(process)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-colors">Ver proceso →</button>
      </div>
    </div>
  );
}

function RecruiterDashboard({ processes, onNew, onView, onToggle, user, onLogout }) {
  const active = processes.filter(p => p.status === "active").length;
  const totalCandidates = processes.reduce((s, p) => s + (p.candidates?.length || 0), 0);
  const hired = processes.reduce((s, p) => s + (p.candidates?.filter(c => c.phase === "hired").length || 0), 0);
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black text-blue-600">RecruitAI</span>
            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-semibold">Panel de reclutador</span>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2">
                {user.photoURL && <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full border-2 border-gray-200" />}
                <span className="text-sm text-gray-600 hidden sm:block">{user.displayName?.split(" ")[0]}</span>
              </div>
            )}
            <button onClick={onNew} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700 transition-colors">+ Nuevo proceso</button>
            <button onClick={onLogout} className="px-3 py-2.5 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50 transition-colors" title="Cerrar sesión">↩</button>
          </div>
        </div>
      </div>
      <div className="max-w-4xl mx-auto p-6">
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[{ icon: "📋", label: "Procesos activos", val: active, color: "text-blue-600" }, { icon: "👥", label: "Candidatos totales", val: totalCandidates, color: "text-gray-800" }, { icon: "🎉", label: "Contratados", val: hired, color: "text-green-600" }].map(s => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5"><p className="text-2xl mb-1">{s.icon}</p><p className={`text-3xl font-black ${s.color}`}>{s.val}</p><p className="text-sm text-gray-400 mt-1">{s.label}</p></div>
          ))}
        </div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-black text-gray-900">Procesos de selección</h2>
          <span className="text-sm text-gray-400">{processes.length} en total</span>
        </div>
        {processes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center">
            <p className="text-4xl mb-3">🚀</p>
            <h3 className="font-bold text-gray-700 mb-1">Sin procesos activos</h3>
            <p className="text-gray-400 text-sm mb-4">Crea tu primer proceso de selección para empezar.</p>
            <button onClick={onNew} className="px-6 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">+ Crear proceso</button>
          </div>
        ) : (
          <div className="space-y-4">{processes.map(p => <ProcessCard key={p.id} process={p} onView={onView} onToggle={onToggle} />)}</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// APP — Firebase auth + Firestore
// ─────────────────────────────────────────────
export default function App() {
  const [phase, setPhase] = useState("dashboard");
  const [processes, setProcesses] = useState(MOCK_PROCESSES);
  const [activeJob, setActiveJob] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [interview, setInterview] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);

  // Listen to Firebase auth state & load processes
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const ref = doc(db, "recruiters", u.uid);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const data = snap.data();
            if (data.processes && data.processes.length > 0) setProcesses(data.processes);
          }
        } catch (e) { console.error("Error loading:", e); }
      }
      setAuthLoading(false);
    });
    return unsub;
  }, []);

  // Save processes to Firestore on change (debounced 1s)
  useEffect(() => {
    if (!user) return;
    const t = setTimeout(async () => {
      try {
        await setDoc(doc(db, "recruiters", user.uid), { processes, updatedAt: new Date().toISOString() }, { merge: true });
      } catch (e) { console.error("Error saving:", e); }
    }, 1000);
    return () => clearTimeout(t);
  }, [processes, user]);

  const handleLogin = async () => {
    setLoginLoading(true);
    try { await signInWithPopup(auth, googleProvider); }
    catch (e) { console.error("Login error:", e); setLoginLoading(false); }
  };

  const handleLogout = async () => { await signOut(auth); setProcesses(MOCK_PROCESSES); setPhase("dashboard"); };
  const goToDashboard = () => { setPhase("dashboard"); setActiveJob(null); setCandidate(null); setEvaluation(null); setInterview(null); };

  const handlePublish = (jobData) => {
    const newProcess = { id: `p_${Date.now()}`, status: "active", createdAt: new Date().toISOString().split("T")[0], ...jobData, candidates: [] };
    setProcesses(ps => [newProcess, ...ps]);
    setActiveJob(jobData);
    setPhase("preview");
  };

  const handleToggle = (id) => setProcesses(ps => ps.map(p => p.id === id ? { ...p, status: p.status === "active" ? "paused" : "active" } : p));
  const handleViewProcess = (process) => { setActiveJob(process); setPhase("process_detail"); };
  const handleStartDemo = (process) => { setActiveJob(process); setPhase("preview"); };
  const handleUpdateCandidates = (processId, updatedCandidates) => {
    setProcesses(ps => ps.map(p => p.id === processId ? { ...p, candidates: updatedCandidates } : p));
    setActiveJob(aj => aj && aj.id === processId ? { ...aj, candidates: updatedCandidates } : aj);
  };
  const handleApply = (form) => { setCandidate(form); setPhase("exercises"); };
  const handleSubmit = (resps) => { setEvaluation(generateAIEvaluation(resps, activeJob)); setPhase("confirmation"); };
  const handleApprove = () => setPhase("scheduling");
  const handleReject = () => goToDashboard();
  const handleSchedule = (slot) => { setInterview({ ...generateInterviewAnalysis(candidate?.name || "Candidato"), slot }); setPhase("interview"); };
  const handleFinish = () => setPhase("final");

  if (authLoading) return <LoadingScreen />;
  if (!user) return <LoginScreen onLogin={handleLogin} loading={loginLoading} />;
  if (phase === "dashboard") return <RecruiterDashboard processes={processes} onNew={() => setPhase("setup")} onView={handleViewProcess} onToggle={handleToggle} user={user} onLogout={handleLogout} />;
  if (phase === "process_detail") { const liveProcess = processes.find(p => p.id === activeJob?.id) || activeJob; return <ProcessDetailScreen process={liveProcess} onBack={goToDashboard} onUpdate={handleUpdateCandidates} user={user} onStartDemo={() => handleStartDemo(liveProcess)} />; }
  if (phase === "setup") return <RecruiterSetupScreen onPublish={handlePublish} onBack={goToDashboard} />;
  if (phase === "preview") return <JobPreviewScreen job={activeJob} onApply={() => setPhase("apply")} onBack={goToDashboard} />;
  if (phase === "apply") return <CandidateApplyScreen job={activeJob} onNext={handleApply} />;
  if (phase === "exercises") return <ExercisesScreen job={activeJob} candidate={candidate} onSubmit={handleSubmit} />;
  if (phase === "confirmation") return <ConfirmationScreen candidate={candidate} onNext={() => setPhase("review")} />;
  if (phase === "review") return <RecruiterReviewScreen job={activeJob} candidate={candidate} evaluation={evaluation} onApprove={handleApprove} onReject={handleReject} />;
  if (phase === "scheduling") return <InterviewInviteScreen job={activeJob} candidate={candidate} onSchedule={handleSchedule} />;
  if (phase === "interview") return <InterviewAnalysisScreen analysis={interview} candidate={candidate} job={activeJob} onFinish={handleFinish} />;
  if (phase === "final") return <FinalSummaryScreen job={activeJob} candidate={candidate} evaluation={evaluation} interview={interview} onRestart={goToDashboard} />;
  return null;
}

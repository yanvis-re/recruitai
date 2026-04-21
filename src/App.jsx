import { useState, useEffect, useRef } from "react";
import { auth, db, googleProvider, doc, getDoc, setDoc, collection, addDoc, getDocs, signInWithPopup, signOut, onAuthStateChanged } from "./firebase.js";

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
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${i < idx ? "bg-green-500 text-white" : i === idx ? "bg-blue-600 text-white shadow-md scale-110" : "bg-gray-100 text-gray-400"}`}>{i < idx ? "✓" : s.icon}</div>
            <span className="text-xs mt-1 hidden sm:block" style={{ color: i <= idx ? "#374151" : "#9CA3AF" }}>{s.label}</span>
          </div>
          {i < steps.length - 1 && <div className={`w-6 sm:w-10 h-0.5 mx-1 ${i < idx ? "bg-green-400" : "bg-gray-200"}`} />}
        </div>
      ))}
    </div>
  );
}

const inp = "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white";
const lbl = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1";

const MOCK_PROCESSES = [
  { id: "p1", status: "active", createdAt: "2026-03-10", company: { name: "Proelia Digital", sector: "Marketing Digital", location: "Madrid / Remoto", modality: "Remoto", salaryMin: "40000", salaryMax: "55000", currency: "EUR", description: "Agencia especializada en infoproductos." }, position: { positionType: "media_buyer", specialty: "", customTitle: "", responsibilities: "Liderar la estrategia de paid media.", skills: "Meta Ads, Google Ads, TikTok Ads", experience: "5", contract: "Freelance", hoursPerWeek: "20", schedule: "Flexible", benefits: "" }, exercises: [{ id: 1, title: "Ejercicio Estratégico", description: "Diseña una estrategia de paid media para un lanzamiento de curso online.", criteria: [{ area: "Diagnóstico estratégico", indicators: "Análisis coherente", maxScore: 5 }, { area: "Funnel y táctica", indicators: "Claridad en campañas", maxScore: 5 }] }], candidates: [{ id: "c1", name: "Laura Martínez", email: "laura@example.com", phase: "review", estado: "Primera entrevista", progreso: "Entrevista", entrevistador: "", notas: "" }, { id: "c2", name: "Carlos Ruiz", email: "carlos@example.com", phase: "applied", estado: "Pendiente", progreso: "Ingreso", entrevistador: "", notas: "" }] },
  { id: "p2", status: "active", createdAt: "2026-02-20", company: { name: "Proelia Digital", sector: "Marketing Digital", location: "Remoto", modality: "Remoto", salaryMin: "28000", salaryMax: "38000", currency: "EUR", description: "" }, position: { positionType: "media_buyer", specialty: "", customTitle: "", responsibilities: "Gestión de campañas.", skills: "Meta Ads, Google Ads", experience: "3", contract: "Contrato directo", hoursPerWeek: "40", schedule: "Mañanas", benefits: "Formación continua" }, exercises: [{ id: 1, title: "Caso Práctico", description: "Analiza las métricas de una cuenta y propón mejoras.", criteria: [{ area: "Análisis de datos", indicators: "Lectura correcta de métricas", maxScore: 5 }] }], candidates: [{ id: "c5", name: "Marta López", email: "marta@example.com", phase: "applied", estado: "Pendiente", progreso: "Prueba técnica", entrevistador: "", notas: "" }] },
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
  company: { name: "Proelia Digital", description: "Agencia de marketing digital especializada en infoproductos.", sector: "Marketing Digital", location: "Madrid / Remoto", modality: "Remoto", salaryMin: "", salaryMax: "", currency: "EUR" },
  position: { positionType: "media_buyer", specialty: "", customTitle: "", responsibilities: "", skills: "", experience: "3", contract: "Freelance", hoursPerWeek: "20", schedule: "Flexible", benefits: "" },
  exercises: [{ id: 1, title: "Ejercicio Práctico", description: "", criteria: [{ area: "Análisis y diagnóstico", indicators: "Capacidad de identificar el problema y proponer soluciones", maxScore: 5 }, { area: "Propuesta estratégica", indicators: "Coherencia y calidad de la propuesta", maxScore: 5 }] }],
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
        </div>
      </div>
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex gap-2 mb-6">
          {tabs.map((t, i) => <button key={t} onClick={() => i < step && setStep(i)} className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${i === step ? "bg-blue-600 text-white shadow" : i < step ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>{i < step ? "✓ " : ""}{t}</button>)}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="font-bold text-gray-800 mb-4">Información de la empresa contratadora</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2"><label className={lbl}>Nombre de la empresa *</label><input className={inp} value={data.company.name} onChange={e => upC("name", e.target.value)} /></div>
                <div className="col-span-2"><label className={lbl}>Descripción</label><textarea className={inp} rows={3} value={data.company.description} onChange={e => upC("description", e.target.value)} /></div>
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
                      className={`p-3 rounded-xl border-2 text-left transition-all ${data.position.positionType === pos.id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-blue-300"}`}>
                      <div className="text-xl mb-1">{pos.icon}</div>
                      <p className={`text-xs font-semibold leading-tight ${data.position.positionType === pos.id ? "text-blue-700" : "text-gray-700"}`}>{pos.label}</p>
                    </button>
                  ))}
                </div>
              </div>
              {(() => { const pos = POSITIONS.find(p => p.id === data.position.positionType); return pos && pos.specialties.length > 0 ? (<div><label className={lbl}>Especialidad</label><div className="flex flex-wrap gap-2 mt-1">{pos.specialties.map(sp => (<button key={sp} type="button" onClick={() => upP("specialty", data.position.specialty === sp ? "" : sp)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border-2 transition-all ${data.position.specialty === sp ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:border-blue-300"}`}>{sp}</button>))}</div></div>) : null; })()}
              {data.position.positionType === "otro" && (<div><label className={lbl}>Nombre personalizado *</label><input className={inp} value={data.position.customTitle || ""} onChange={e => upP("customTitle", e.target.value)} placeholder="ej. Growth Hacker..." /></div>)}
              <div><label className={lbl}>Responsabilidades</label><textarea className={inp} rows={3} value={data.position.responsibilities} onChange={e => upP("responsibilities", e.target.value)} /></div>
              <div><label className={lbl}>Habilidades requeridas</label><textarea className={inp} rows={2} value={data.position.skills} onChange={e => upP("skills", e.target.value)} /></div>
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
                {salaryApplied && (<div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 font-medium"><span>✅</span> Rango aplicado</div>)}
                <div className="grid grid-cols-3 gap-3">
                  <div><label className={lbl}>Moneda</label><select className={inp} value={data.company.currency} onChange={e => upC("currency", e.target.value)}>{["EUR", "USD", "GBP", "MXN"].map(m => <option key={m}>{m}</option>)}</select></div>
                  <div><label className={lbl}>Salario mín./año</label><input className={inp} type="number" value={data.company.salaryMin} onChange={e => upC("salaryMin", e.target.value)} /></div>
                  <div><label className={lbl}>Salario máx./año</label><input className={inp} type="number" value={data.company.salaryMax} onChange={e => upC("salaryMax", e.target.value)} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className={lbl}>Horas semanales (máx. 40h)</label><input className={inp} type="number" min={1} max={40} value={data.position.hoursPerWeek} onChange={e => upP("hoursPerWeek", Math.min(40, parseInt(e.target.value) || 0).toString())} /></div>
                  <div><label className={lbl}>Horario</label><div className="flex flex-col gap-1.5 mt-1">{[["Mañanas", "🌅"], ["Tardes", "🌆"], ["Flexible", "🕐"]].map(([h, icon]) => (<button key={h} type="button" onClick={() => upP("schedule", h)} className={`py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${data.position.schedule === h ? "border-blue-500 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-500"}`}>{icon} {h}</button>))}</div></div>
                </div>
                <div><label className={lbl}>Años de experiencia</label><input className={inp} type="number" min={0} max={20} value={data.position.experience} onChange={e => upP("experience", e.target.value)} /></div>
                <div><label className={lbl}>Otros beneficios</label><textarea className={inp} rows={2} value={data.position.benefits} onChange={e => upP("benefits", e.target.value)} /></div>
              </div>
            </div>
          )}
          {step === 2 && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <h2 className="font-bold text-gray-800">Ejercicios prácticos</h2>
                <button onClick={addEx} className="text-sm bg-blue-50 text-blue-600 px-4 py-1.5 rounded-lg font-medium hover:bg-blue-100">+ Añadir ejercicio</button>
              </div>
              <p className="text-xs text-gray-400 mb-4">Cada ejercicio requiere respuesta escrita + vídeo de defensa en Loom.</p>
              {data.exercises.map(ex => (
                <div key={ex.id} className="border border-gray-200 rounded-xl p-4 mb-4 bg-gray-50">
                  <div className="flex items-center gap-2 mb-3">
                    <input className="flex-1 bg-transparent border-b border-dashed border-gray-300 text-sm font-bold text-gray-800 focus:outline-none pb-1" value={ex.title} onChange={e => upEx(ex.id, "title", e.target.value)} />
                    {data.exercises.length > 1 && <button onClick={() => delEx(ex.id)} className="text-red-300 hover:text-red-500 text-xl">×</button>}
                  </div>
                  <div className="mb-4">
                    <label className={lbl}>Enunciado del ejercicio</label>
                    <textarea className={inp + " bg-white"} rows={4} value={ex.description} onChange={e => upEx(ex.id, "description", e.target.value)} placeholder="Describe el reto que el candidato deberá resolver..." />
                    <p className="text-xs text-blue-500 mt-1.5 flex items-center gap-1.5"><span>💡</span>Cuanto más detallado sea el enunciado, mejores respuestas recibirás.</p>
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-2"><label className={lbl}>Criterios de evaluación</label><button onClick={() => addCr(ex.id)} className="text-xs text-blue-500 hover:underline">+ Criterio</button></div>
                    {ex.criteria.map((cr, ci) => (
                      <div key={ci} className="flex gap-2 items-start bg-white rounded-lg p-3 mb-2 border border-gray-100">
                        <div className="flex-1 space-y-2">
                          <input className={inp} value={cr.area} onChange={e => upCr(ex.id, ci, "area", e.target.value)} placeholder="Área evaluada" />
                          <input className={inp} value={cr.indicators} onChange={e => upCr(ex.id, ci, "indicators", e.target.value)} placeholder="Indicadores clave..." />
                        </div>
                        <div className="flex flex-col items-center gap-1 flex-shrink-0">
                          <span className="text-xs text-gray-400">Pts</span>
                          <input className="w-14 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none" type="number" min={1} max={10} value={cr.maxScore} onChange={e => upCr(ex.id, ci, "maxScore", parseInt(e.target.value) || 5)} />
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
        <div className="bg-white shadow-xl rounded-b-2xl">
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-start gap-4">
              <div className="w-16 h-16 bg-blue-600 rounded-xl flex items-center justify-center text-white text-2xl font-black flex-shrink-0">{job.company?.name?.[0] || "R"}</div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">{job.position?.title || getPositionTitle(job.position)}</h1>
                <p className="text-blue-600 font-semibold">{job.company?.name}</p>
                <p className="text-gray-500 text-sm">{job.company?.location} · {job.company?.modality} · {job.position?.contract}</p>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-full font-medium">{job.company?.sector}</span>
                  {job.company?.salaryMin && <span className="text-xs bg-green-50 text-green-700 px-2.5 py-1 rounded-full font-medium">{Number(job.company.salaryMin).toLocaleString()} – {Number(job.company.salaryMax).toLocaleString()} {job.company.currency}/año</span>}
                  <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">+{job.position?.experience} años exp.</span>
                </div>
              </div>
            </div>
            <button onClick={onApply} className="mt-4 w-full bg-blue-600 text-white py-2.5 rounded-full font-bold hover:bg-blue-700 text-sm">Solicitar empleo</button>
          </div>
          <div className="p-6 space-y-5 text-sm text-gray-700">
            {job.company?.description && <section><h3 className="font-bold text-gray-900 mb-2">Sobre {job.company.name}</h3><p>{job.company.description}</p></section>}
            {job.position?.responsibilities && <section><h3 className="font-bold text-gray-900 mb-2">Responsabilidades</h3><p className="whitespace-pre-wrap">{job.position.responsibilities}</p></section>}
            {job.position?.skills && <section><h3 className="font-bold text-gray-900 mb-2">Habilidades</h3><div className="flex flex-wrap gap-2">{job.position.skills.split(",").map((s) => <span key={s} className="bg-gray-100 text-gray-600 px-3 py-1 rounded-full text-xs">{s.trim()}</span>)}</div></section>}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="font-semibold text-blue-800 mb-1">📋 Proceso 100% digital</p>
              <p className="text-xs text-blue-600">Este proceso incluye {job.exercises?.length || 1} ejercicio(s) práctico(s). Cada uno requiere una respuesta escrita y un vídeo de defensa en Loom.</p>
            </div>
          </div>
          <div className="p-6 pt-0">
            <button onClick={onApply} className="w-full bg-blue-600 text-white py-3 rounded-full font-bold hover:bg-blue-700">Solicitar empleo</button>
            {onBack && <button onClick={onBack} className="w-full mt-2 text-sm text-gray-400 hover:text-gray-600 py-2">← Volver</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CandidateApplyScreen({ job, onNext }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", linkedin: "", presentation: "" });
  const up = (f, v) => setForm((d) => ({ ...d, [f]: v }));
  const valid = form.name && form.email && form.presentation.trim().length > 20;
  return (
    <div className="min-h-screen bg-gray-50 p-4">
      <div className="max-w-2xl mx-auto">
        <div className="bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-t-2xl p-6">
          <h1 className="text-xl font-bold">Aplicar a: {job.position?.title || getPositionTitle(job.position)}</h1>
          <p className="text-purple-200 text-sm">{job.company?.name} · {job.company?.location}</p>
        </div>
        <div className="bg-white rounded-b-2xl shadow-lg p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 sm:col-span-1"><label className={lbl}>Nombre completo *</label><input className={inp} value={form.name} onChange={(e) => up("name", e.target.value)} /></div>
            <div className="col-span-2 sm:col-span-1"><label className={lbl}>Teléfono</label><input className={inp} value={form.phone} onChange={(e) => up("phone", e.target.value)} /></div>
            <div><label className={lbl}>Email *</label><input className={inp} value={form.email} onChange={(e) => up("email", e.target.value)} /></div>
            <div><label className={lbl}>LinkedIn</label><input className={inp} value={form.linkedin} onChange={(e) => up("linkedin", e.target.value)} /></div>
          </div>
          <div>
            <label className={lbl}>Presentación personal *</label>
            <textarea className={inp} rows={5} value={form.presentation} onChange={(e) => up("presentation", e.target.value)} placeholder="Cuéntanos sobre ti, tu trayectoria y por qué eres el perfil ideal..." />
          </div>
          <button onClick={() => onNext(form)} disabled={!valid} className="w-full bg-purple-600 text-white py-3 rounded-xl font-bold hover:bg-purple-700 disabled:opacity-40 transition-colors">
            Continuar con los ejercicios →
          </button>
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
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
        <span className="text-xl font-black text-blue-600">RecruitAI</span>
        <span className="text-xs text-gray-400">· Ejercicio {idx + 1} de {job.exercises.length}</span>
      </div>
      <div className="max-w-2xl mx-auto p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-4">
          <h2 className="font-bold text-gray-900 mb-1">{ex.title}</h2>
          <p className="text-gray-600 text-sm mb-4 whitespace-pre-wrap">{ex.description}</p>
          <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 mb-4">
            <p className="text-xs text-blue-700 font-semibold">📋 Criterios de evaluación</p>
            {ex.criteria.map((c, i) => <p key={i} className="text-xs text-blue-600 mt-1">· {c.area}: {c.indicators}</p>)}
          </div>
          <div className="space-y-4">
            <div>
              <label className={lbl}>Tu respuesta escrita *</label>
              <textarea className={inp} rows={8} value={resp?.response || ""} onChange={e => upR("response", e.target.value)} placeholder="Desarrolla tu propuesta aquí..." />
              <p className="text-xs text-gray-400 mt-1">{(resp?.response || "").split(/\s+/).filter(Boolean).length} palabras</p>
            </div>
            <div>
              <label className={lbl}>Enlace de Loom — Vídeo de defensa *</label>
              <input className={inp} value={resp?.loomUrl || ""} onChange={e => upR("loomUrl", e.target.value)} placeholder="https://www.loom.com/share/..." />
              <p className="text-xs text-blue-500 mt-1.5 flex items-center gap-1">🎥 Graba un vídeo en Loom defendiendo tu propuesta (máx. 5 min) y pega el enlace aquí.</p>
            </div>
          </div>
        </div>
        <div className="flex gap-3">
          {idx > 0 && <button onClick={() => setIdx(i => i - 1)} className="px-5 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-600">← Anterior</button>}
          {!isLast
            ? <button onClick={() => setIdx(i => i + 1)} disabled={!canNext} className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-40">Siguiente ejercicio →</button>
            : <button onClick={() => onSubmit(resps)} disabled={!canNext || submitting} className="flex-1 bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 disabled:opacity-40">{submitting ? "Enviando..." : "✅ Enviar solicitud"}</button>
          }
        </div>
      </div>
    </div>
  );
}

function ConfirmationScreen({ candidate, onNext }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-black text-gray-900 mb-2">¡Solicitud enviada!</h2>
        <p className="text-gray-500 mb-6">Hemos recibido tu candidatura. El equipo revisará tu perfil y recibirás respuesta en 48h.</p>
        {onNext && <button onClick={onNext} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700">Ver evaluación →</button>}
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
        {slots.map(s => <button key={s} onClick={() => onSchedule(s)} className="w-full mb-2 py-3 border-2 border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:border-blue-400 hover:bg-blue-50">{s}</button>)}
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
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 animate-pulse">🤖</div>
        <p className="text-gray-500 text-sm">Cargando RecruitAI...</p>
      </div>
    </div>
  );
}

function LoginScreen({ onLogin, loading }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 p-10 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-6">🤖</div>
        <h1 className="text-3xl font-black text-gray-900 mb-2">RecruitAI</h1>
        <p className="text-gray-500 mb-8">Automatización de selección de personal para agencias digitales</p>
        <button onClick={onLogin} disabled={loading}
          className="w-full flex items-center justify-center gap-3 py-3.5 px-6 border-2 border-gray-200 rounded-xl font-semibold text-gray-700 hover:border-blue-400 hover:bg-blue-50 transition-all disabled:opacity-50">
          {loading ? <span className="text-sm">Iniciando sesión...</span> : (
            <><svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg><span>Continuar con Google</span></>
          )}
        </button>
        <p className="text-xs text-gray-400 mt-4">Tus datos se guardan de forma segura en Firebase</p>
      </div>
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
      await addDoc(collection(db, "publicProcesses", processId, "applications"), {
        name: candidate?.name || "", email: candidate?.email || "", phone: candidate?.phone || "",
        linkedin: candidate?.linkedin || "", presentation: candidate?.presentation || "",
        responses, submittedAt: new Date().toISOString(),
        estado: "Pendiente", progreso: "Ingreso", entrevistador: "", notas: "", phase: "applied",
      });

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
  if (error) return <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6"><div className="bg-white rounded-2xl shadow-sm p-10 max-w-md w-full text-center"><p className="text-4xl mb-4">⚠️</p><h2 className="font-bold text-gray-800 mb-2">Proceso no disponible</h2><p className="text-gray-500 text-sm">{error}</p></div></div>;
  if (submitted) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full text-center">
        <div className="text-5xl mb-4">🎉</div>
        <h2 className="text-2xl font-black text-gray-900 mb-2">¡Solicitud enviada!</h2>
        <p className="text-gray-500 mb-4">Hemos recibido tu candidatura para <strong>{processData?.company?.name}</strong>.</p>
        <div className="bg-blue-50 rounded-xl p-4 text-left text-sm text-blue-700 space-y-1">
          <p>✅ Datos personales recibidos</p><p>✅ Ejercicios y vídeo de defensa enviados</p>
          <p>📧 Recibirás confirmación en {candidate?.email}</p>
        </div>
      </div>
    </div>
  );
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
            className={`flex items-start gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${provider === id ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300 bg-white"}`}>
            <div className={`w-5 h-5 rounded-full border-2 mt-0.5 flex items-center justify-center shrink-0 ${provider === id ? "border-blue-500 bg-blue-500" : "border-gray-300"}`}>
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
                  {link && <a href={link} target="_blank" rel="noreferrer" className="text-xs text-blue-600 underline">{linkLabel}</a>}
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
          <button onClick={onCancel} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">
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

function OnboardingScreen({ user, onComplete }) {
  // ── Restore state from localStorage so a Slack OAuth redirect doesn't reset progress ──
  const _saved = (() => { try { return JSON.parse(localStorage.getItem("recruitai_onboarding") || "{}"); } catch { return {}; } })();

  const [step, setStep] = useState(_saved.step ?? 0);
  const [brandManual, setBrandManual] = useState(_saved.brandManual || "");
  const [emailConfig, setEmailConfig] = useState(_saved.emailConfig || { provider: "app" });
  const [slackConfig, setSlackConfig] = useState(_saved.slackConfig || { webhookUrl: "", notifications: { newApplication: "both", aiEvaluation: "instant", finalDecision: "both", dailyDigest: true } });
  const [brandTab, setBrandTab] = useState("text");
  const [uploading, setUploading] = useState(false);
  const [skipWarning, setSkipWarning] = useState(null); // null | "all" | "brand" | "email" | "slack"
  const fileRef = useRef(null);
  const STEPS = ["Bienvenida", "Tu marca", "Email", "Slack", "¡Listo!"];

  // Persist progress on every change so the Slack OAuth redirect doesn't lose it
  useEffect(() => {
    localStorage.setItem("recruitai_onboarding", JSON.stringify({ step, brandManual, emailConfig, slackConfig }));
  }, [step, brandManual, emailConfig, slackConfig]);

  // On mount: detect return from Slack OAuth (webhook URL in URL params)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const webhookUrl = params.get("slackWebhook");
    const channel = params.get("slackChannel");
    if (webhookUrl) {
      setSlackConfig(s => ({ ...s, webhookUrl, channelName: channel || "" }));
      setStep(3); // Jump to Slack step so user sees it connected
      window.history.replaceState({}, "", window.location.pathname);
    }
    if (params.get("slackError")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);

  // Map each skippable step to its warning key
  const STEP_WARNING_KEY = { 1: "brand", 2: "email", 3: "slack" };

  const handleFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "txt") { setBrandManual(await file.text()); setBrandTab("text"); }
      else if (ext === "docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        setBrandManual(result.value); setBrandTab("text");
      } else if (ext === "pdf") {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let t = ""; for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const ct = await pg.getTextContent(); t += ct.items.map(x => x.str).join(" ") + "\n"; }
        setBrandManual(t.trim()); setBrandTab("text");
      }
    } catch { /* ignore */ }
    setUploading(false);
  };

  const finish = () => {
    localStorage.removeItem("recruitai_onboarding");
    onComplete({ brandManual, emailConfig, slackConfig, onboardingCompleted: true });
  };
  const next = () => setStep(s => s + 1);
  const back = () => setStep(s => s - 1);

  // Try to skip — show warning if step has important config missing
  const trySkip = (warningKey) => setSkipWarning(warningKey);
  const confirmSkip = () => { setSkipWarning(null); if (skipWarning === "all") finish(); else next(); };
  const cancelSkip = () => setSkipWarning(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl">
        {/* Header */}
        <div className="px-8 pt-8 pb-4">
          <div className="flex justify-between items-center mb-6">
            <div className="text-2xl font-black text-blue-700">RecruitAI</div>
            <button onClick={() => trySkip("all")} className="text-xs text-gray-400 hover:text-gray-600 underline">Omitir configuración →</button>
          </div>
          {/* Progress bar */}
          <div className="flex gap-1.5 mb-2">
            {STEPS.map((s, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className={`h-1.5 w-full rounded-full transition-all duration-300 ${i <= step ? "bg-blue-600" : "bg-gray-200"}`} />
                <span className={`text-xs font-medium truncate w-full text-center ${i === step ? "text-blue-600" : "text-gray-400"}`}>{s}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="px-8 pb-6 max-h-[60vh] overflow-y-auto">

          {/* Step 0: Welcome */}
          {step === 0 && (
            <div className="text-center py-4 space-y-4">
              <div className="text-6xl">👋</div>
              <h2 className="text-2xl font-black text-gray-900">Hola, {user?.displayName?.split(" ")[0] || "bienvenido"}!</h2>
              <p className="text-gray-500 text-sm leading-relaxed">Vamos a configurar tu cuenta en 4 pasos para que puedas empezar a automatizar tu proceso de selección.</p>
              <div className="grid grid-cols-2 gap-3 mt-4">
                {[["🎨", "Tu marca", "Manual de valores para la IA"], ["📧", "Email", "Confirmaciones automáticas a candidatos"], ["🔔", "Slack", "Notificaciones al equipo"], ["🚀", "Listo", "Crea tu primer proceso"]].map(([ic, t, s]) => (
                  <div key={t} className="bg-gray-50 rounded-xl p-3 flex items-start gap-3">
                    <div className="text-xl shrink-0">{ic}</div>
                    <div>
                      <div className="text-xs font-bold text-gray-700">{t}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{s}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Step 1: Brand */}
          {step === 1 && (
            <div className="space-y-4 py-2">
              <div>
                <h2 className="text-lg font-black text-gray-900">🎨 Tu manual de marca</h2>
                <p className="text-sm text-gray-500 mt-1">La IA usará esta información para evaluar si cada candidato encaja con tu cultura de agencia. Puedes añadirlo ahora o más tarde.</p>
              </div>
              <div className="flex gap-2 bg-gray-100 p-1 rounded-xl">
                {[["text", "✏️ Escribir / Pegar"], ["upload", "📄 Subir documento"]].map(([id, label]) => (
                  <button key={id} onClick={() => setBrandTab(id)}
                    className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${brandTab === id ? "bg-white shadow text-gray-800" : "text-gray-500"}`}>{label}</button>
                ))}
              </div>
              {brandTab === "text" && (
                <textarea className={inp} rows={8} value={brandManual} onChange={e => setBrandManual(e.target.value)}
                  placeholder={"Pega aquí tu manual de marca o los valores de tu agencia.\n\nEjemplo:\n- Somos una agencia orientada a resultados medibles...\n- Buscamos perfiles con actitud, proactividad y orientación al cliente...\n- Tono: cercano, estructurado, confiable..."} />
              )}
              {brandTab === "upload" && (
                <div>
                  <div onClick={() => fileRef.current?.click()}
                    className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all">
                    {uploading ? <p className="text-sm text-blue-600">Extrayendo texto...</p> : (
                      <><p className="text-3xl mb-2">📁</p><p className="text-sm font-medium text-gray-700">Haz clic para seleccionar</p><p className="text-xs text-gray-400 mt-1">.txt, .docx, .pdf</p></>
                    )}
                  </div>
                  <input ref={fileRef} type="file" accept=".txt,.docx,.pdf" onChange={handleFile} className="hidden" />
                </div>
              )}
            </div>
          )}

          {/* Step 2: Email */}
          {step === 2 && (
            <div className="space-y-4 py-2">
              <div>
                <h2 className="text-lg font-black text-gray-900">📧 Configura el email</h2>
                <p className="text-sm text-gray-500 mt-1">Elige cómo enviar los emails automáticos a los candidatos. Puedes cambiarlo en cualquier momento.</p>
              </div>
              <EmailSetupWizard emailConfig={emailConfig} onChange={setEmailConfig} />
            </div>
          )}

          {/* Step 3: Slack */}
          {step === 3 && (
            <div className="space-y-4 py-2">
              <div>
                <h2 className="text-lg font-black text-gray-900">🔔 Notificaciones en Slack</h2>
                <p className="text-sm text-gray-500 mt-1">Conecta tu canal de Slack para recibir avisos cuando lleguen candidatos, se completen evaluaciones o se tomen decisiones. Puedes configurarlo en cualquier momento.</p>
              </div>
              <SlackSetupWizard slackConfig={slackConfig} onChange={setSlackConfig} />
            </div>
          )}

          {/* Step 4: Done */}
          {step === 4 && (
            <div className="text-center py-4 space-y-4">
              <div className="text-6xl">🎉</div>
              <h2 className="text-2xl font-black text-gray-900">¡Todo listo!</h2>
              <p className="text-gray-500 text-sm leading-relaxed">Tu cuenta está configurada. Ahora puedes crear tu primer proceso de selección y empezar a recibir candidatos.</p>
              <div className="bg-blue-50 rounded-xl p-4 text-left space-y-2">
                <p className="text-sm font-semibold text-blue-800">Resumen de configuración:</p>
                <p className="text-xs text-blue-700">{brandManual ? "✅ Manual de marca configurado" : "⚪ Manual de marca — configúralo después en ⚙️"}</p>
                <p className="text-xs text-blue-700">{emailConfig.provider === "app" ? "✅ Email activado (RecruitAI Mail)" : emailConfig.provider === "resend_domain" ? "✅ Email configurado (dominio propio)" : "⚪ Email — configúralo después en ⚙️"}</p>
                <p className="text-xs text-blue-700">{slackConfig.webhookUrl ? "✅ Slack conectado" : "⚪ Slack — configúralo después en ⚙️"}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="px-8 pb-8 space-y-2">
          <div className="flex gap-3">
            {step > 0 && step < 4 && (
              <button onClick={back} className="px-6 py-3 border border-gray-200 rounded-xl text-sm text-gray-500 hover:bg-gray-50">← Atrás</button>
            )}
            {step === 0 && (
              <button onClick={next} className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">Empezar configuración →</button>
            )}
            {step === 1 && (
              <button onClick={brandManual ? next : () => trySkip("brand")} className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">
                {brandManual ? "Continuar →" : "Continuar →"}
              </button>
            )}
            {step === 2 && (
              <button onClick={next} className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">
                Continuar →
              </button>
            )}
            {step === 3 && (
              <button onClick={slackConfig.webhookUrl ? next : () => trySkip("slack")} className="flex-1 py-3 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">
                {slackConfig.webhookUrl ? "Continuar →" : "Continuar →"}
              </button>
            )}
            {step === 4 && (
              <button onClick={finish} className="flex-1 py-3 bg-green-600 text-white rounded-xl text-sm font-bold hover:bg-green-700">🚀 Ir al dashboard</button>
            )}
          </div>
          {/* Per-step skip link (only for configurable steps not yet filled) */}
          {step === 1 && !brandManual && (
            <p className="text-center text-xs text-gray-400">
              <button onClick={() => trySkip("brand")} className="underline hover:text-gray-600">Omitir este paso</button>
            </p>
          )}
          {step === 2 && emailConfig.provider === "none" && (
            <p className="text-center text-xs text-gray-400">
              <button onClick={() => trySkip("email")} className="underline hover:text-gray-600">Configurar más tarde</button>
            </p>
          )}
          {step === 3 && !slackConfig.webhookUrl && (
            <p className="text-center text-xs text-gray-400">
              <button onClick={() => trySkip("slack")} className="underline hover:text-gray-600">Omitir este paso</button>
            </p>
          )}
        </div>

        {/* Skip warning modal */}
        {skipWarning && <SkipWarningModal warningKey={skipWarning} onConfirm={confirmSkip} onCancel={cancelSkip} />}
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
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${notifications[key] === val ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"}`}>
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
                className={`w-12 h-6 rounded-full transition-all relative ${notifications.dailyDigest ? "bg-blue-600" : "bg-gray-300"}`}>
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
              <p>1. Ve a <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" className="text-blue-600 underline">api.slack.com/apps</a> → Create New App → From scratch</p>
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
function AgencySettingsModal({ settings, onSave, onClose }) {
  const [section, setSection] = useState("marca");
  const [brandManual, setBrandManual] = useState(settings?.brandManual || "");
  const [brandTab, setBrandTab] = useState("text");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [fileName, setFileName] = useState("");
  const [emailConfig, setEmailConfig] = useState(settings?.emailConfig || { provider: "none" });
  const [slackConfig, setSlackConfig] = useState(settings?.slackConfig || { webhookUrl: "", notifications: { newApplication: "both", aiEvaluation: "instant", finalDecision: "both", dailyDigest: true } });
  const [schedulingUrl, setSchedulingUrl] = useState(settings?.schedulingUrl || "");
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

  const handleSave = () => { onSave({ brandManual, emailConfig, slackConfig, schedulingUrl: schedulingUrl.trim() }); onClose(); };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <h2 className="font-bold text-gray-800">⚙️ Configuración de agencia</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        {/* Section tabs */}
        <div className="flex border-b border-gray-100 shrink-0 overflow-x-auto">
          {[["marca", "🎨 Marca"], ["agenda", "🗓 Agenda"], ["email", "📧 Email"], ["slack", "🔔 Slack"]].map(([id, label]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`flex-1 py-3 text-sm font-semibold transition-colors whitespace-nowrap ${section === id ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-400 hover:text-gray-600"}`}>
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
                    className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all">
                    {uploading ? <p className="text-sm text-blue-600 font-medium">Extrayendo texto...</p> : (
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

          {/* ── AGENDA ── */}
          {section === "agenda" && (
            <div className="space-y-4">
              <div>
                <h3 className="font-bold text-gray-800 text-sm">🗓 Link de agendamiento para entrevistas</h3>
                <p className="text-xs text-gray-500 mt-1">Pega la URL pública de tu calendario. Cuando marques un candidato como <strong>"Segunda entrevista"</strong> o <strong>"Contratado"</strong>, el email automático incluirá un botón para que agende directamente contigo.</p>
              </div>
              <div>
                <label className={lbl}>URL de tu calendario</label>
                <input
                  className={inp}
                  type="url"
                  value={schedulingUrl}
                  onChange={e => setSchedulingUrl(e.target.value)}
                  placeholder="https://cal.com/tu-usuario/entrevista"
                />
                <p className="text-xs text-gray-400 mt-1.5">Compatible con <strong>Cal.com, Calendly, TidyCal, Google Calendar Appointment Schedules, SavvyCal</strong> o cualquier URL pública de agendamiento.</p>
              </div>
              {schedulingUrl && (
                <a href={schedulingUrl} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-medium">
                  🔗 Probar el link en nueva pestaña →
                </a>
              )}
              {!schedulingUrl && (
                <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
                  <p className="text-xs text-blue-700 leading-relaxed">
                    💡 <strong>Sin configurar:</strong> el email avisará al candidato de que te pondrás en contacto manualmente. Con link configurado, la experiencia es 100% self-service.
                  </p>
                </div>
              )}
            </div>
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
          <button onClick={handleSave} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">Guardar</button>
        </div>
      </div>
    </div>
  );
}

// ─── CANDIDATE EVALUATION PANEL ──────────────────────────────────────────────
const REC_COLORS = {
  AVANZAR: "bg-green-100 text-green-800", REVISAR: "bg-yellow-100 text-yellow-800",
  DESCARTAR: "bg-red-100 text-red-700", CONTRATAR: "bg-emerald-100 text-emerald-800",
  SEGUNDA_ENTREVISTA: "bg-blue-100 text-blue-800", EN_CARTERA: "bg-yellow-100 text-yellow-800",
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

  const exerciseEval = candidate.exerciseEvaluation;
  const interviewEval = candidate.interviewEvaluation;
  const responses = candidate.responses || [];
  const position = getPositionTitle(process.position);

  const evaluateExercise = async () => {
    setEvaluatingEx(true); setError(null);
    try {
      const firstResponse = responses[0] || {};
      const exercise = process.exercises?.[0] || {};
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "exercise",
          data: {
            exerciseTitle: exercise.title || "Ejercicio",
            exerciseDescription: exercise.description || "",
            writtenResponse: firstResponse.response || "",
            loomUrl: firstResponse.loomUrl || "",
            position,
            brandManual: agencySettings?.brandManual || "",
            companyName: process.company?.name || "",
          },
        }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      onUpdateCandidate({ ...candidate, exerciseEvaluation: json.evaluation });
      // Slack notification
      sendSlackNotification(agencySettings?.slackConfig, "ai_evaluation", {
        candidateName: candidate.name, positionTitle: position,
        evaluationType: "exercise", recommendation: json.evaluation?.overall?.recommendation,
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
    onUpdateCandidate({ ...candidate, estado: decision, finalDecision: decision });

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
            schedulingUrl: agencySettings?.schedulingUrl || "",
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
            <button key={id} onClick={() => setTab(id)} className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${tab === id ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-400 hover:text-gray-600"}`}>{label}</button>
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
                        {r.loomUrl && <a href={r.loomUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-1">🎥 Ver vídeo de defensa en Loom →</a>}
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
                  <div className="flex items-center justify-between bg-indigo-50 rounded-xl p-4">
                    <div><p className="font-bold text-indigo-800">Resultado del ejercicio</p><p className="text-xs text-indigo-500 mt-0.5">{exerciseEval.summary}</p></div>
                    <div className="text-right"><p className="text-3xl font-black text-indigo-700">{exerciseEval.overall}<span className="text-sm font-medium text-indigo-400">/100</span></p><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${REC_COLORS[exerciseEval.recommendation] || "bg-gray-100 text-gray-700"}`}>{REC_LABELS[exerciseEval.recommendation] || exerciseEval.recommendation}</span></div>
                  </div>
                  <div className="space-y-2">
                    {(exerciseEval.criteria || []).map((c, i) => (
                      <div key={i} className="flex items-start gap-3 bg-white border border-gray-100 rounded-xl p-3">
                        <div className="shrink-0 w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center font-black text-gray-700">{c.score}<span className="text-xs text-gray-400">/10</span></div>
                        <div className="flex-1 min-w-0"><p className="text-xs font-bold text-gray-700">{c.name}</p><p className="text-xs text-gray-500 mt-0.5">{c.feedback}</p></div>
                      </div>
                    ))}
                  </div>
                  {exerciseEval.strengths?.length > 0 && <div className="bg-green-50 rounded-xl p-3"><p className="text-xs font-bold text-green-700 mb-1">✅ Puntos fuertes</p>{exerciseEval.strengths.map((s, i) => <p key={i} className="text-xs text-green-600">· {s}</p>)}</div>}
                  {exerciseEval.gaps?.length > 0 && <div className="bg-orange-50 rounded-xl p-3"><p className="text-xs font-bold text-orange-700 mb-1">⚠️ Áreas de mejora</p>{exerciseEval.gaps.map((s, i) => <p key={i} className="text-xs text-orange-600">· {s}</p>)}</div>}
                  <button onClick={() => onUpdateCandidate({ ...candidate, exerciseEvaluation: null })} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">Reevaluar</button>
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
                      {(interviewEval.interviewer.improvements || []).length > 0 && <div>{interviewEval.interviewer.improvements.map((s, i) => <p key={i} className="text-xs text-orange-600">→ {s}</p>)}</div>}
                    </div>
                  )}
                  <button onClick={() => { onUpdateCandidate({ ...candidate, interviewEvaluation: null, interviewTranscript: "" }); setInterviewTranscript(""); }} className="text-xs text-gray-400 hover:text-gray-600 hover:underline">Reevaluar entrevista</button>
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
                  {[["Contratado", "🎉 Contratar", "bg-green-600 hover:bg-green-700 text-white"], ["Segunda entrevista", "🔄 Segunda entrevista", "bg-blue-600 hover:bg-blue-700 text-white"], ["En cartera", "📁 En cartera", "bg-yellow-500 hover:bg-yellow-600 text-white"], ["Descartado", "❌ Descartar", "bg-red-500 hover:bg-red-600 text-white"]].map(([val, label, cls]) => (
                    <button key={val} onClick={() => setFinalDecision(val)} className={`py-3 rounded-xl font-bold text-sm transition-colors ${cls} ${candidate.estado === val ? "ring-4 ring-offset-2 ring-gray-300" : ""}`}>{label}</button>
                  ))}
                </div>
                {candidate.finalDecision && <p className="text-xs text-center text-gray-400 mt-3">Decisión registrada: <strong>{candidate.finalDecision}</strong></p>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PIPELINE CONSTANTS ───────────────────────────────────────────────────────
const ESTADO_OPTIONS = ["Pendiente", "Primera entrevista", "Segunda entrevista", "En cartera", "Descartado", "Contratado"];
const PROGRESO_OPTIONS = ["Ingreso", "Prueba técnica", "Entrevista", "Onboarding", "Descalificado", "En cartera", "Desiste", "Validación prueba técnica", "Entrevista RRHH"];
const ESTADO_COLORS = { "Pendiente": "bg-gray-100 text-gray-700", "Primera entrevista": "bg-blue-100 text-blue-700", "Segunda entrevista": "bg-indigo-100 text-indigo-700", "En cartera": "bg-yellow-100 text-yellow-700", "Descartado": "bg-red-100 text-red-700", "Contratado": "bg-green-100 text-green-700" };
const PROGRESO_COLORS = { "Ingreso": "bg-purple-100 text-purple-700", "Prueba técnica": "bg-blue-100 text-blue-700", "Entrevista": "bg-indigo-100 text-indigo-700", "Onboarding": "bg-teal-100 text-teal-700", "Descalificado": "bg-red-100 text-red-700", "En cartera": "bg-yellow-100 text-yellow-700", "Desiste": "bg-orange-100 text-orange-700", "Validación prueba técnica": "bg-cyan-100 text-cyan-700", "Entrevista RRHH": "bg-violet-100 text-violet-700" };

// ─── PROCESS DETAIL SCREEN ───────────────────────────────────────────────────
function ProcessDetailScreen({ process, onBack, onUpdate, user, onStartDemo, agencySettings }) {
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

  const updateCandidate = (id, field, value) => { const u = candidates.map(c => c.id === id ? { ...c, [field]: value } : c); setCandidates(u); onUpdate(process.id, u); };
  const updateCandidateFull = (updated) => { const u = candidates.map(c => c.id === updated.id ? updated : c); setCandidates(u); onUpdate(process.id, u); if (evalCandidate?.id === updated.id) setEvalCandidate(updated); };
  const addCandidate = () => { if (!newName.trim()) return; const nc = { id: `c_${Date.now()}`, name: newName.trim(), email: newEmail.trim(), phase: "applied", estado: "Pendiente", progreso: "Ingreso", entrevistador: user?.displayName || "", notas: "" }; const u = [...candidates, nc]; setCandidates(u); onUpdate(process.id, u); setNewName(""); setNewEmail(""); setShowAddForm(false); };
  const removeCandidate = (id) => { if (!window.confirm("¿Eliminar este candidato?")) return; const u = candidates.filter(c => c.id !== id); setCandidates(u); onUpdate(process.id, u); };

  const generatePublicLink = async () => {
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
    } catch (e) { alert("Error al generar el link."); }
    setPublishing(false);
  };

  const copyLink = async () => { if (!publicLink) return; await navigator.clipboard.writeText(publicLink); setLinkCopied(true); setTimeout(() => setLinkCopied(false), 2000); };

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
  const statColors = ["bg-gray-50 text-gray-700", "bg-blue-50 text-blue-700", "bg-indigo-50 text-indigo-700", "bg-yellow-50 text-yellow-700", "bg-red-50 text-red-600", "bg-green-50 text-green-700"];

  return (
    <div className="min-h-screen bg-gray-50">
      {evalCandidate && <CandidateEvaluationPanel candidate={evalCandidate} process={process} agencySettings={agencySettings} onUpdateCandidate={updateCandidateFull} onClose={() => setEvalCandidate(null)} />}
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-700 text-sm shrink-0">← Panel</button>
          <div className="w-px h-4 bg-gray-200 shrink-0" />
          <span className="text-xl font-black text-blue-600 shrink-0">RecruitAI</span>
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
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
          {statsByEstado.map(({ label, count }, i) => (<div key={label} className={`rounded-xl border border-gray-100 p-3 text-center shadow-sm ${statColors[i]}`}><p className="text-2xl font-black leading-none">{count}</p><p className="text-xs leading-tight mt-1 opacity-80">{label}</p></div>))}
        </div>
        {/* Link público */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="font-bold text-gray-800 text-sm">🔗 Link público para candidatos</p><p className="text-xs text-gray-400 mt-0.5">Genera un link único que los candidatos abren para aplicar.</p></div>
            <div className="flex gap-2 flex-wrap">
              {publicLink && <button onClick={importApplications} disabled={importing} className="px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-50 disabled:opacity-50">{importing ? "Importando..." : "⬇ Importar candidatos"}</button>}
              <button onClick={generatePublicLink} disabled={publishing} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">{publishing ? "Publicando..." : publicLink ? "🔄 Regenerar link" : "🚀 Generar link público"}</button>
            </div>
          </div>
          {publicLink && (<div className="mt-3 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2"><span className="text-xs text-gray-500 font-mono flex-1 truncate">{publicLink}</span><button onClick={copyLink} className={`text-xs font-semibold px-3 py-1.5 rounded-lg shrink-0 transition-colors ${linkCopied ? "bg-green-100 text-green-700" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-100"}`}>{linkCopied ? "✓ Copiado" : "Copiar"}</button></div>)}
          {importCount > 0 && <p className="text-xs text-green-600 font-semibold mt-2">✅ {importCount} nueva{importCount > 1 ? "s" : ""} candidatura{importCount > 1 ? "s" : ""} importada{importCount > 1 ? "s" : ""}</p>}
          {importCount === -1 && <p className="text-xs text-gray-400 mt-2">No hay candidaturas nuevas.</p>}
        </div>
        {/* Candidate Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <h2 className="font-bold text-gray-800">Candidatos <span className="text-gray-400 font-normal text-sm">({candidates.length})</span></h2>
            <button onClick={() => setShowAddForm(v => !v)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700">+ Añadir candidato</button>
          </div>
          {showAddForm && (
            <div className="px-5 py-4 bg-blue-50 border-b border-blue-100 flex flex-wrap items-end gap-3">
              <div><label className={lbl}>Nombre *</label><input className={inp} style={{ width: "180px" }} value={newName} onChange={e => setNewName(e.target.value)} autoFocus onKeyDown={e => e.key === "Enter" && addCandidate()} /></div>
              <div><label className={lbl}>Email</label><input className={inp} style={{ width: "220px" }} value={newEmail} onChange={e => setNewEmail(e.target.value)} type="email" /></div>
              <div className="flex gap-2"><button onClick={addCandidate} className="px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700">Añadir</button><button onClick={() => { setShowAddForm(false); setNewName(""); setNewEmail(""); }} className="px-4 py-2.5 border border-gray-200 bg-white text-gray-500 rounded-lg text-sm">Cancelar</button></div>
            </div>
          )}
          {candidates.length === 0 ? (
            <div className="text-center py-14"><p className="text-4xl mb-3">👥</p><p className="text-gray-400 text-sm font-medium">No hay candidatos en este proceso.</p><button onClick={() => setShowAddForm(true)} className="mt-3 text-blue-500 text-sm hover:underline">+ Añadir el primero</button></div>
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
                    <tr key={c.id} className={`border-b border-gray-50 hover:bg-blue-50/20 transition-colors ${i % 2 === 1 ? "bg-gray-50/30" : ""}`}>
                      <td className="px-4 py-3"><p className="font-semibold text-gray-800 leading-tight">{c.name}</p>{c.email && <p className="text-xs text-gray-400 mt-0.5">{c.email}</p>}</td>
                      <td className="px-4 py-3"><select value={c.estado || "Pendiente"} onChange={e => updateCandidate(c.id, "estado", e.target.value)} className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 ${ESTADO_COLORS[c.estado || "Pendiente"] || "bg-gray-100 text-gray-700"}`} style={{ maxWidth: "155px" }}>{ESTADO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td className="px-4 py-3"><select value={c.progreso || "Ingreso"} onChange={e => updateCandidate(c.id, "progreso", e.target.value)} className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border border-transparent cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-300 ${PROGRESO_COLORS[c.progreso || "Ingreso"] || "bg-gray-100 text-gray-700"}`} style={{ maxWidth: "185px" }}>{PROGRESO_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}</select></td>
                      <td className="px-4 py-3"><input type="text" value={c.entrevistador || ""} onChange={e => updateCandidate(c.id, "entrevistador", e.target.value)} placeholder="Asignar..." className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-transparent" /></td>
                      <td className="px-4 py-3"><input type="text" value={c.notas || ""} onChange={e => updateCandidate(c.id, "notas", e.target.value)} placeholder="Añadir nota..." className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300 bg-transparent" /></td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => setEvalCandidate(c)} className={`text-xs font-semibold px-2 py-1 rounded-lg transition-colors ${c.exerciseEvaluation || c.interviewEvaluation ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
                          {c.exerciseEvaluation && c.interviewEvaluation ? "✅ Ver" : c.exerciseEvaluation ? "🎤 Entrev." : "🤖 Evaluar"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center"><button onClick={() => removeCandidate(c.id)} className="text-gray-300 hover:text-red-400 text-xl leading-none">×</button></td>
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
        <button onClick={() => onToggle(process.id)} className={`ml-3 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${isActive ? "border-orange-200 text-orange-600 hover:bg-orange-50" : "border-green-200 text-green-600 hover:bg-green-50"}`}>{isActive ? "⏸ Pausar" : "▶ Activar"}</button>
      </div>
      <div className="grid grid-cols-6 gap-1 mb-4">
        {byEstado.map((s, i) => <div key={s.label} className={`rounded-lg p-1.5 text-center ${["bg-gray-50", "bg-blue-50", "bg-indigo-50", "bg-yellow-50", "bg-red-50", "bg-green-50"][i]}`}><p className="text-base font-black leading-none text-gray-800">{s.val}</p><p className="text-xs text-gray-400 mt-0.5 leading-tight hidden sm:block" style={{ fontSize: "9px" }}>{s.label}</p></div>)}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position?.contract}</span>
          <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{process.position?.hoursPerWeek}h/sem</span>
          {process.company?.salaryMin && <span className="text-xs bg-green-50 text-green-600 px-2 py-0.5 rounded-full">{Number(process.company.salaryMin).toLocaleString()}–{Number(process.company.salaryMax).toLocaleString()} {process.company.currency}</span>}
        </div>
        <button onClick={() => onView(process)} className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700">Ver proceso →</button>
      </div>
    </div>
  );
}

function RecruiterDashboard({ processes, onNew, onView, onToggle, user, onLogout, onOpenSettings }) {
  const active = processes.filter(p => p.status === "active").length;
  const totalCandidates = processes.reduce((s, p) => s + (p.candidates?.length || 0), 0);
  const hired = processes.reduce((s, p) => s + (p.candidates?.filter(c => c.estado === "Contratado" || c.phase === "hired").length || 0), 0);
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-black text-blue-600">RecruitAI</span>
            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-semibold">Panel de reclutador</span>
          </div>
          <div className="flex items-center gap-2">
            {user?.photoURL && <img src={user.photoURL} alt={user.displayName} className="w-8 h-8 rounded-full border-2 border-gray-200" />}
            <span className="text-sm text-gray-600 hidden sm:block">{user?.displayName?.split(" ")[0]}</span>
            <button onClick={onOpenSettings} className="px-3 py-2 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50" title="Configuración de agencia">⚙️</button>
            <button onClick={onNew} className="px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-bold hover:bg-blue-700">+ Nuevo proceso</button>
            <button onClick={onLogout} className="px-3 py-2.5 border border-gray-200 text-gray-500 rounded-xl text-sm hover:bg-gray-50" title="Cerrar sesión">↩</button>
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
            <p className="text-4xl mb-3">🚀</p><h3 className="font-bold text-gray-700 mb-1">Sin procesos activos</h3>
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

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [publicProcessId] = useState(() => { const m = window.location.hash.match(/^#apply\/(.+)$/); return m ? m[1] : null; });
  if (publicProcessId) return <CandidatePublicScreen processId={publicProcessId} />;

  const [phase, setPhase] = useState("dashboard");
  const [processes, setProcesses] = useState(MOCK_PROCESSES);
  const [activeJob, setActiveJob] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [interview, setInterview] = useState(null);
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [agencySettings, setAgencySettings] = useState({ brandManual: "", emailConfig: { provider: "app" }, slackConfig: { webhookUrl: "", notifications: { newApplication: "both", aiEvaluation: "instant", finalDecision: "both", dailyDigest: true } }, onboardingCompleted: false });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

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
    const t = setTimeout(async () => {
      try { await setDoc(doc(db, "recruiters", user.uid), { processes, settings: agencySettings, updatedAt: new Date().toISOString() }, { merge: true }); }
      catch (e) { console.error("Error saving:", e); }
    }, 1000);
    return () => clearTimeout(t);
  }, [processes, agencySettings, user]);

  // ── Slack OAuth callback: detect webhook URL returned from /api/slack/callback ──
  useEffect(() => {
    if (!user || !settingsLoaded) return;
    // During onboarding, OnboardingScreen handles the callback itself
    if (!agencySettings.onboardingCompleted) return;
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
  const handleLogout = async () => { await signOut(auth); setProcesses(MOCK_PROCESSES); setAgencySettings({ brandManual: "", emailConfig: { provider: "app" }, slackConfig: { webhookUrl: "" }, onboardingCompleted: false }); setSettingsLoaded(false); setPhase("dashboard"); };
  const goToDashboard = () => { setPhase("dashboard"); setActiveJob(null); setCandidate(null); setEvaluation(null); setInterview(null); };
  const handlePublish = (jobData) => { const np = { id: `p_${Date.now()}`, status: "active", createdAt: new Date().toISOString().split("T")[0], ...jobData, candidates: [] }; setProcesses(ps => [np, ...ps]); setActiveJob(jobData); setPhase("preview"); };
  const handleToggle = (id) => setProcesses(ps => ps.map(p => p.id === id ? { ...p, status: p.status === "active" ? "paused" : "active" } : p));
  const handleViewProcess = (process) => { setActiveJob(process); setPhase("process_detail"); };
  const handleStartDemo = (process) => { setActiveJob(process); setPhase("preview"); };
  const handleUpdateCandidates = (processId, updatedCandidates) => {
    setProcesses(ps => ps.map(p => p.id === processId ? { ...p, candidates: updatedCandidates } : p));
    setActiveJob(aj => aj?.id === processId ? { ...aj, candidates: updatedCandidates } : aj);
  };
  const handleSaveSettings = (newSettings) => { setAgencySettings(s => ({ ...s, ...newSettings })); };

  const handleCompleteOnboarding = (newSettings) => {
    setAgencySettings(s => ({ ...s, ...newSettings, onboardingCompleted: true }));
  };

  if (authLoading || !settingsLoaded) return <LoadingScreen />;
  if (!user) return <LoginScreen onLogin={handleLogin} loading={loginLoading} />;
  if (!agencySettings.onboardingCompleted) return <OnboardingScreen user={user} onComplete={handleCompleteOnboarding} />;

  return (
    <>
      {showSettings && <AgencySettingsModal settings={agencySettings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />}
      {phase === "dashboard" && <RecruiterDashboard processes={processes} onNew={() => setPhase("setup")} onView={handleViewProcess} onToggle={handleToggle} user={user} onLogout={handleLogout} onOpenSettings={() => setShowSettings(true)} />}
      {phase === "process_detail" && (() => { const lp = processes.find(p => p.id === activeJob?.id) || activeJob; return <ProcessDetailScreen process={lp} onBack={goToDashboard} onUpdate={handleUpdateCandidates} user={user} onStartDemo={() => handleStartDemo(lp)} agencySettings={agencySettings} />; })()}
      {phase === "setup" && <RecruiterSetupScreen onPublish={handlePublish} onBack={goToDashboard} />}
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

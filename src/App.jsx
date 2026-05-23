import { useState, useEffect, useRef, useMemo } from "react";
import {
  Plus, Search, ChevronRight, ChevronLeft, Car, FileText, DollarSign,
  Mail, Camera, Trash2, Check, Clock, Edit, ArrowLeft,
  Send, Calendar, User, Building, X, Download,
  Settings, AlertCircle, ChevronDown, WifiOff, Paperclip,
  Lock, BarChart3, ListChecks, LogOut, Receipt, Package
} from "lucide-react";
import { supabase } from "./supabase.js";
import JSZip from "jszip";
import * as XLSX from "xlsx";

// ─── CONSTANTS ──────────────────────────────────────────────────
const COMPANY = { name: "Sistemcar SRL", agent: "Mada Sebastian" };
const APP_PASSWORD = "Complexitate1988!";
const STORAGE_BUCKET = "msm-files";

const ASIGURATORI = [
  "Allianz-Țiriac","Omniasig","Asirom","Groupama","Hellas Direct",
  "Axeria","Dallbogg","Generali","Uniqa","Signal Iduna",
  "Euroins","Grawe","Gothaer","AXA","Ergo",
  "BCR Asigurări","BRD Asigurări","Certasig","NN Asigurări",
  "Vienna Insurance Group","Astra Asigurări","Altele"
];

const STATUS = {
  constatare:     { label:"Constatare",     bg:"bg-sky-100",    text:"text-sky-700",    dot:"bg-sky-500" },
  reconstatare:   { label:"Reconstatare",   bg:"bg-amber-100",  text:"text-amber-700",  dot:"bg-amber-500" },
  in_lucru:       { label:"În lucru",       bg:"bg-indigo-100", text:"text-indigo-700", dot:"bg-indigo-500" },
  finalizat:      { label:"Finalizat",      bg:"bg-emerald-100",text:"text-emerald-700",dot:"bg-emerald-500" },
};

const SOLUTII = ["INL", "REP", "UNI", "REV", "VER", "GEO"];

const START_DATE_OPTS = [
  { key:"constatare",   label:"Data constatare" },
  { key:"avizare",      label:"Data avizare (daună totală)" },
  { key:"raportTotala", label:"Data primire raport daună totală" },
  { key:"comandaPiesa", label:"Data comandă piesă" },
  { key:"primirePiese", label:"Data primire piese" },
  { key:"custom",       label:"Dată personalizată" },
];

const PERIOD_OPTS = [
  { key:"1m",  label:"Ultima lună" },
  { key:"3m",  label:"Ultimele 3 luni" },
  { key:"6m",  label:"Ultimele 6 luni" },
  { key:"1y",  label:"An curent" },
  { key:"all", label:"Tot timpul" },
];

// ─── HELPERS ────────────────────────────────────────────────────
const mkDosar = () => ({
  id: Date.now().toString(),
  nrDosar:"", status:"constatare",
  proprietar:{ nume:"", telefon:"", email:"" },
  masina:{ marca:"", model:"", an:"", vin:"", nrInmatriculare:"" },
  asigurator:{ companie:"", inspector:"", contact:"" },
  dataEveniment:"", dataConstatare:"",
  reconstatari: [],
  despagubire: { emailExtra:"", emailSent:false, emailSentAt:"", documente:[] },
  financiar:{
    sumaFacturata:0,
    nrFactura:"", dataFactura:"", dataScadenta:"",
    cheltuieli:[],
    totalCheltuieli:0, sumaRamasa:0, comision:0,
    achitat: false, achitari: [],
    comisionIncasat: false, dataIncasareComision: "",
  },
  masinaSchimb:{
    startDateType:"constatare", customStartDate:"",
    dataAvizare:"", dataRaportTotala:"", dataComandaPiesa:"", dataPrimirePiese:"",
    dataPredareMasinaSchimb:"", zileFacturabile:0, tarifZi:0, totalFacturabil:0
  },
  poze:[], note:"",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
});

const mkReconstatare = () => ({
  id: Date.now().toString() + Math.random().toString(36).slice(2,7),
  data: today(),
  observatii: "",
  piese: Array.from({length:5}, () => ({
    id: Date.now().toString()+Math.random(),
    piesa: "", solutie: "INL", solutieCustom: ""
  })),
  poze: [],
  documente: [],
  emailExtra: "",
  emailSent: false,
  emailSentAt: "",
});

const mkSettings = () => ({
  emailjs:{ serviceId:"", templateId:"", publicKey:"", fromName: COMPANY.agent, fromEmail:"" },
  asiguratorEmails:{},
});

const fmtDate = s => {
  if (!s) return "—";
  try { return new Date(s).toLocaleDateString("ro-RO",{day:"2-digit",month:"2-digit",year:"numeric"}); }
  catch { return s; }
};

const today = () => new Date().toISOString().split("T")[0];

const calcFin = fin => {
  const totalCheltuieli = (fin.cheltuieli||[]).reduce((s,c)=>s+Number(c.suma||0),0);
  const sumaRamasa = Number(fin.sumaFacturata||0) - totalCheltuieli;
  return { ...fin, totalCheltuieli, sumaRamasa, comision: sumaRamasa * 0.05 };
};

const getSchimbStart = (s, dosar) => {
  if (!s) return null;
  const m = { constatare:dosar.dataConstatare, avizare:s.dataAvizare, raportTotala:s.dataRaportTotala,
    comandaPiesa:s.dataComandaPiesa, primirePiese:s.dataPrimirePiese, custom:s.customStartDate };
  return m[s.startDateType] || null;
};

const calcZile = (s, dosar) => {
  const start = getSchimbStart(s, dosar), end = s?.dataPredareMasinaSchimb;
  if (!start||!end) return 0;
  const d = Math.ceil((new Date(end)-new Date(start))/86400000);
  return d>0?d:0;
};

const getPeriodStart = key => {
  const d = new Date();
  if (key==="1m") { d.setMonth(d.getMonth()-1); return d; }
  if (key==="3m") { d.setMonth(d.getMonth()-3); return d; }
  if (key==="6m") { d.setMonth(d.getMonth()-6); return d; }
  if (key==="1y") return new Date(d.getFullYear(),0,1);
  return new Date(0);
};

const getAsigEmail = (settings, companie, tip) => {
  const e = settings.asiguratorEmails?.[companie];
  if (!e) return "";
  if (tip==="reconstatare") return e.reconstatare||"";
  if (tip==="despagubire")  return e.despagubire||"";
  return e.alte||e.despagubire||e.reconstatare||"";
};

// ─── STORAGE (Supabase) ─────────────────────────────────────────
const uploadFile = async (dosarId, folder, file) => {
  const ext = file.name.split('.').pop();
  const path = `${dosarId}/${folder}/${Date.now()}_${Math.random().toString(36).slice(2,8)}.${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: '3600', upsert: false
  });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { path, url: data.publicUrl, name: file.name, type: file.type, size: file.size, date: new Date().toISOString() };
};

const deleteFile = async (path) => {
  if (!path) return;
  await supabase.storage.from(STORAGE_BUCKET).remove([path]);
};

// ─── EMAIL TEMPLATES ────────────────────────────────────────────
const buildReconstatareEmail = (dosar, recon, extraText) => {
  const piese = (recon?.piese||[]).filter(p => p.piesa?.trim());
  const subject = `Solicitare reconstatare – Dosar ${dosar.nrDosar} – ${dosar.masina?.nrInmatriculare||""}`;
  let body = `Bună ziua,\n\n`;
  body += `Vă transmitem solicitare de reconstatare pentru dosarul nr. ${dosar.nrDosar}, vehicul ${dosar.masina?.marca||""} ${dosar.masina?.model||""}, nr. înmatriculare ${dosar.masina?.nrInmatriculare||""}.\n`;
  if (piese.length > 0) {
    body += `\nElemente solicitate:\n`;
    piese.forEach((p,i) => {
      const sol = p.solutie === "__custom__" ? (p.solutieCustom||"") : (p.solutie||"");
      body += `${i+1}. ${p.piesa}${sol ? " — " + sol : ""}\n`;
    });
  }
  if (extraText?.trim()) body += `\n${extraText.trim()}\n`;
  body += `\nCu stimă,\n${COMPANY.agent}\n${COMPANY.name}`;
  return { subject, body };
};

const buildDespagubireEmail = (dosar, extraText) => {
  const subject = `Cerere de despăgubire – Dosar ${dosar.nrDosar} – ${dosar.masina?.nrInmatriculare||""}`;
  let body = `Bună ziua,\n\n`;
  body += `Transmitem atașat documentele necesare finalizării dosarului de daună nr. ${dosar.nrDosar}, vehicul ${dosar.masina?.marca||""} ${dosar.masina?.model||""}, nr. înmatriculare ${dosar.masina?.nrInmatriculare||""}.\n`;
  if (extraText?.trim()) body += `\n${extraText.trim()}\n`;
  body += `\nCu stimă,\n${COMPANY.agent}\n${COMPANY.name}`;
  return { subject, body };
};

const sendEmail = async (cfg, params) => {
  if (!cfg.serviceId||!cfg.templateId||!cfg.publicKey) throw new Error("Configurare EmailJS incompletă. Mergi la Setări.");
  const r = await fetch("https://api.emailjs.com/api/v1.0/email/send",{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ service_id:cfg.serviceId, template_id:cfg.templateId, user_id:cfg.publicKey, template_params:params })
  });
  if (!r.ok) throw new Error(`EmailJS: ${await r.text()||r.statusText}`);
};

// ─── DB ─────────────────────────────────────────────────────────
const db = {
  loadDosare: async () => {
    const { data, error } = await supabase.from("dosare").select("data").order("updated_at",{ascending:false});
    if (error) throw error;
    return (data||[]).map(r=>r.data);
  },
  saveDosar: async dosar => {
    const { error } = await supabase.from("dosare").upsert({ id:dosar.id, data:dosar, updated_at:dosar.updatedAt });
    if (error) throw error;
  },
  deleteDosar: async id => {
    const { error } = await supabase.from("dosare").delete().eq("id",id);
    if (error) throw error;
  },
  loadSettings: async () => {
    const { data, error } = await supabase.from("app_settings").select("data").eq("id","main").single();
    if (error && error.code!=="PGRST116") throw error;
    return { ...mkSettings(), ...(data?.data||{}) };
  },
  saveSettings: async s => {
    const { error } = await supabase.from("app_settings").upsert({ id:"main", data:s, updated_at:new Date().toISOString() });
    if (error) throw error;
  },
};

// ─── LOGO ───────────────────────────────────────────────────────
function Logo({ size=36 }) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} className="flex-shrink-0">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8"/><stop offset="100%" stopColor="#0284c7"/>
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="56" height="56" rx="12" fill="#0f172a"/>
      <rect x="2" y="2" width="56" height="56" rx="12" fill="none" stroke="url(#g)" strokeWidth="1.5"/>
      <text x="30" y="33" textAnchor="middle" fontWeight="900" fontSize="17"
        fill="url(#g)" fontFamily="Arial Black,sans-serif" letterSpacing="-0.5">MSM</text>
      <line x1="14" y1="44" x2="46" y2="44" stroke="url(#g)" strokeWidth="1.2"/>
      <text x="30" y="52" textAnchor="middle" fontWeight="600" fontSize="6"
        fill="#94a3b8" fontFamily="Arial,sans-serif" letterSpacing="2">DAUNE</text>
    </svg>
  );
}

// ─── LOGIN ──────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState(false);

  const submit = (e) => {
    e?.preventDefault();
    if (pwd === APP_PASSWORD) {
      localStorage.setItem("msm_auth", "1");
      onLogin();
    } else {
      setErr(true); setPwd(""); setTimeout(()=>setErr(false), 1500);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{background:"#0f172a"}}>
      <form onSubmit={submit} className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Logo size={70}/>
          <div className="text-white font-bold text-2xl mt-4">MSM</div>
          <div className="text-slate-400 text-xs tracking-widest uppercase">Management Daune</div>
        </div>
        <div className="bg-white rounded-2xl p-6 shadow-xl">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={16} className="text-slate-500"/>
            <span className="text-sm font-semibold text-slate-700">Acces restricționat</span>
          </div>
          <input type="password" value={pwd} onChange={e=>setPwd(e.target.value)}
            placeholder="Parolă" autoFocus
            className={`w-full border rounded-xl px-3 py-3 focus:outline-none focus:ring-2 transition-all ${err?"border-red-300 ring-red-200 bg-red-50":"border-slate-200 focus:ring-sky-300"}`}/>
          {err && <div className="text-red-500 text-xs mt-2">Parolă incorectă</div>}
          <button type="submit" className="w-full mt-4 py-3 rounded-xl text-white font-semibold" style={{background:"#0f172a"}}>
            Intră în aplicație
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── MAIN APP ────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed] = useState(() => localStorage.getItem("msm_auth") === "1");
  const [view, setView] = useState("dashboard");
  const [dosare, setDosare] = useState([]);
  const [settings, setSettings] = useState(mkSettings());
  const [selected, setSelected] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("info");
  const [reconEditing, setReconEditing] = useState(null);
  const [reconParentId, setReconParentId] = useState(null);

  useEffect(()=>{
    if (!authed) { setLoading(false); return; }
    (async()=>{
      try {
        const [dos, set] = await Promise.all([db.loadDosare(), db.loadSettings()]);
        setDosare(dos); setSettings(set);
      } catch(e) { console.error(e); setOffline(true); }
      setLoading(false);
    })();
    window.addEventListener("online",  ()=>setOffline(false));
    window.addEventListener("offline", ()=>setOffline(true));
  },[authed]);

  const saveDosar = async d => {
    d.updatedAt = new Date().toISOString();
    try {
      await db.saveDosar(d);
      setDosare(p => p.find(x=>x.id===d.id) ? p.map(x=>x.id===d.id?d:x) : [d,...p]);
      setSelected(d);
      return d;
    } catch(e) { alert("Eroare la salvare: "+e.message); throw e; }
  };

  const deleteDosar = async id => {
    if (!confirm("Ștergi definitiv dosarul?")) return;
    try {
      await db.deleteDosar(id);
      setDosare(p=>p.filter(d=>d.id!==id));
      setSelected(null); setView("dashboard");
    } catch(e) { alert("Eroare la ștergere: "+e.message); }
  };

  const saveSettings = async s => {
    try { await db.saveSettings(s); setSettings(s); }
    catch(e) { alert("Eroare la salvare setări: "+e.message); }
  };

  const logout = () => {
    localStorage.removeItem("msm_auth");
    setAuthed(false);
    setView("dashboard"); setSelected(null);
  };

  const openNew  = () => { setEditing(mkDosar()); setTab("info"); setView("form"); };
  const openEdit = d  => { setEditing({...d}); setTab("info"); setView("form"); };
  const openView = d  => { setSelected(d); setTab("info"); setView("detail"); };

  const filtered = dosare.filter(d=>{
    if (!search) return true;
    const q = search.toLowerCase();
    return [d.nrDosar,d.proprietar?.nume,d.masina?.nrInmatriculare,d.asigurator?.companie]
      .some(v=>v?.toLowerCase().includes(q));
  });

  if (!authed) return <LoginScreen onLogin={()=>setAuthed(true)}/>;

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{background:"#0f172a"}}>
      <Logo size={50}/>
      <div className="text-slate-400 text-sm">Se încarcă...</div>
    </div>
  );

  // RECONSTATARE WORKFLOW
  if (reconEditing && reconParentId) {
    const parentDosar = dosare.find(d=>d.id===reconParentId);
    return (
      <Shell view="recon" offline={offline} onBack={()=>{setReconEditing(null);setReconParentId(null);}} onLogout={logout} onSettings={()=>{setView("settings");setReconEditing(null);setReconParentId(null);}} onSearch={()=>{setSearch("");setView("list");setReconEditing(null);setReconParentId(null);}} onNew={openNew}>
        <ReconstatareWorkflow
          dosar={parentDosar}
          recon={reconEditing}
          settings={settings}
          onSave={async (reconUpdated) => {
            const exists = (parentDosar.reconstatari||[]).some(r => r.id === reconUpdated.id);
            const newRecons = exists
              ? parentDosar.reconstatari.map(r => r.id === reconUpdated.id ? reconUpdated : r)
              : [...(parentDosar.reconstatari||[]), reconUpdated];
            const newDosar = { ...parentDosar, reconstatari: newRecons, status: "reconstatare" };
            await saveDosar(newDosar);
            setReconEditing(null); setReconParentId(null);
          }}
          onCancel={()=>{setReconEditing(null);setReconParentId(null);}}
        />
      </Shell>
    );
  }

  return (
    <Shell view={view} offline={offline}
      onBack={view==="dashboard"?null:()=>setView(view==="form"?(selected?"detail":"dashboard"):"dashboard")}
      onLogout={logout}
      onSettings={()=>setView("settings")}
      onSearch={()=>{setSearch("");setView("list");}}
      onNew={openNew}>
      {view==="dashboard" && <Dashboard dosare={dosare} onView={openView} onCreate={openNew} onViewAll={()=>setView("list")} onRapoarte={()=>setView("rapoarte")}/>}
      {view==="rapoarte" && <RapoarteView dosare={dosare} onUpdate={saveDosar} onView={openView}/>}
      {view==="list" && <ListaView filtered={filtered} search={search} setSearch={setSearch} onView={openView}/>}
      {view==="settings" && <SettingsView settings={settings} onSave={saveSettings} onLogout={logout}/>}
      {view==="detail" && selected && (
        <DetailView dosar={selected} tab={tab} setTab={setTab} settings={settings}
          onEdit={()=>openEdit(selected)} onDelete={()=>deleteDosar(selected.id)} onUpdate={saveDosar}
          onAddRecon={()=>{ setReconEditing(mkReconstatare()); setReconParentId(selected.id); }}
          onEditRecon={(r)=>{ setReconEditing(r); setReconParentId(selected.id); }}/>
      )}
      {view==="form" && editing && (
        <FormView dosar={editing} tab={tab} setTab={setTab}
          onSave={async (d)=>{ await saveDosar(d); setView("detail"); }} onCancel={()=>setView(selected?"detail":"dashboard")}/>
      )}
    </Shell>
  );
}

// ─── SHELL (header + responsive layout) ─────────────────────────
function Shell({ view, children, offline, onBack, onLogout, onSettings, onSearch, onNew }) {
  return (
    <div className="min-h-screen" style={{background:"#f1f5f9",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <header style={{background:"#0f172a"}} className="sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {onBack && (
              <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300 flex-shrink-0">
                <ArrowLeft size={18}/>
              </button>
            )}
            <Logo size={34}/>
            <div className="min-w-0">
              <div className="font-bold text-white tracking-tight text-[15px] leading-tight">MSM</div>
              <div className="text-slate-400 text-[10px] leading-none tracking-wider uppercase">Management Daune</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {offline && <WifiOff size={14} className="text-amber-400"/>}
            <button onClick={onSearch} className="p-2 rounded-lg hover:bg-slate-700 text-slate-300" title="Caută">
              <Search size={16}/>
            </button>
            <button onClick={onSettings} className="p-2 rounded-lg hover:bg-slate-700 text-slate-300" title="Setări">
              <Settings size={16}/>
            </button>
            <button onClick={onNew} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
              style={{background:"#38bdf8",color:"#0f172a"}}>
              <Plus size={14}/> Nou
            </button>
          </div>
        </div>
      </header>
      {offline && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-xs text-amber-800 flex items-center justify-center gap-2">
          <WifiOff size={12}/> Mod offline
        </div>
      )}
      <main className="max-w-7xl mx-auto px-4 py-4 pb-10">{children}</main>
    </div>
  );
}

// ─── DASHBOARD ──────────────────────────────────────────────────
function Dashboard({ dosare, onView, onCreate, onViewAll, onRapoarte }) {
  const [period, setPeriod] = useState("1m");
  const stats = useMemo(()=>{
    const ps = getPeriodStart(period);
    const inp = dosare.filter(d=>new Date(d.updatedAt)>=ps);
    return {
      total: dosare.length,
      active: dosare.filter(d=>d.status!=="finalizat").length,
      fin: dosare.filter(d=>d.status==="finalizat").length,
      comisionTotal: inp.reduce((s,d)=>s+(d.financiar?.comision||0),0),
      comisionIncasat: inp.filter(d=>d.financiar?.comisionIncasat).reduce((s,d)=>s+(d.financiar?.comision||0),0),
    };
  },[dosare,period]);

  const recente = [...dosare].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,8);
  const groups = Object.entries(STATUS).map(([k,v])=>({k,v,n:dosare.filter(d=>d.status===k).length})).filter(g=>g.n>0);

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="Total dosare"  val={stats.total}  icon={<FileText size={18}/>}    accent="#38bdf8"/>
        <StatBox label="Dosare active" val={stats.active} icon={<Clock size={18}/>}       accent="#fb923c"/>
        <StatBox label="Finalizate"    val={stats.fin}    icon={<Check size={18}/>}       accent="#34d399"/>
        <button onClick={onRapoarte} className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100 text-left hover:shadow-md transition-shadow">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2" style={{background:"#a78bfa20",color:"#a78bfa"}}>
            <BarChart3 size={18}/>
          </div>
          <div className="text-xl font-bold text-slate-800 leading-tight">Rapoarte →</div>
          <div className="text-xs text-slate-400 mt-0.5">{stats.comisionTotal.toFixed(0)} lei comision</div>
        </button>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider">Comision total</div>
            <div className="text-lg font-bold text-slate-800">{stats.comisionTotal.toFixed(0)} lei</div>
          </div>
          <div>
            <div className="text-[10px] text-emerald-500 uppercase tracking-wider">Comision încasat</div>
            <div className="text-lg font-bold text-emerald-600">{stats.comisionIncasat.toFixed(0)} lei</div>
          </div>
        </div>
        <select value={period} onChange={e=>setPeriod(e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-300">
          {PERIOD_OPTS.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </Card>

      {groups.length>0 && (
        <Card>
          <ST>Status dosare</ST>
          <div className="space-y-2">
            {groups.map(({k,v,n})=>(
              <div key={k} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${v.dot}`}></span>
                  <span className="text-sm text-slate-600">{v.label}</span>
                </div>
                <span className="font-bold text-slate-800 text-sm">{n}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between mb-3">
          <ST>Dosare recente</ST>
          <button onClick={onViewAll} className="text-sky-600 text-sm font-medium">Vezi toate →</button>
        </div>
        {recente.length===0 ? (
          <div className="text-center py-8">
            <FileText size={36} className="mx-auto mb-3 text-slate-300"/>
            <p className="text-slate-400 text-sm mb-4">Niciun dosar creat încă</p>
            <button onClick={onCreate} className="px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{background:"#0f172a"}}>
              Creează primul dosar
            </button>
          </div>
        ) : (
          <div className="space-y-2">{recente.map(d=><DosarRow key={d.id} d={d} onClick={()=>onView(d)}/>)}</div>
        )}
      </Card>
    </div>
  );
}

function StatBox({ label, val, icon, accent, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2" style={{background:accent+"20",color:accent}}>{icon}</div>
      <div className="text-xl font-bold text-slate-800 leading-tight">{val}</div>
      <div className="text-xs text-slate-400 mt-0.5">{label}</div>
      {children}
    </div>
  );
}

function DosarRow({ d, onClick }) {
  const s = STATUS[d.status]||STATUS.constatare;
  const allPhotos = [
    ...(d.poze||[]),
    ...((d.reconstatari||[]).flatMap(r => r.poze||[]))
  ];
  const img = allPhotos.find(p=>p.type?.startsWith("image"));
  return (
    <button onClick={onClick}
      className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 border border-slate-100 transition-all group">
      <div className="w-12 h-12 rounded-lg flex-shrink-0 overflow-hidden bg-slate-100 flex items-center justify-center">
        {img ? <img src={img.url||img.data} alt="" className="w-full h-full object-cover"/> : <Car size={20} className="text-slate-300"/>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold text-slate-800 text-sm truncate">{d.nrDosar||"Fără număr"}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${s.bg} ${s.text} font-semibold`}>{s.label}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {d.masina?.nrInmatriculare && (
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-900 text-white font-bold tracking-wider">
              {d.masina.nrInmatriculare}
            </span>
          )}
          <span className="text-xs text-slate-400 truncate">
            {[d.proprietar?.nume,d.asigurator?.companie].filter(Boolean).join(" · ")}
          </span>
        </div>
      </div>
      <ChevronRight size={15} className="text-slate-300 flex-shrink-0 group-hover:text-slate-500"/>
    </button>
  );
}

// ─── RAPOARTE VIEW ──────────────────────────────────────────────
function RapoarteView({ dosare, onUpdate, onView }) {
  const [filter, setFilter] = useState("toate"); // toate / neachitate / comision_neincasat

  const data = useMemo(()=>{
    return dosare
      .filter(d => {
        if (filter==="neachitate") return !d.financiar?.achitat;
        if (filter==="comision_neincasat") return !d.financiar?.comisionIncasat && d.financiar?.comision > 0;
        return true;
      })
      .map(d => ({
        ...d,
        _calc: calcFin(d.financiar||{})
      }));
  }, [dosare, filter]);

  const totals = useMemo(()=>({
    facturat: data.reduce((s,d)=>s+Number(d.financiar?.sumaFacturata||0), 0),
    cheltuieli: data.reduce((s,d)=>s+(d._calc.totalCheltuieli||0), 0),
    diferenta: data.reduce((s,d)=>s+(d._calc.sumaRamasa||0), 0),
    comision: data.reduce((s,d)=>s+(d._calc.comision||0), 0),
    comisionIncasat: data.filter(d=>d.financiar?.comisionIncasat).reduce((s,d)=>s+(d._calc.comision||0), 0),
  }), [data]);

  const toggleAchitat = async (d) => {
    const newFin = { ...d.financiar, achitat: !d.financiar?.achitat };
    await onUpdate({ ...d, financiar: newFin });
  };

  const toggleComision = async (d) => {
    const newFin = {
      ...d.financiar,
      comisionIncasat: !d.financiar?.comisionIncasat,
      dataIncasareComision: !d.financiar?.comisionIncasat ? today() : ""
    };
    await onUpdate({ ...d, financiar: newFin });
  };

  const downloadExcel = () => {
    const rows = data.map(d => ({
      "Nr. dosar": d.nrDosar,
      "Asigurator": d.asigurator?.companie || "",
      "Data constatare": d.dataConstatare,
      "Nr. înmatriculare": d.masina?.nrInmatriculare || "",
      "Proprietar": d.proprietar?.nume || "",
      "Nr. factură": d.financiar?.nrFactura || "",
      "Suma factură (lei)": d.financiar?.sumaFacturata || 0,
      "Data factură": d.financiar?.dataFactura || "",
      "Scadența": d.financiar?.dataScadenta || "",
      "Cheltuieli (lei)": d._calc.totalCheltuieli || 0,
      "Diferență (lei)": d._calc.sumaRamasa || 0,
      "Comision 5% (lei)": (d._calc.comision || 0).toFixed(2),
      "Achitat": d.financiar?.achitat ? "Da" : "Nu",
      "Achitări": (d.financiar?.achitari||[]).map(a=>`${a.data}: ${a.suma}`).join("; "),
      "Comision încasat": d.financiar?.comisionIncasat ? "Da" : "Nu",
      "Data încasare comision": d.financiar?.dataIncasareComision || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rapoarte");
    XLSX.writeFile(wb, `rapoarte_msm_${today()}.xlsx`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <BarChart3 size={22} className="text-violet-500"/>
            <h2 className="font-bold text-slate-800 text-lg">Rapoarte</h2>
          </div>
          <button onClick={downloadExcel} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold text-white" style={{background:"#059669"}}>
            <Download size={14}/> Excel
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
          <TotalBox label="Facturat" val={totals.facturat} c="#0f172a" bg="#f8fafc"/>
          <TotalBox label="Cheltuieli" val={totals.cheltuieli} c="#ef4444" bg="#fef2f2"/>
          <TotalBox label="Diferență" val={totals.diferenta} c="#0284c7" bg="#f0f9ff"/>
          <TotalBox label="Comision total" val={totals.comision} c="#a78bfa" bg="#f5f3ff"/>
          <TotalBox label="Comision încasat" val={totals.comisionIncasat} c="#059669" bg="#f0fdf4"/>
        </div>

        <div className="flex gap-2 mt-4 flex-wrap">
          {[["toate","Toate"],["neachitate","Neachitate"],["comision_neincasat","Comision neîncasat"]].map(([k,l])=>(
            <button key={k} onClick={()=>setFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter===k?"text-white":"bg-slate-100 text-slate-600"}`}
              style={filter===k?{background:"#0f172a"}:{}}>{l}</button>
          ))}
        </div>
      </Card>

      {data.length === 0 ? (
        <Card>
          <div className="text-center py-10 text-slate-400">
            <FileText size={32} className="mx-auto mb-2"/>
            <p className="text-sm">Niciun dosar de afișat</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {data.map(d => <RaportRow key={d.id} d={d} onToggleAchitat={()=>toggleAchitat(d)} onToggleComision={()=>toggleComision(d)} onView={()=>onView(d)} onUpdate={onUpdate}/>)}
        </div>
      )}
    </div>
  );
}

function TotalBox({ label, val, c, bg }) {
  return (
    <div className="rounded-xl p-2.5 border border-slate-100" style={{background:bg}}>
      <div className="text-[10px] text-slate-400 uppercase tracking-wider truncate">{label}</div>
      <div className="text-sm font-bold" style={{color:c}}>{(val||0).toFixed(0)} lei</div>
    </div>
  );
}

function RaportRow({ d, onToggleAchitat, onToggleComision, onView, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const [newAchitare, setNewAchitare] = useState({ data: today(), suma: "" });

  const addAchitare = async () => {
    if (!newAchitare.suma) return;
    const achitari = [...(d.financiar?.achitari||[]), { ...newAchitare, id: Date.now().toString() }];
    const totalAchitat = achitari.reduce((s,a)=>s+Number(a.suma||0),0);
    const fullyPaid = totalAchitat >= Number(d.financiar?.sumaFacturata||0);
    await onUpdate({ ...d, financiar: { ...d.financiar, achitari, achitat: fullyPaid } });
    setNewAchitare({ data: today(), suma: "" });
  };

  const remAchitare = async (id) => {
    const achitari = (d.financiar?.achitari||[]).filter(a=>a.id!==id);
    const totalAchitat = achitari.reduce((s,a)=>s+Number(a.suma||0),0);
    const fullyPaid = totalAchitat >= Number(d.financiar?.sumaFacturata||0) && achitari.length>0;
    await onUpdate({ ...d, financiar: { ...d.financiar, achitari, achitat: fullyPaid } });
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
      <div className="p-3 flex items-center gap-3">
        <input type="checkbox" checked={!!d.financiar?.achitat} onChange={onToggleAchitat}
          className="w-5 h-5 accent-emerald-500 flex-shrink-0"/>
        <button onClick={onView} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-slate-800">{d.nrDosar}</span>
            {d.masina?.nrInmatriculare && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-white font-bold tracking-wider">{d.masina.nrInmatriculare}</span>
            )}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 truncate">
            {d.asigurator?.companie} · {d.proprietar?.nume}
          </div>
          <div className="flex gap-3 mt-1 text-xs flex-wrap">
            <span className="text-slate-600">F: <strong>{Number(d.financiar?.sumaFacturata||0).toFixed(0)} lei</strong></span>
            <span className="text-slate-600">C: <strong>{Number(d._calc.totalCheltuieli||0).toFixed(0)} lei</strong></span>
            <span className="text-emerald-600 font-semibold">5%: {(d._calc.comision||0).toFixed(2)} lei</span>
          </div>
        </button>
        <button onClick={()=>setExpanded(!expanded)} className="p-1.5 text-slate-400 flex-shrink-0">
          <ChevronDown size={16} className={`transition-transform ${expanded?"rotate-180":""}`}/>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-slate-100 p-3 space-y-3 bg-slate-50">
          {/* Factură */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-slate-400">Nr. factură:</span> <strong>{d.financiar?.nrFactura||"—"}</strong></div>
            <div><span className="text-slate-400">Data:</span> <strong>{fmtDate(d.financiar?.dataFactura)}</strong></div>
            <div><span className="text-slate-400">Scadență:</span> <strong>{fmtDate(d.financiar?.dataScadenta)}</strong></div>
            <div><span className="text-slate-400">Diferență:</span> <strong className="text-sky-600">{(d._calc.sumaRamasa||0).toFixed(0)} lei</strong></div>
          </div>

          {/* Achitări */}
          <div className="bg-white rounded-lg p-2.5 border border-slate-100">
            <div className="text-xs font-semibold text-slate-600 mb-2">Încasări factură</div>
            {(d.financiar?.achitari||[]).length > 0 && (
              <div className="space-y-1 mb-2">
                {d.financiar.achitari.map(a=>(
                  <div key={a.id} className="flex items-center gap-2 text-xs bg-emerald-50 rounded px-2 py-1">
                    <span>{fmtDate(a.data)}: <strong>{a.suma} lei</strong></span>
                    <button onClick={()=>remAchitare(a.id)} className="ml-auto text-red-400"><X size={11}/></button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-1">
              <input type="date" value={newAchitare.data} onChange={e=>setNewAchitare(p=>({...p,data:e.target.value}))}
                className="border border-slate-200 rounded px-2 py-1 text-xs flex-1"/>
              <input type="number" value={newAchitare.suma} onChange={e=>setNewAchitare(p=>({...p,suma:e.target.value}))}
                placeholder="lei" className="border border-slate-200 rounded px-2 py-1 text-xs w-20"/>
              <button onClick={addAchitare} className="px-2 py-1 rounded bg-emerald-500 text-white text-xs"><Plus size={12}/></button>
            </div>
          </div>

          {/* Comision */}
          <div className="bg-white rounded-lg p-2.5 border border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={!!d.financiar?.comisionIncasat} onChange={onToggleComision}
                className="w-4 h-4 accent-emerald-500"/>
              <span className="text-xs font-semibold text-slate-700">Comision încasat ({(d._calc.comision||0).toFixed(2)} lei)</span>
            </div>
            {d.financiar?.comisionIncasat && d.financiar?.dataIncasareComision && (
              <span className="text-xs text-emerald-600">{fmtDate(d.financiar.dataIncasareComision)}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LISTA ──────────────────────────────────────────────────────
function ListaView({ filtered, search, setSearch, onView }) {
  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Caută număr dosar, proprietar..."
          className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-sky-300 shadow-sm"/>
      </div>
      {filtered.length===0
        ? <div className="text-center py-12 text-slate-400"><Search size={32} className="mx-auto mb-2 opacity-30"/><p>Niciun dosar găsit</p></div>
        : filtered.map(d=><DosarRow key={d.id} d={d} onClick={()=>onView(d)}/>)
      }
    </div>
  );
}

// ─── SETTINGS ───────────────────────────────────────────────────
function SettingsView({ settings, onSave, onLogout }) {
  const [tab, setTab] = useState("emailjs");
  const [s, setS] = useState({...settings, emailjs:{...settings.emailjs}, asiguratorEmails:{...settings.asiguratorEmails}});
  const [saved, setSaved] = useState(false);

  const save = async () => { await onSave(s); setSaved(true); setTimeout(()=>setSaved(false),1500); };
  const updE = (k,v) => setS(p=>({...p,emailjs:{...p.emailjs,[k]:v}}));
  const updA = (a,f,v) => setS(p=>({...p,asiguratorEmails:{...p.asiguratorEmails,[a]:{...p.asiguratorEmails[a],[f]:v}}}));

  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1"><Settings size={20} className="text-slate-700"/>
              <h2 className="font-bold text-slate-800 text-lg">Setări</h2></div>
            <p className="text-xs text-slate-500">{COMPANY.agent} · {COMPANY.name}</p>
          </div>
          <button onClick={onLogout} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100">
            <LogOut size={12}/> Deconectare
          </button>
        </div>
      </Card>
      <div className="bg-white rounded-2xl shadow-sm p-1.5 border border-slate-100 flex gap-1">
        {[["emailjs","Email config"],["asiguratori","Asiguratori"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)}
            className={`flex-1 px-3 py-2 rounded-xl text-xs font-semibold transition-all ${tab===k?"text-white":"text-slate-500"}`}
            style={tab===k?{background:"#0f172a"}:{}}>{l}</button>
        ))}
      </div>

      {tab==="emailjs" && (
        <Card>
          <ST>Configurare EmailJS</ST>
          <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 mb-4 text-xs text-sky-800">
            <div className="font-semibold mb-2">📧 Pași:</div>
            <ol className="list-decimal list-inside space-y-1 text-sky-700">
              <li>Cont gratuit pe <strong>emailjs.com</strong></li>
              <li>Add Email Service → Gmail → conectează contul</li>
              <li>Create Template cu variabile: <code className="bg-white px-1 rounded">{`{{to_email}} {{subject}} {{message}} {{from_name}}`}</code></li>
              <li>Copiază Service ID, Template ID și Public Key aici</li>
            </ol>
          </div>
          <FF label="Service ID"      v={s.emailjs.serviceId}   set={v=>updE("serviceId",v)}   ph="service_xxxxxxx"/>
          <FF label="Template ID"     v={s.emailjs.templateId}  set={v=>updE("templateId",v)}  ph="template_xxxxxxx"/>
          <FF label="Public Key"      v={s.emailjs.publicKey}   set={v=>updE("publicKey",v)}   ph="aBcDeFgHiJkLmN"/>
          <FF label="Nume expeditor"  v={s.emailjs.fromName}    set={v=>updE("fromName",v)}    ph={COMPANY.agent}/>
          <FF label="Email expeditor" type="email" v={s.emailjs.fromEmail} set={v=>updE("fromEmail",v)} ph="contact@gmail.com"/>
        </Card>
      )}

      {tab==="asiguratori" && (
        <div className="space-y-2">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
            Adresele salvate aici se folosesc automat la trimiterea emailurilor.
          </div>
          {ASIGURATORI.map(a=>{
            const e = s.asiguratorEmails[a]||{};
            return (
              <details key={a} className="bg-white rounded-2xl shadow-sm border border-slate-100">
                <summary className="px-4 py-3 cursor-pointer flex items-center justify-between hover:bg-slate-50 rounded-2xl">
                  <span className="font-semibold text-slate-800 text-sm">{a}</span>
                  <div className="flex items-center gap-2">
                    {(e.reconstatare||e.despagubire||e.alte) && <Check size={14} className="text-emerald-500"/>}
                    <ChevronDown size={14} className="text-slate-400"/>
                  </div>
                </summary>
                <div className="px-4 pb-4 space-y-2 pt-2 border-t border-slate-100">
                  <FF label="Email reconstatare" type="email" v={e.reconstatare||""} set={v=>updA(a,"reconstatare",v)}/>
                  <FF label="Email cerere daună"  type="email" v={e.despagubire||""}  set={v=>updA(a,"despagubire",v)}/>
                  <FF label="Alte adrese"         type="email" v={e.alte||""}         set={v=>updA(a,"alte",v)}/>
                </div>
              </details>
            );
          })}
        </div>
      )}

      <button onClick={save} className="w-full py-3 rounded-2xl font-semibold text-white transition-all"
        style={{background:saved?"#10b981":"#0f172a"}}>
        {saved?"✓ Salvat":"Salvează setările"}
      </button>
    </div>
  );
}

// ─── DETAIL VIEW (two-column on desktop) ────────────────────────
function DetailView({ dosar, tab, setTab, settings, onEdit, onDelete, onUpdate, onAddRecon, onEditRecon }) {
  const s = STATUS[dosar.status]||STATUS.constatare;
  const TABS = [
    {id:"info",        label:"Info",        icon:<User size={13}/>},
    {id:"reconstatare",label:"Reconstatare",icon:<ListChecks size={13}/>},
    {id:"rent",        label:"Rent",        icon:<Car size={13}/>},
    {id:"despagubire", label:"Despăgubire", icon:<Mail size={13}/>},
    {id:"financiar",   label:"Financiar",   icon:<DollarSign size={13}/>},
  ];

  return (
    <div className="lg:grid lg:grid-cols-[1fr_2fr] lg:gap-4 lg:items-start max-w-6xl mx-auto">
      {/* Sidebar (desktop) / Card top (mobile) */}
      <div className="space-y-3 mb-3 lg:mb-0">
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-slate-800 text-xl truncate">{dosar.nrDosar||"Fără număr"}</h1>
              <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                {dosar.masina?.nrInmatriculare && (
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-900 text-white font-bold tracking-wider">{dosar.masina.nrInmatriculare}</span>
                )}
                <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-semibold ${s.bg} ${s.text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`}></span>{s.label}
                </span>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={onEdit} className="p-2 rounded-xl bg-sky-50 text-sky-600 hover:bg-sky-100"><Edit size={15}/></button>
              <button onClick={onDelete} className="p-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100"><Trash2 size={15}/></button>
            </div>
          </div>
        </Card>

        {/* Tabs */}
        <div className="bg-white rounded-2xl shadow-sm p-1.5 border border-slate-100 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all lg:w-full lg:justify-start ${tab===t.id?"text-white shadow-sm":"text-slate-500 hover:bg-slate-50"}`}
              style={tab===t.id?{background:"#0f172a"}:{}}>
              {t.icon}<span>{t.label}</span>
            </button>
          ))}
        </div>

        <button onClick={()=>downloadDosarZip(dosar)} className="hidden lg:flex w-full items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700 hover:bg-emerald-100">
          <Download size={14}/> Descarcă dosar (ZIP)
        </button>
      </div>

      {/* Content */}
      <div className="space-y-3 min-w-0">
        {tab==="info"         && <InfoTab dosar={dosar} onEditRecon={onEditRecon}/>}
        {tab==="reconstatare" && <ReconstatareList dosar={dosar} onAdd={onAddRecon} onEdit={onEditRecon} onUpdate={onUpdate}/>}
        {tab==="rent"         && <SchimbTab dosar={dosar} onUpdate={onUpdate}/>}
        {tab==="despagubire"  && <DespagubireTab dosar={dosar} settings={settings} onUpdate={onUpdate}/>}
        {tab==="financiar"    && <FinanciarTab dosar={dosar} onUpdate={onUpdate}/>}

        <button onClick={()=>downloadDosarZip(dosar)} className="lg:hidden w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium bg-emerald-50 text-emerald-700">
          <Download size={14}/> Descarcă dosar (ZIP)
        </button>
      </div>
    </div>
  );
}

// ─── DOWNLOAD ZIP ───────────────────────────────────────────────
async function downloadDosarZip(dosar) {
  try {
    const zip = new JSZip();
    const folder = zip.folder(`dosar_${dosar.nrDosar||dosar.id}`);

    // Info text
    let info = `MSM Management Daune\n${"=".repeat(40)}\n\n`;
    info += `Dosar: ${dosar.nrDosar}\nProprietar: ${dosar.proprietar?.nume}\n`;
    info += `Telefon: ${dosar.proprietar?.telefon}\nEmail: ${dosar.proprietar?.email}\n\n`;
    info += `Mașină: ${dosar.masina?.marca} ${dosar.masina?.model} (${dosar.masina?.an})\n`;
    info += `Înmatriculare: ${dosar.masina?.nrInmatriculare}\nVIN: ${dosar.masina?.vin}\n\n`;
    info += `Asigurator: ${dosar.asigurator?.companie}\nInspector: ${dosar.asigurator?.inspector}\n`;
    info += `Data eveniment: ${fmtDate(dosar.dataEveniment)}\nData constatare: ${fmtDate(dosar.dataConstatare)}\n`;
    folder.file("info.txt", info);

    // Poze dosar
    const fetchAndAdd = async (file, path) => {
      try {
        const r = await fetch(file.url || file.data);
        const blob = await r.blob();
        folder.file(path, blob);
      } catch(e) { console.error("Skip:", path); }
    };

    for (const p of (dosar.poze||[])) {
      await fetchAndAdd(p, `poze/${p.name||"poza.jpg"}`);
    }

    // Reconstatari
    for (let i=0; i<(dosar.reconstatari||[]).length; i++) {
      const r = dosar.reconstatari[i];
      const rFolder = folder.folder(`reconstatare_${i+1}_${r.data}`);
      let rInfo = `Reconstatare ${i+1}\nData: ${fmtDate(r.data)}\n\n`;
      rInfo += `Piese:\n`;
      (r.piese||[]).filter(p=>p.piesa?.trim()).forEach((p,j) => {
        const sol = p.solutie === "__custom__" ? p.solutieCustom : p.solutie;
        rInfo += `${j+1}. ${p.piesa} — ${sol||""}\n`;
      });
      if (r.observatii) rInfo += `\nObservații: ${r.observatii}\n`;
      if (r.emailExtra) rInfo += `\nText email: ${r.emailExtra}\n`;
      rFolder.file("detalii.txt", rInfo);

      for (const p of (r.poze||[])) {
        await fetchAndAdd(p, `reconstatare_${i+1}_${r.data}/poze/${p.name||"poza.jpg"}`);
      }
      for (const doc of (r.documente||[])) {
        await fetchAndAdd(doc, `reconstatare_${i+1}_${r.data}/documente/${doc.name||"doc"}`);
      }
    }

    // Despagubire
    if (dosar.despagubire?.documente?.length || dosar.despagubire?.emailSent) {
      const dFolder = folder.folder("despagubire");
      if (dosar.despagubire.emailExtra) dFolder.file("text_email.txt", dosar.despagubire.emailExtra);
      for (const doc of (dosar.despagubire.documente||[])) {
        await fetchAndAdd(doc, `despagubire/${doc.name||"doc"}`);
      }
    }

    const blob = await zip.generateAsync({type:"blob"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `dosar_${dosar.nrDosar||dosar.id}.zip`;
    a.click();
  } catch(e) {
    alert("Eroare la descărcare: "+e.message);
  }
}

// ─── INFO TAB (cu istoric etape) ───────────────────────────────
function InfoTab({ dosar, onEditRecon }) {
  const recons = dosar.reconstatari || [];
  return (
    <div className="space-y-3">
      <Sec title="Proprietar" icon={<User size={15}/>}>
        <IR l="Nume" v={dosar.proprietar?.nume}/><IR l="Telefon" v={dosar.proprietar?.telefon}/><IR l="Email" v={dosar.proprietar?.email}/>
      </Sec>
      <Sec title="Autovehicul" icon={<Car size={15}/>}>
        <IR l="Marcă / Model" v={`${dosar.masina?.marca||""} ${dosar.masina?.model||""}`.trim()}/>
        <IR l="An" v={dosar.masina?.an}/><IR l="Nr. înmatriculare" v={dosar.masina?.nrInmatriculare}/><IR l="VIN" v={dosar.masina?.vin}/>
      </Sec>
      <Sec title="Asigurator" icon={<Building size={15}/>}>
        <IR l="Companie" v={dosar.asigurator?.companie}/><IR l="Inspector" v={dosar.asigurator?.inspector}/><IR l="Contact" v={dosar.asigurator?.contact}/>
      </Sec>
      <Sec title="Date eveniment" icon={<Calendar size={15}/>}>
        <IR l="Data eveniment" v={fmtDate(dosar.dataEveniment)}/>
        <IR l="Data constatare" v={fmtDate(dosar.dataConstatare)}/>
      </Sec>

      <Sec title="Istoric etape" icon={<Clock size={15}/>}>
        <div className="relative">
          <div className="absolute left-[7px] top-0 bottom-0 w-px bg-slate-100"></div>
          <div className="space-y-3">
            {/* Constatare inițială */}
            <div className="flex gap-3 items-start">
              <span className="w-3.5 h-3.5 rounded-full bg-sky-500 flex-shrink-0 mt-0.5 border-2 border-white shadow-sm z-10 relative"></span>
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-sm text-slate-800">Constatare inițială</span>
                <div className="text-xs text-slate-400">{fmtDate(dosar.dataConstatare)}</div>
              </div>
            </div>

            {/* Reconstatări */}
            {recons.map((r,i) => (
              <button key={r.id} onClick={()=>onEditRecon(r)} className="w-full flex gap-3 items-start text-left hover:bg-slate-50 rounded-lg p-1 -m-1 transition-colors">
                <span className="w-3.5 h-3.5 rounded-full bg-amber-400 flex-shrink-0 mt-0.5 border-2 border-white shadow-sm z-10 relative"></span>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm text-sky-700 hover:text-sky-900">Reconstatare {i+1} →</span>
                  <div className="text-xs text-slate-400">{fmtDate(r.data)}</div>
                  <div className="flex gap-3 mt-1 text-[10px] text-slate-500 flex-wrap">
                    {(r.poze?.length||0)>0 && <span className="flex items-center gap-1"><Camera size={10}/>{r.poze.length}</span>}
                    {(r.documente?.length||0)>0 && <span className="flex items-center gap-1"><Paperclip size={10}/>{r.documente.length}</span>}
                    {(r.piese||[]).filter(p=>p.piesa?.trim()).length > 0 && <span className="flex items-center gap-1"><Package size={10}/>{(r.piese||[]).filter(p=>p.piesa?.trim()).length} piese</span>}
                    {r.emailSent && <span className="text-emerald-600 flex items-center gap-1"><Check size={10}/>mail trimis</span>}
                  </div>
                </div>
              </button>
            ))}

            {/* Despagubire */}
            {dosar.despagubire?.emailSent && (
              <div className="flex gap-3 items-start">
                <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 flex-shrink-0 mt-0.5 border-2 border-white shadow-sm z-10 relative"></span>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-sm text-emerald-700">Despăgubire trimisă</span>
                  <div className="text-xs text-slate-400">{fmtDate(dosar.despagubire.emailSentAt)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </Sec>

      {dosar.note && <Sec title="Note" icon={<FileText size={15}/>}><p className="text-sm text-slate-700 whitespace-pre-line">{dosar.note}</p></Sec>}
    </div>
  );
}

function Sec({ title, icon, children }) {
  return (
    <Card>
      <div className="flex items-center gap-2 mb-3 text-slate-600">{icon}<span className="font-semibold text-xs uppercase tracking-wider">{title}</span></div>
      <div className="space-y-2">{children}</div>
    </Card>
  );
}

function IR({ l, v }) {
  if (!v||v==="—"||(typeof v==="string"&&v.trim()==="")) return null;
  return (
    <div className="flex justify-between items-baseline gap-4 text-sm">
      <span className="text-slate-400 flex-shrink-0">{l}</span>
      <span className="text-slate-800 font-medium text-right break-all">{v}</span>
    </div>
  );
}

// ─── RECONSTATARE LIST ─────────────────────────────────────────
function ReconstatareList({ dosar, onAdd, onEdit, onUpdate }) {
  const recons = dosar.reconstatari || [];

  const del = async (id) => {
    if (!confirm("Ștergi reconstatarea?")) return;
    // Delete files from storage
    const r = recons.find(x=>x.id===id);
    if (r) {
      await Promise.all([...(r.poze||[]), ...(r.documente||[])].map(f => deleteFile(f.path)));
    }
    await onUpdate({ ...dosar, reconstatari: recons.filter(r=>r.id!==id) });
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <ST>Reconstatări ({recons.length})</ST>
        <button onClick={onAdd} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold text-white" style={{background:"#0f172a"}}>
          <Plus size={14}/> Adaugă reconstatare
        </button>
      </div>

      {recons.length === 0 ? (
        <div className="text-center py-8">
          <ListChecks size={36} className="mx-auto mb-3 text-slate-300"/>
          <p className="text-slate-400 text-sm">Nicio reconstatare adăugată</p>
        </div>
      ) : (
        <div className="space-y-2">
          {recons.map((r,i) => (
            <div key={r.id} className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <div className="flex items-start justify-between gap-2">
                <button onClick={()=>onEdit(r)} className="flex-1 text-left min-w-0">
                  <div className="font-semibold text-sm text-slate-800">Reconstatare {i+1}</div>
                  <div className="text-xs text-slate-500">{fmtDate(r.data)}</div>
                  <div className="flex gap-3 mt-2 text-[11px] text-slate-500 flex-wrap">
                    {(r.poze?.length||0)>0 && <span className="flex items-center gap-1"><Camera size={11}/>{r.poze.length} poze</span>}
                    {(r.documente?.length||0)>0 && <span className="flex items-center gap-1"><Paperclip size={11}/>{r.documente.length} doc</span>}
                    {(r.piese||[]).filter(p=>p.piesa?.trim()).length > 0 && <span className="flex items-center gap-1"><Package size={11}/>{(r.piese||[]).filter(p=>p.piesa?.trim()).length} piese</span>}
                    {r.emailSent && <span className="text-emerald-600 flex items-center gap-1"><Check size={11}/>trimis</span>}
                  </div>
                </button>
                <button onClick={()=>del(r.id)} className="p-1.5 rounded-lg bg-red-50 text-red-500 flex-shrink-0">
                  <Trash2 size={13}/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── RECONSTATARE WORKFLOW ─────────────────────────────────────
function ReconstatareWorkflow({ dosar, recon, settings, onSave, onCancel }) {
  const [e, setE] = useState({ ...recon });
  const [emailStatus, setEmailStatus] = useState(null);
  const [emailErr, setEmailErr] = useState("");
  const [uploadingPoze, setUploadingPoze] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const pozeRef = useRef();
  const docRef = useRef();

  const companie = dosar.asigurator?.companie;
  const recipient = getAsigEmail(settings, companie, "reconstatare");
  const { subject, body } = useMemo(() => buildReconstatareEmail(dosar, e, e.emailExtra), [dosar, e]);
  const ejsOk = settings.emailjs?.serviceId && settings.emailjs?.templateId && settings.emailjs?.publicKey;

  const addPiesa = () => setE(p => ({ ...p, piese: [...p.piese, { id: Date.now().toString() + Math.random(), piesa: "", solutie: "INL", solutieCustom: "" }] }));
  const updPiesa = (idx, field, val) => setE(p => ({ ...p, piese: p.piese.map((it,i) => i===idx ? { ...it, [field]: val } : it) }));
  const delPiesa = idx => setE(p => ({ ...p, piese: p.piese.filter((_,i) => i!==idx) }));

  const addPoze = async (ev) => {
    const files = Array.from(ev.target.files);
    setUploadingPoze(true);
    try {
      const uploaded = await Promise.all(files.map(f => uploadFile(dosar.id, `recon_${e.id}/poze`, f)));
      setE(p => ({ ...p, poze: [...(p.poze||[]), ...uploaded] }));
    } catch(err) { alert("Eroare la upload: "+err.message); }
    setUploadingPoze(false);
    ev.target.value = "";
  };

  const delPoza = async (poza) => {
    await deleteFile(poza.path);
    setE(p => ({ ...p, poze: p.poze.filter(x => x.path !== poza.path) }));
  };

  const addDocs = async (ev) => {
    const files = Array.from(ev.target.files);
    setUploadingDoc(true);
    try {
      const uploaded = await Promise.all(files.map(f => uploadFile(dosar.id, `recon_${e.id}/docs`, f)));
      setE(p => ({ ...p, documente: [...(p.documente||[]), ...uploaded] }));
    } catch(err) { alert("Eroare la upload: "+err.message); }
    setUploadingDoc(false);
    ev.target.value = "";
  };

  const delDoc = async (doc) => {
    await deleteFile(doc.path);
    setE(p => ({ ...p, documente: p.documente.filter(x => x.path !== doc.path) }));
  };

  const sendNow = async () => {
    if (!recipient) { setEmailStatus("error"); setEmailErr(`Adresa de reconstatare nu este salvată pentru ${companie||"acest asigurator"}.`); return; }
    setEmailStatus("sending"); setEmailErr("");
    try {
      await sendEmail(settings.emailjs, {
        to_email: recipient, subject, message: body,
        from_name: settings.emailjs?.fromName || COMPANY.agent,
        from_email: settings.emailjs?.fromEmail || ""
      });
      setEmailStatus("sent");
      setE(p => ({ ...p, emailSent: true, emailSentAt: new Date().toISOString() }));
      setTimeout(()=>setEmailStatus(null), 3000);
    } catch(err) { setEmailStatus("error"); setEmailErr(err.message); }
  };

  const mailto = () => {
    if (!recipient) { setEmailStatus("error"); setEmailErr(`Adresa lipsește.`); return; }
    window.open(`mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  return (
    <div className="space-y-3 max-w-3xl mx-auto">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-amber-600 font-semibold uppercase tracking-wider">Reconstatare</div>
            <h2 className="font-bold text-slate-800 text-lg">Dosar {dosar.nrDosar}</h2>
            <div className="flex items-center gap-2 mt-1">
              {dosar.masina?.nrInmatriculare && <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-900 text-white font-bold tracking-wider">{dosar.masina.nrInmatriculare}</span>}
              <span className="text-xs text-slate-500">{dosar.masina?.marca} {dosar.masina?.model}</span>
            </div>
          </div>
          <button onClick={onCancel} className="p-2 rounded-xl bg-slate-100 text-slate-500"><X size={16}/></button>
        </div>
      </Card>

      <Card>
        <ST>1. Data & observații</ST>
        <FF label="Data reconstatării" type="date" v={e.data} set={v=>setE(p=>({...p,data:v}))}/>
        <div>
          <label className="text-xs text-slate-500 mb-1.5 block font-medium">Observații</label>
          <textarea value={e.observatii||""} onChange={ev=>setE(p=>({...p,observatii:ev.target.value}))}
            rows={2} placeholder="Note interne..."
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none"/>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <ST>2. Poze</ST>
          <button onClick={()=>pozeRef.current.click()} disabled={uploadingPoze} className="flex items-center gap-1 text-sky-600 text-sm font-medium disabled:opacity-50">
            <Camera size={15}/> {uploadingPoze?"Se urcă...":"Adaugă"}
          </button>
        </div>
        <input ref={pozeRef} type="file" multiple accept="image/*" className="hidden" onChange={addPoze}/>
        {(e.poze||[]).length===0 ? (
          <button onClick={()=>pozeRef.current.click()} disabled={uploadingPoze}
            className="w-full py-6 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-sm hover:bg-slate-50 disabled:opacity-50">
            <Camera size={24} className="mx-auto mb-1"/> {uploadingPoze?"Se urcă pozele...":"Apasă pentru a adăuga poze"}
          </button>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {e.poze.map((p) => (
              <div key={p.path||p.url} className="relative aspect-square rounded-lg overflow-hidden border border-slate-100 group">
                <img src={p.url||p.data} alt={p.name} className="w-full h-full object-cover"/>
                <button onClick={()=>delPoza(p)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md">
                  <X size={11}/>
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <ST>3. Listă piese</ST>
          <button onClick={addPiesa} className="flex items-center gap-1 text-sky-600 text-sm font-medium">
            <Plus size={15}/> Rând
          </button>
        </div>
        <div className="space-y-1.5">
          <div className="flex gap-2 px-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            <div className="flex-1">Piesă</div>
            <div className="w-24">Soluție</div>
            <div className="w-6"></div>
          </div>
          {e.piese.map((p, idx) => (
            <div key={p.id} className="flex gap-2 items-start">
              <UpperInput
                value={p.piesa}
                onChange={v => updPiesa(idx,"piesa",v)}
                placeholder={`Piesa ${idx+1}`}
                className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-300"
              />
              <div className="w-24 flex-shrink-0">
                <select value={p.solutie} onChange={ev=>updPiesa(idx,"solutie",ev.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white">
                  {SOLUTII.map(s => <option key={s} value={s}>{s}</option>)}
                  <option value="__custom__">Scrie...</option>
                </select>
                {p.solutie === "__custom__" && (
                  <UpperInput
                    value={p.solutieCustom||""}
                    onChange={v=>updPiesa(idx,"solutieCustom",v)}
                    placeholder="..."
                    className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-300"
                  />
                )}
              </div>
              <button onClick={()=>delPiesa(idx)} className="p-2 text-slate-300 hover:text-red-400 flex-shrink-0">
                <X size={13}/>
              </button>
            </div>
          ))}
        </div>
        <button onClick={addPiesa} className="w-full mt-3 py-2 border border-dashed border-slate-200 rounded-lg text-xs text-slate-500 hover:bg-slate-50">
          + Adaugă încă un rând
        </button>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <ST>4. Documente atașate</ST>
          <button onClick={()=>docRef.current.click()} disabled={uploadingDoc} className="flex items-center gap-1 text-sky-600 text-sm font-medium disabled:opacity-50">
            <Paperclip size={15}/> {uploadingDoc?"Se urcă...":"Atașează"}
          </button>
        </div>
        <input ref={docRef} type="file" multiple className="hidden" onChange={addDocs}/>
        {(e.documente||[]).length===0 ? (
          <div className="text-center py-4 text-slate-400 text-xs">Niciun document atașat</div>
        ) : (
          <div className="space-y-1.5">
            {e.documente.map((d) => (
              <div key={d.path} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                <FileText size={14} className="text-slate-400 flex-shrink-0"/>
                <a href={d.url} target="_blank" rel="noreferrer" className="flex-1 text-sm text-slate-700 truncate hover:text-sky-600">{d.name}</a>
                <button onClick={()=>delDoc(d)} className="text-red-400"><X size={13}/></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <ST>5. Email reconstatare</ST>
        {!companie && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
            <span>Selectează asiguratorul în dosar.</span>
          </div>
        )}
        {recipient && (
          <div className="bg-sky-50 rounded-xl p-2.5 mb-3 text-xs">
            <span className="text-slate-500">Către: </span><span className="text-slate-700 font-medium">{recipient}</span>
          </div>
        )}
        <div className="bg-slate-50 rounded-xl p-3 mb-3 border border-slate-100">
          <div className="text-xs text-slate-400 mb-1">Subiect</div>
          <div className="text-sm font-medium text-slate-700 mb-3">{subject}</div>
          <div className="text-xs text-slate-400 mb-1 border-t border-slate-200 pt-2">Mesaj</div>
          <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
        </div>
        <div className="mb-3">
          <label className="text-xs text-slate-500 mb-1.5 block font-medium">Text suplimentar (opțional)</label>
          <textarea value={e.emailExtra} onChange={ev=>setE(p=>({...p,emailExtra:ev.target.value}))}
            rows={3} placeholder="Ex: justificare zile închiriere..."
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none text-sm"/>
        </div>
        {emailStatus==="error" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/><span>{emailErr}</span>
          </div>
        )}
        {emailStatus==="sent" && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 text-xs text-emerald-700 flex items-center gap-2">
            <Check size={14}/> Email trimis cu succes!
          </div>
        )}
        {e.emailSent && emailStatus !== "sent" && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 mb-3 text-xs text-emerald-700 flex items-center gap-2">
            <Check size={14}/> Mail trimis la {fmtDate(e.emailSentAt)}
          </div>
        )}
        <div className="space-y-2">
          {ejsOk ? (
            <button onClick={sendNow} disabled={emailStatus==="sending"}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{background:"#0f172a"}}>
              <Send size={14}/>{emailStatus==="sending"?"Se trimite...":"Trimite mail"}
            </button>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-700 text-center">
              Configurează EmailJS în Setări
            </div>
          )}
          <button onClick={mailto} className="w-full py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white text-slate-600">
            Deschide în app Mail (fallback)
          </button>
        </div>
      </Card>

      <div className="flex gap-3 sticky bottom-2">
        <button onClick={onCancel} className="flex-1 py-3 rounded-2xl text-slate-600 font-semibold border border-slate-200 bg-white shadow-sm">Anulează</button>
        <button onClick={()=>onSave(e)} className="flex-1 py-3 rounded-2xl text-white font-semibold shadow-sm" style={{background:"#0f172a"}}>
          Salvează
        </button>
      </div>
    </div>
  );
}

// ─── DESPAGUBIRE TAB ───────────────────────────────────────────
function DespagubireTab({ dosar, settings, onUpdate }) {
  const [extra, setExtra] = useState(dosar.despagubire?.emailExtra || "");
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const docRef = useRef();

  const companie = dosar.asigurator?.companie;
  const recipient = getAsigEmail(settings, companie, "despagubire");
  const { subject, body } = useMemo(()=>buildDespagubireEmail(dosar, extra), [dosar, extra]);
  const ejsOk = settings.emailjs?.serviceId && settings.emailjs?.templateId && settings.emailjs?.publicKey;
  const sent = dosar.despagubire?.emailSent;
  const docs = dosar.despagubire?.documente || [];

  const addDocs = async (ev) => {
    const files = Array.from(ev.target.files);
    setUploading(true);
    try {
      const uploaded = await Promise.all(files.map(f => uploadFile(dosar.id, "despagubire", f)));
      await onUpdate({ ...dosar, despagubire: { ...dosar.despagubire, documente: [...docs, ...uploaded] } });
    } catch(err) { alert("Eroare la upload: "+err.message); }
    setUploading(false);
    ev.target.value = "";
  };

  const delDoc = async (doc) => {
    await deleteFile(doc.path);
    await onUpdate({ ...dosar, despagubire: { ...dosar.despagubire, documente: docs.filter(x=>x.path!==doc.path) } });
  };

  const send = async () => {
    if (!recipient) { setStatus("error"); setErr(`Adresa lipsește pentru ${companie}.`); return; }
    setStatus("sending"); setErr("");
    try {
      await sendEmail(settings.emailjs, {
        to_email: recipient, subject, message: body,
        from_name: settings.emailjs?.fromName || COMPANY.agent,
        from_email: settings.emailjs?.fromEmail || ""
      });
      setStatus("sent");
      await onUpdate({ ...dosar, despagubire: { ...dosar.despagubire, emailExtra: extra, emailSent: true, emailSentAt: new Date().toISOString() }, status: "finalizat" });
      setTimeout(()=>setStatus(null), 3000);
    } catch(e) { setStatus("error"); setErr(e.message); }
  };

  const mailto = () => {
    if (!recipient) { setStatus("error"); setErr(`Adresa lipsește.`); return; }
    window.open(`mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  const saveExtra = () => onUpdate({ ...dosar, despagubire: { ...dosar.despagubire, emailExtra: extra } });

  return (
    <div className="space-y-3">
      <Card>
        <ST>Cerere despăgubire</ST>
        {!companie && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
            <span>Selectează asiguratorul.</span>
          </div>
        )}
        {recipient && (
          <div className="bg-sky-50 rounded-xl p-2.5 mb-3 text-xs">
            <span className="text-slate-500">Către: </span><span className="text-slate-700 font-medium">{recipient}</span>
          </div>
        )}
        <div className="bg-slate-50 rounded-xl p-3 mb-3 border border-slate-100">
          <div className="text-xs text-slate-400 mb-1">Subiect</div>
          <div className="text-sm font-medium text-slate-700 mb-3">{subject}</div>
          <div className="text-xs text-slate-400 mb-1 border-t border-slate-200 pt-2">Mesaj</div>
          <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
        </div>
        <div className="mb-3">
          <label className="text-xs text-slate-500 mb-1.5 block font-medium">Text suplimentar</label>
          <textarea value={extra} onChange={e=>setExtra(e.target.value)} onBlur={saveExtra}
            rows={3} placeholder="Ex: justificare zile închiriere..."
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none text-sm"/>
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <ST>Documente atașate</ST>
          <button onClick={()=>docRef.current.click()} disabled={uploading} className="flex items-center gap-1 text-sky-600 text-sm font-medium disabled:opacity-50">
            <Paperclip size={15}/> {uploading?"Se urcă...":"Atașează"}
          </button>
        </div>
        <input ref={docRef} type="file" multiple className="hidden" onChange={addDocs}/>
        {docs.length===0 ? (
          <div className="text-center py-4 text-slate-400 text-xs">Niciun document atașat</div>
        ) : (
          <div className="space-y-1.5">
            {docs.map((d) => (
              <div key={d.path} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                <FileText size={14} className="text-slate-400 flex-shrink-0"/>
                <a href={d.url} target="_blank" rel="noreferrer" className="flex-1 text-sm text-slate-700 truncate hover:text-sky-600">{d.name}</a>
                <button onClick={()=>delDoc(d)} className="text-red-400"><X size={13}/></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        {status==="error" && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 text-xs text-red-700 flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/><span>{err}</span>
          </div>
        )}
        {status==="sent" && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 text-xs text-emerald-700 flex items-center gap-2">
            <Check size={14}/> Email trimis! Dosarul a fost mutat în Finalizate.
          </div>
        )}
        {sent && status !== "sent" && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 mb-3 text-xs text-emerald-700 flex items-center gap-2">
            <Check size={14}/> Mail trimis la {fmtDate(dosar.despagubire.emailSentAt)}
          </div>
        )}
        <div className="space-y-2">
          {ejsOk ? (
            <button onClick={send} disabled={status==="sending"}
              className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              style={{background:"#0f172a"}}>
              <Send size={14}/>{status==="sending"?"Se trimite...":"Trimite cererea de despăgubire"}
            </button>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-xs text-amber-700 text-center">
              Configurează EmailJS în Setări
            </div>
          )}
          <button onClick={mailto} className="w-full py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white text-slate-600">
            Deschide în app Mail (fallback)
          </button>
        </div>
      </Card>
    </div>
  );
}

// ─── FINANCIAR TAB ─────────────────────────────────────────────
function FinanciarTab({ dosar, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [fin, setFin] = useState({...dosar.financiar,cheltuieli:[...(dosar.financiar?.cheltuieli||[])]});
  const [ch, setCh] = useState({descriere:"",suma:""});

  const addCh = () => {
    if (!ch.descriere||!ch.suma) return;
    setFin(f=>({...f,cheltuieli:[...f.cheltuieli,{...ch,id:Date.now().toString()}]}));
    setCh({descriere:"",suma:""});
  };
  const remCh = id => setFin(f=>({...f,cheltuieli:f.cheltuieli.filter(c=>c.id!==id)}));
  const save  = async () => { await onUpdate({...dosar,financiar:calcFin(fin)}); setEditing(false); };
  const prev  = calcFin(fin);
  const saved = dosar.financiar;

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <ST>Financiar</ST>
        <button onClick={()=>{setFin({...dosar.financiar,cheltuieli:[...(dosar.financiar?.cheltuieli||[])]});setEditing(!editing);}}
          className="flex items-center gap-1 text-sky-600 text-sm font-medium"><Edit size={14}/>{editing?"Anulează":"Editează"}</button>
      </div>

      {editing ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <FF label="Nr. factură" v={fin.nrFactura} set={v=>setFin(f=>({...f,nrFactura:v}))}/>
            <FF label="Suma factură (lei)" type="number" v={fin.sumaFacturata} set={v=>setFin(f=>({...f,sumaFacturata:v}))}/>
            <FF label="Data factură" type="date" v={fin.dataFactura} set={v=>setFin(f=>({...f,dataFactura:v}))}/>
            <FF label="Data scadenței" type="date" v={fin.dataScadenta} set={v=>setFin(f=>({...f,dataScadenta:v}))}/>
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1.5 block font-medium">Cheltuieli</label>
            <div className="space-y-1.5 mb-2">
              {fin.cheltuieli.map((c,i)=>(
                <div key={c.id||i} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                  <span className="flex-1 text-sm">{c.descriere}</span>
                  <span className="text-sm font-medium">{c.suma} lei</span>
                  <button onClick={()=>remCh(c.id)}><X size={13} className="text-red-400"/></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={ch.descriere} onChange={e=>setCh(p=>({...p,descriere:e.target.value}))} placeholder="Descriere"
                className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-sky-300"/>
              <input value={ch.suma} onChange={e=>setCh(p=>({...p,suma:e.target.value}))} type="number" placeholder="lei"
                className="w-20 border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-sky-300"/>
              <button onClick={addCh} className="px-3 py-2 rounded-lg bg-sky-50 text-sky-600"><Plus size={15}/></button>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 text-sm border border-slate-100">
            <div className="flex justify-between"><span className="text-slate-500">Sumă facturată</span><span>{prev.sumaFacturata} lei</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Cheltuieli</span><span className="text-red-500">- {prev.totalCheltuieli} lei</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold"><span>Diferență</span><span>{prev.sumaRamasa} lei</span></div>
            <div className="flex justify-between font-bold text-emerald-600"><span>Comision 5%</span><span>{prev.comision.toFixed(2)} lei</span></div>
          </div>
          <button onClick={save} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"#0f172a"}}>Salvează</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FBox l="Nr. factură" v={saved?.nrFactura||"—"} c="#0f172a" bg="#f8fafc"/>
            <FBox l="Suma factură" v={`${saved?.sumaFacturata||0} lei`} c="#0f172a" bg="#f8fafc"/>
            <FBox l="Data factură" v={fmtDate(saved?.dataFactura)} c="#0f172a" bg="#f8fafc"/>
            <FBox l="Scadența" v={fmtDate(saved?.dataScadenta)} c="#d97706" bg="#fffbeb"/>
            <FBox l="Cheltuieli" v={`${saved?.totalCheltuieli||0} lei`} c="#ef4444" bg="#fef2f2"/>
            <FBox l="Diferență" v={`${saved?.sumaRamasa||0} lei`} c="#0284c7" bg="#f0f9ff"/>
            <FBox l="Comision 5%" v={`${(saved?.comision||0).toFixed(2)} lei`} c="#059669" bg="#f0fdf4"/>
            <FBox l="Status" v={saved?.achitat?"Achitată":"Neachitată"} c={saved?.achitat?"#059669":"#d97706"} bg={saved?.achitat?"#f0fdf4":"#fffbeb"}/>
          </div>
          {(saved?.cheltuieli||[]).length>0 && (
            <div className="border-t border-slate-100 pt-3">
              <div className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-2">Detaliu cheltuieli</div>
              {saved.cheltuieli.map((c,i)=>(
                <div key={i} className="flex justify-between text-sm py-1.5 border-b border-slate-50">
                  <span className="text-slate-600">{c.descriere}</span><span className="font-medium">{c.suma} lei</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function FBox({ l, v, c, bg }) {
  return (
    <div className="rounded-xl p-3 border border-slate-100" style={{background:bg}}>
      <div className="text-xs text-slate-400 mb-0.5">{l}</div>
      <div className="text-base font-bold" style={{color:c}}>{v}</div>
    </div>
  );
}

// ─── SCHIMB / RENT TAB ─────────────────────────────────────────
function SchimbTab({ dosar, onUpdate }) {
  const [editing, setEditing] = useState(false);
  const [s, setS] = useState({...dosar.masinaSchimb});
  const zile = calcZile(s, dosar);
  const start = getSchimbStart(s, dosar);

  const save = async () => {
    await onUpdate({...dosar,masinaSchimb:{...s,zileFacturabile:zile,totalFacturabil:zile*Number(s.tarifZi||0)}});
    setEditing(false);
  };

  const saved = dosar.masinaSchimb;
  const savedStart = getSchimbStart(saved, dosar);
  const savedLbl = START_DATE_OPTS.find(o=>o.key===saved.startDateType)?.label||"Data constatare";

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <ST>Mașină la schimb (Rent)</ST>
        <button onClick={()=>{setS({...dosar.masinaSchimb});setEditing(!editing);}}
          className="flex items-center gap-1 text-sky-600 text-sm font-medium"><Edit size={14}/>{editing?"Anulează":"Editează"}</button>
      </div>
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 mb-2 block font-medium">Data start</label>
            <div className="space-y-1.5">
              {START_DATE_OPTS.map(opt=>(
                <label key={opt.key} className="flex items-center gap-2 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                  <input type="radio" name="st" checked={s.startDateType===opt.key}
                    onChange={()=>setS(p=>({...p,startDateType:opt.key}))} className="accent-sky-500"/>
                  <span className="text-sm text-slate-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          {s.startDateType==="avizare"      && <FF label="Data avizare" type="date" v={s.dataAvizare} set={v=>setS(p=>({...p,dataAvizare:v}))}/>}
          {s.startDateType==="raportTotala" && <FF label="Data primire raport daună totală" type="date" v={s.dataRaportTotala} set={v=>setS(p=>({...p,dataRaportTotala:v}))}/>}
          {s.startDateType==="comandaPiesa" && <FF label="Data comandă piesă" type="date" v={s.dataComandaPiesa} set={v=>setS(p=>({...p,dataComandaPiesa:v}))}/>}
          {s.startDateType==="primirePiese" && <FF label="Data primire piese" type="date" v={s.dataPrimirePiese} set={v=>setS(p=>({...p,dataPrimirePiese:v}))}/>}
          {s.startDateType==="custom"       && <FF label="Dată personalizată" type="date" v={s.customStartDate} set={v=>setS(p=>({...p,customStartDate:v}))}/>}
          <div className="border-t border-slate-100 pt-3">
            <FF label="Data predare mașină schimb" type="date" v={s.dataPredareMasinaSchimb} set={v=>setS(p=>({...p,dataPredareMasinaSchimb:v}))}/>
            <FF label="Tarif / zi (lei)" type="number" v={s.tarifZi} set={v=>setS(p=>({...p,tarifZi:v}))}/>
          </div>
          {start && s.dataPredareMasinaSchimb && (
            <div className="bg-sky-50 rounded-xl p-3 border border-sky-100">
              <div className="text-xs text-sky-600">Start: {fmtDate(start)} → Predare: {fmtDate(s.dataPredareMasinaSchimb)}</div>
              <div className="text-sm font-bold text-sky-700">Zile calculate: {zile}</div>
              <div className="text-sm text-sky-600">Total: {zile*Number(s.tarifZi||0)} lei</div>
            </div>
          )}
          <button onClick={save} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"#0f172a"}}>Salvează</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
            <div className="text-xs text-slate-400">Start facturare</div>
            <div className="text-xs text-slate-500 font-medium">{savedLbl}</div>
            <div className="text-sm font-bold text-slate-800">{fmtDate(savedStart)}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FBox l="Predare mașină"   v={fmtDate(saved?.dataPredareMasinaSchimb)} c="#0f172a" bg="#f8fafc"/>
            <FBox l="Tarif/zi"         v={`${saved?.tarifZi||0} lei`}              c="#0f172a" bg="#f8fafc"/>
            <FBox l="Zile facturabile" v={saved?.zileFacturabile||0}               c="#d97706" bg="#fffbeb"/>
            <FBox l="Total facturabil" v={`${saved?.totalFacturabil||0} lei`}      c="#059669" bg="#f0fdf4"/>
          </div>
        </div>
      )}
    </Card>
  );
}

// ─── FORM VIEW ──────────────────────────────────────────────────
function FormView({ dosar, tab, setTab, onSave, onCancel }) {
  const [d, setD] = useState({...dosar});
  const upd = (path,val) => setD(prev=>{
    const parts=path.split(".");
    const next={...prev}; let o=next;
    for (let i=0;i<parts.length-1;i++){o[parts[i]]={...o[parts[i]]};o=o[parts[i]];}
    o[parts[parts.length-1]]=val; return next;
  });
  const UPPERCASE = new Set(["nrDosar","masina.marca","masina.model","masina.nrInmatriculare","masina.vin","proprietar.nume","asigurator.inspector"]);
  const updS = (path) => (val) => upd(path, UPPERCASE.has(path) ? (val||"").toUpperCase() : val);

  const TABS=[{id:"info",l:"General"},{id:"proprietar",l:"Proprietar"},{id:"masina",l:"Mașină"},{id:"asigurator",l:"Asigurator"}];

  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      <div className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100">
        <h2 className="font-bold text-slate-800 text-lg">{dosar.nrDosar?`Editare: ${dosar.nrDosar}`:"Dosar nou"}</h2>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-1.5 border border-slate-100 flex gap-1 overflow-x-auto">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`flex-1 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${tab===t.id?"text-white shadow-sm":"text-slate-500 hover:bg-slate-50"}`}
            style={tab===t.id?{background:"#0f172a"}:{}}>{t.l}</button>
        ))}
      </div>
      <Card>
        {tab==="info" && <>
          <FF label="Nr. dosar *" v={d.nrDosar} set={updS("nrDosar")}/>
          <div className="mb-3">
            <label className="text-xs text-slate-500 mb-1.5 block font-medium">Status</label>
            <select value={d.status} onChange={e=>upd("status",e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white">
              {Object.entries(STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <FF label="Data eveniment"  type="date" v={d.dataEveniment}  set={v=>upd("dataEveniment",v)}/>
          <FF label="Data constatare" type="date" v={d.dataConstatare} set={v=>upd("dataConstatare",v)}/>
          <div>
            <label className="text-xs text-slate-500 mb-1.5 block font-medium">Note</label>
            <textarea value={d.note} onChange={e=>upd("note",e.target.value)} rows={3}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none"/>
          </div>
        </>}
        {tab==="proprietar" && <>
          <FF label="Nume *"  v={d.proprietar.nume}    set={updS("proprietar.nume")}/>
          <FF label="Telefon" type="tel"   v={d.proprietar.telefon} set={v=>upd("proprietar.telefon",v)}/>
          <FF label="Email"   type="email" v={d.proprietar.email}   set={v=>upd("proprietar.email",v)}/>
        </>}
        {tab==="masina" && <>
          <FF label="Marcă *"           v={d.masina.marca}           set={updS("masina.marca")}/>
          <FF label="Model *"           v={d.masina.model}           set={updS("masina.model")}/>
          <FF label="An fabricație"     type="number" v={d.masina.an} set={v=>upd("masina.an",v)}/>
          <FF label="Nr. înmatriculare" v={d.masina.nrInmatriculare}  set={updS("masina.nrInmatriculare")}/>
          <FF label="VIN"               v={d.masina.vin}             set={updS("masina.vin")}/>
        </>}
        {tab==="asigurator" && <>
          <div className="mb-3">
            <label className="text-xs text-slate-500 mb-1.5 block font-medium">Companie asigurare *</label>
            <select value={d.asigurator.companie} onChange={e=>upd("asigurator.companie",e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white">
              <option value="">Selectează asiguratorul...</option>
              {ASIGURATORI.map(a=><option key={a} value={a}>{a}</option>)}
            </select>
            <div className="text-[11px] text-slate-400 mt-1.5">ℹ Adresele de email sunt configurate în Setări → Asiguratori</div>
          </div>
          <FF label="Inspector"         v={d.asigurator.inspector} set={updS("asigurator.inspector")}/>
          <FF label="Telefon inspector" v={d.asigurator.contact}   set={v=>upd("asigurator.contact",v)}/>
        </>}
      </Card>
      <div className="flex gap-3">
        <button onClick={onCancel} className="flex-1 py-3 rounded-2xl text-slate-600 font-semibold border border-slate-200 bg-white">Anulează</button>
        <button onClick={()=>onSave(d)} className="flex-1 py-3 rounded-2xl text-white font-semibold" style={{background:"#0f172a"}}>Salvează</button>
      </div>
    </div>
  );
}

// ─── ATOMS ──────────────────────────────────────────────────────
function Card({ children }) {
  return <div className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100">{children}</div>;
}
function ST({ children }) {
  return <h3 className="font-semibold text-xs uppercase tracking-wider text-slate-500 mb-3">{children}</h3>;
}
function FF({ label, type="text", v, set, ph }) {
  return (
    <div className="mb-3">
      <label className="text-xs text-slate-500 mb-1.5 block font-medium">{label}</label>
      <input type={type} value={v||""} onChange={e=>set(e.target.value)} placeholder={ph}
        className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 bg-white transition-all"/>
    </div>
  );
}
function UpperInput({ value, onChange, placeholder, className }) {
  return (
    <input type="text" value={value||""}
      onChange={e=>onChange((e.target.value||"").toUpperCase())}
      placeholder={placeholder}
      className={className}/>
  );
}

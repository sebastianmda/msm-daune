import { useState, useEffect, useRef, useMemo } from "react";
import {
  Plus, Search, ChevronRight, ChevronLeft, Car, FileText, DollarSign,
  Mail, Camera, Trash2, Check, Clock, Edit, ArrowLeft,
  Send, Calendar, User, Building, X, Download,
  Settings, AlertCircle, ChevronDown, WifiOff, Image as ImageIcon
} from "lucide-react";
import { supabase } from "./supabase.js";

// ─── CONSTANTE ──────────────────────────────────────────────────
const COMPANY = { name: "Sistemcar SRL", agent: "Mada Sebastian" };

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
  aprobare_deviz: { label:"Aprobare deviz", bg:"bg-yellow-100", text:"text-yellow-700", dot:"bg-yellow-500" },
  comanda_piese:  { label:"Comandă piese",  bg:"bg-violet-100", text:"text-violet-700", dot:"bg-violet-500" },
  in_lucru:       { label:"În lucru",       bg:"bg-indigo-100", text:"text-indigo-700", dot:"bg-indigo-500" },
  finalizat:      { label:"Finalizat",      bg:"bg-emerald-100",text:"text-emerald-700",dot:"bg-emerald-500" },
};

const ETAPE_TYPES = [
  { value:"reconstatare",       label:"Reconstatare" },
  { value:"cerere_despagubire", label:"Cerere despăgubire" },
  { value:"aprobare_deviz",     label:"Aprobare deviz" },
  { value:"predare_masina",     label:"Predare mașină" },
  { value:"facturare",          label:"Facturare" },
  { value:"nota",               label:"Notă" },
];

const SOLUTII = ["INL", "OR", "REP", "UNI", "REV", "VER", "GEO"];

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

// Fields that should be auto-uppercase
const UPPERCASE_FIELDS = new Set([
  "nrDosar","masina.marca","masina.model","masina.nrInmatriculare","masina.vin",
  "proprietar.nume","asigurator.inspector","piesa","solutieCustom"
]);

// ─── HELPERS ────────────────────────────────────────────────────
const mkDosar = () => ({
  id: Date.now().toString(),
  nrDosar:"", status:"constatare",
  proprietar:{ nume:"", telefon:"", email:"" },
  masina:{ marca:"", model:"", an:"", vin:"", nrInmatriculare:"" },
  asigurator:{ companie:"", inspector:"", contact:"" },
  dataEveniment:"", dataConstatare:"", etape:[],
  financiar:{ sumaFacturata:0, cheltuieli:[], totalCheltuieli:0, sumaRamasa:0, comision:0 },
  masinaSchimb:{
    startDateType:"constatare", customStartDate:"",
    dataAvizare:"", dataRaportTotala:"", dataComandaPiesa:"", dataPrimirePiese:"",
    dataPredareMasinaSchimb:"", zileFacturabile:0, tarifZi:0, totalFacturabil:0
  },
  poze:[], note:"",
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
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

// ─── EMAIL TEMPLATES ────────────────────────────────────────────
const buildReconstatareEmail = (dosar, etapa, extraText) => {
  const piese = (etapa?.piese||[]).filter(p => p.piesa?.trim());
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

// ─── EMAILJS ────────────────────────────────────────────────────
const sendEmail = async (cfg, params) => {
  if (!cfg.serviceId||!cfg.templateId||!cfg.publicKey) throw new Error("Configurare EmailJS incompletă. Mergi la Setări.");
  const r = await fetch("https://api.emailjs.com/api/v1.0/email/send",{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ service_id:cfg.serviceId, template_id:cfg.templateId, user_id:cfg.publicKey, template_params:params })
  });
  if (!r.ok) throw new Error(`EmailJS: ${await r.text()||r.statusText}`);
};

// ─── SUPABASE DATA LAYER ────────────────────────────────────────
const db = {
  loadDosare: async () => {
    const { data, error } = await supabase.from("dosare").select("data").order("updated_at",{ascending:false});
    if (error) throw error;
    return (data||[]).map(r=>r.data);
  },
  saveDosare: async dosar => {
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

// ─── MAIN APP ────────────────────────────────────────────────────
export default function App() {
  const [view,     setView]     = useState("dashboard");
  const [dosare,   setDosare]   = useState([]);
  const [settings, setSettings] = useState(mkSettings());
  const [selected, setSelected] = useState(null);
  const [editing,  setEditing]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [offline,  setOffline]  = useState(false);
  const [search,   setSearch]   = useState("");
  const [tab,      setTab]      = useState("info");
  const [reconEtapa, setReconEtapa] = useState(null); // etapă reconstatare în editare
  const [galleryIdx, setGalleryIdx] = useState(null); // index pt swipe în galerie

  useEffect(()=>{
    (async()=>{
      try {
        const [dos, set] = await Promise.all([db.loadDosare(), db.loadSettings()]);
        setDosare(dos); setSettings(set);
      } catch(e) { console.error(e); setOffline(true); }
      setLoading(false);
    })();
    window.addEventListener("online",  ()=>setOffline(false));
    window.addEventListener("offline", ()=>setOffline(true));
  },[]);

  const saveDosar = async d => {
    d.updatedAt = new Date().toISOString();
    try {
      await db.saveDosare(d);
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

  const openNew  = () => { setEditing(mkDosar());  setTab("info"); setView("form"); };
  const openEdit = d  => { setEditing({...d});     setTab("info"); setView("form"); };
  const openView = d  => { setSelected(d);         setTab("info"); setView("detail"); };

  const filtered = dosare.filter(d=>{
    if (!search) return true;
    const q = search.toLowerCase();
    return [d.nrDosar,d.proprietar?.nume,d.masina?.nrInmatriculare,d.asigurator?.companie]
      .some(v=>v?.toLowerCase().includes(q));
  });

  if (loading) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{background:"#0f172a"}}>
      <Logo size={50}/>
      <div className="text-slate-400 text-sm">Se încarcă...</div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{background:"#f1f5f9",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}>
      <header style={{background:"#0f172a"}} className="sticky top-0 z-50 shadow-lg">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            {view!=="dashboard" && (
              <button onClick={()=>{
                if (reconEtapa) { setReconEtapa(null); return; }
                setView(view==="form"?(selected?"detail":"dashboard"):"dashboard");
              }} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300 flex-shrink-0">
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
            <button onClick={()=>{setSearch("");setView("list");setReconEtapa(null);}} className="p-2 rounded-lg hover:bg-slate-700 text-slate-300">
              <Search size={16}/>
            </button>
            <button onClick={()=>{setView("settings");setReconEtapa(null);}} className="p-2 rounded-lg hover:bg-slate-700 text-slate-300">
              <Settings size={16}/>
            </button>
            <button onClick={openNew} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap"
              style={{background:"#38bdf8",color:"#0f172a"}}>
              <Plus size={14}/> Nou
            </button>
          </div>
        </div>
      </header>

      {offline && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-xs text-amber-800 flex items-center justify-center gap-2">
          <WifiOff size={12}/> Mod offline — datele se vor sincroniza când revine conexiunea
        </div>
      )}

      <main className="max-w-2xl mx-auto px-4 py-4 pb-10">
        {/* Workflow Reconstatare are prioritate */}
        {reconEtapa && selected && (
          <ReconstatareWorkflow
            dosar={selected}
            etapa={reconEtapa}
            settings={settings}
            onSave={async (etapaUpdated) => {
              const exists = (selected.etape||[]).some(e => e.id === etapaUpdated.id);
              const newEtape = exists
                ? selected.etape.map(e => e.id === etapaUpdated.id ? etapaUpdated : e)
                : [...(selected.etape||[]), etapaUpdated];
              const newDosar = { ...selected, etape: newEtape, status: "reconstatare" };
              await saveDosar(newDosar);
              setReconEtapa(null);
            }}
            onCancel={() => setReconEtapa(null)}
          />
        )}

        {!reconEtapa && view==="dashboard" && <Dashboard dosare={dosare} onView={openView} onCreate={openNew} onViewAll={()=>setView("list")}/>}
        {!reconEtapa && view==="list"      && <ListaView filtered={filtered} search={search} setSearch={setSearch} onView={openView}/>}
        {!reconEtapa && view==="settings"  && <SettingsView settings={settings} onSave={saveSettings}/>}
        {!reconEtapa && view==="detail" && selected && (
          <DetailView dosar={selected} tab={tab} setTab={setTab} settings={settings}
            onEdit={()=>openEdit(selected)} onDelete={()=>deleteDosar(selected.id)} onUpdate={saveDosar}
            onOpenReconstatare={(etapa)=>setReconEtapa(etapa||{
              id: Date.now().toString(),
              tip: "reconstatare",
              data: today(),
              observatii: "",
              piese: [],
              poze: [],
              emailExtra: "",
              emailSent: false,
            })}
            galleryIdx={galleryIdx} setGalleryIdx={setGalleryIdx}/>
        )}
        {!reconEtapa && view==="form" && editing && (
          <FormView dosar={editing} tab={tab} setTab={setTab}
            onSave={async (d)=>{ await saveDosar(d); setView("detail"); }} onCancel={()=>setView(selected?"detail":"dashboard")}/>
        )}
      </main>
    </div>
  );
}

// ─── RECONSTATARE WORKFLOW (THE BIG ONE) ────────────────────────
function ReconstatareWorkflow({ dosar, etapa, settings, onSave, onCancel }) {
  const [e, setE] = useState({ ...etapa, piese: etapa.piese || [], poze: etapa.poze || [], emailExtra: etapa.emailExtra || "" });
  const [emailStatus, setEmailStatus] = useState(null);
  const [emailErr, setEmailErr] = useState("");
  const [galIdx, setGalIdx] = useState(null);
  const fileRef = useRef();

  const companie = dosar.asigurator?.companie;
  const recipient = getAsigEmail(settings, companie, "reconstatare");
  const { subject, body } = useMemo(() => buildReconstatareEmail(dosar, e, e.emailExtra), [dosar, e]);
  const ejsOk = settings.emailjs?.serviceId && settings.emailjs?.templateId && settings.emailjs?.publicKey;

  // PIESE — actions
  const addPiesa = () => setE(p => ({ ...p, piese: [...p.piese, { id: Date.now().toString() + Math.random(), piesa: "", solutie: "", solutieCustom: "" }] }));
  const updPiesa = (idx, field, val) => setE(p => ({ ...p, piese: p.piese.map((it,i) => i===idx ? { ...it, [field]: val } : it) }));
  const delPiesa = idx => setE(p => ({ ...p, piese: p.piese.filter((_,i) => i!==idx) }));

  // Initialize cu câteva rânduri goale ca să arate ca un tabel
  useEffect(() => {
    if (e.piese.length === 0) {
      const initial = Array.from({length: 5}, () => ({ id: Date.now().toString() + Math.random(), piesa: "", solutie: "", solutieCustom: "" }));
      setE(p => ({ ...p, piese: initial }));
    }
    // eslint-disable-next-line
  }, []);

  // POZE
  const addPoze = async (ev) => {
    const items = await Promise.all(Array.from(ev.target.files).map(f => new Promise(res => {
      const r = new FileReader();
      r.onload = ev2 => res({ id: Date.now().toString()+Math.random(), name: f.name, data: ev2.target.result, type: f.type, date: new Date().toISOString() });
      r.readAsDataURL(f);
    })));
    setE(p => ({ ...p, poze: [...p.poze, ...items] }));
    ev.target.value = "";
  };
  const delPoza = id => setE(p => ({ ...p, poze: p.poze.filter(x => x.id !== id) }));

  // SEND EMAIL
  const sendNow = async () => {
    if (!recipient) { setEmailStatus("error"); setEmailErr(`Adresa de reconstatare nu este salvată pentru ${companie||"acest asigurator"}. Adaug-o în Setări → Asiguratori.`); return; }
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
    if (!recipient) { setEmailStatus("error"); setEmailErr(`Adresa lipsește pentru ${companie}.`); return; }
    window.open(`mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  const saveAll = () => onSave(e);

  return (
    <div className="space-y-3">
      {/* Header */}
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

      {/* 1. DATA + OBSERVATII */}
      <Card>
        <ST>1. Data & observații</ST>
        <FF label="Data reconstatării" type="date" v={e.data} set={v=>setE(p=>({...p,data:v}))}/>
        <div>
          <label className="text-xs text-slate-500 mb-1.5 block font-medium">Observații</label>
          <textarea value={e.observatii||""} onChange={ev=>setE(p=>({...p,observatii:ev.target.value}))}
            rows={2} placeholder="Note interne despre reconstatare..."
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none"/>
        </div>
      </Card>

      {/* 2. POZE */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <ST>2. Poze</ST>
          <button onClick={()=>fileRef.current.click()} className="flex items-center gap-1 text-sky-600 text-sm font-medium">
            <Camera size={15}/> Adaugă
          </button>
        </div>
        <input ref={fileRef} type="file" multiple accept="image/*" capture="environment" className="hidden" onChange={addPoze}/>
        {e.poze.length===0 ? (
          <button onClick={()=>fileRef.current.click()} className="w-full py-6 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 text-sm hover:bg-slate-50">
            <Camera size={24} className="mx-auto mb-1"/> Apasă pentru a adăuga poze
          </button>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {e.poze.map((p, idx) => (
                <div key={p.id} className="relative aspect-square rounded-lg overflow-hidden border border-slate-100 group">
                  <img src={p.data} alt={p.name} className="w-full h-full object-cover cursor-pointer" onClick={()=>setGalIdx(idx)}/>
                  <button onClick={()=>delPoza(p.id)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full p-0.5 shadow-md">
                    <X size={11}/>
                  </button>
                </div>
              ))}
            </div>
            <div className="text-xs text-slate-400 mt-2 text-center">{e.poze.length} {e.poze.length===1?"poză":"poze"}</div>
          </>
        )}
      </Card>

      {/* Galerie swipe */}
      {galIdx !== null && e.poze[galIdx] && (
        <PhotoGallery
          photos={e.poze}
          index={galIdx}
          onClose={()=>setGalIdx(null)}
          onIndex={setGalIdx}
        />
      )}

      {/* 3. PIESE */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <ST>3. Listă piese solicitate</ST>
          <button onClick={addPiesa} className="flex items-center gap-1 text-sky-600 text-sm font-medium">
            <Plus size={15}/> Rând
          </button>
        </div>
        <div className="space-y-1.5">
          {/* Header tabel */}
          <div className="flex gap-2 px-1 text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            <div className="flex-1">Piesă</div>
            <div className="w-28">Soluție</div>
            <div className="w-6"></div>
          </div>
          {e.piese.map((p, idx) => (
            <div key={p.id} className="flex gap-2 items-start">
              <UpperInput
                value={p.piesa}
                onChange={v => updPiesa(idx,"piesa",v)}
                placeholder={`Piesa ${idx+1}`}
                className="flex-1 border border-slate-200 rounded-lg px-2.5 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-300"
              />
              <div className="w-28">
                <select value={p.solutie} onChange={ev=>updPiesa(idx,"solutie",ev.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-sky-300 bg-white">
                  <option value="">—</option>
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
              <button onClick={()=>delPiesa(idx)} className="p-2 text-slate-300 hover:text-red-400">
                <X size={13}/>
              </button>
            </div>
          ))}
        </div>
        <button onClick={addPiesa} className="w-full mt-3 py-2 border border-dashed border-slate-200 rounded-lg text-xs text-slate-500 hover:bg-slate-50">
          + Adaugă încă un rând
        </button>
      </Card>

      {/* 4. EMAIL */}
      <Card>
        <ST>4. Email reconstatare</ST>

        {!companie && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/>
            <span>Selectează asiguratorul în dosar pentru a trimite email.</span>
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
          <div className="text-xs text-slate-400 mb-1 border-t border-slate-200 pt-2">Mesaj (preview live)</div>
          <pre className="text-xs text-slate-600 whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
        </div>

        <div className="mb-3">
          <label className="text-xs text-slate-500 mb-1.5 block font-medium">Text suplimentar (opțional)</label>
          <textarea value={e.emailExtra} onChange={ev=>setE(p=>({...p,emailExtra:ev.target.value}))}
            rows={3} placeholder="Ex: justificare zile închiriere, alte mențiuni..."
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
            <Check size={14}/> Mail deja trimis la {fmtDate(e.emailSentAt)}
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
              Configurează EmailJS în Setări pentru trimitere directă
            </div>
          )}
          <button onClick={mailto} className="w-full py-2 rounded-xl text-xs font-medium border border-slate-200 bg-white text-slate-600">
            Deschide în app Mail (fallback)
          </button>
        </div>
      </Card>

      {/* SAVE BUTTONS */}
      <div className="flex gap-3 sticky bottom-2">
        <button onClick={onCancel} className="flex-1 py-3 rounded-2xl text-slate-600 font-semibold border border-slate-200 bg-white shadow-sm">Anulează</button>
        <button onClick={saveAll} className="flex-1 py-3 rounded-2xl text-white font-semibold shadow-sm" style={{background:"#0f172a"}}>
          Salvează reconstatarea
        </button>
      </div>
    </div>
  );
}

// ─── PHOTO GALLERY (swipe stânga/dreapta) ──────────────────────
function PhotoGallery({ photos, index, onClose, onIndex }) {
  const prev = () => onIndex(index === 0 ? photos.length - 1 : index - 1);
  const next = () => onIndex(index === photos.length - 1 ? 0 : index + 1);

  // Keyboard arrows
  useEffect(() => {
    const h = ev => {
      if (ev.key === "ArrowLeft") prev();
      else if (ev.key === "ArrowRight") next();
      else if (ev.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line
  }, [index, photos.length]);

  // Touch swipe
  const touchStart = useRef(null);
  const onTouchStart = e => { touchStart.current = e.touches[0].clientX; };
  const onTouchEnd = e => {
    if (touchStart.current === null) return;
    const diff = e.changedTouches[0].clientX - touchStart.current;
    if (Math.abs(diff) > 50) { diff > 0 ? prev() : next(); }
    touchStart.current = null;
  };

  const photo = photos[index];

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col"
      onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="flex justify-between items-center p-4 text-white">
        <div className="text-sm">{index + 1} / {photos.length}</div>
        <button onClick={onClose} className="p-2 rounded-full bg-white/10"><X size={18}/></button>
      </div>

      <div className="flex-1 flex items-center justify-center relative px-2">
        <button onClick={prev} className="absolute left-2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 z-10">
          <ChevronLeft size={22}/>
        </button>
        <img src={photo.data} alt={photo.name} className="max-w-full max-h-full object-contain select-none"/>
        <button onClick={next} className="absolute right-2 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 z-10">
          <ChevronRight size={22}/>
        </button>
      </div>

      <div className="p-4 text-center text-white/70 text-xs">{photo.name}</div>
    </div>
  );
}

// ─── DASHBOARD ──────────────────────────────────────────────────
function Dashboard({ dosare, onView, onCreate, onViewAll }) {
  const [period, setPeriod] = useState("1m");
  const stats = useMemo(()=>{
    const ps = getPeriodStart(period);
    const inp = dosare.filter(d=>new Date(d.updatedAt)>=ps);
    return {
      total:   dosare.length,
      active:  dosare.filter(d=>d.status!=="finalizat").length,
      fin:     dosare.filter(d=>d.status==="finalizat").length,
      comision:inp.reduce((s,d)=>s+(d.financiar?.comision||0),0),
    };
  },[dosare,period]);

  const recente = [...dosare].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).slice(0,8);
  const groups  = Object.entries(STATUS).map(([k,v])=>({k,v,n:dosare.filter(d=>d.status===k).length})).filter(g=>g.n>0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <StatBox label="Total dosare"  val={stats.total}  icon={<FileText size={18}/>}    accent="#38bdf8"/>
        <StatBox label="Dosare active" val={stats.active} icon={<Clock size={18}/>}       accent="#fb923c"/>
        <StatBox label="Finalizate"    val={stats.fin}    icon={<Check size={18}/>}       accent="#34d399"/>
        <StatBox label="Comision" val={`${stats.comision.toFixed(0)} lei`} icon={<DollarSign size={18}/>} accent="#a78bfa">
          <select value={period} onChange={e=>setPeriod(e.target.value)}
            className="mt-1 w-full bg-transparent border-0 text-slate-500 focus:outline-none cursor-pointer p-0"
            style={{fontSize:"11px"}}>
            {PERIOD_OPTS.map(p=><option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </StatBox>
      </div>

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
    ...(d.etape||[]).flatMap(e => e.poze||[])
  ];
  const img = allPhotos.find(p=>p.type?.startsWith("image"));
  return (
    <button onClick={onClick}
      className="w-full text-left flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 border border-slate-100 transition-all group">
      <div className="w-12 h-12 rounded-lg flex-shrink-0 overflow-hidden bg-slate-100 flex items-center justify-center">
        {img ? <img src={img.data} alt="" className="w-full h-full object-cover"/> : <Car size={20} className="text-slate-300"/>}
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

// ─── LISTA ──────────────────────────────────────────────────────
function ListaView({ filtered, search, setSearch, onView }) {
  return (
    <div className="space-y-3">
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
function SettingsView({ settings, onSave }) {
  const [tab, setTab] = useState("emailjs");
  const [s, setS] = useState({...settings, emailjs:{...settings.emailjs}, asiguratorEmails:{...settings.asiguratorEmails}});
  const [saved, setSaved] = useState(false);

  const save = async () => { await onSave(s); setSaved(true); setTimeout(()=>setSaved(false),1500); };
  const updE = (k,v) => setS(p=>({...p,emailjs:{...p.emailjs,[k]:v}}));
  const updA = (a,f,v) => setS(p=>({...p,asiguratorEmails:{...p.asiguratorEmails,[a]:{...p.asiguratorEmails[a],[f]:v}}}));

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center gap-3 mb-1"><Settings size={20} className="text-slate-700"/>
          <h2 className="font-bold text-slate-800 text-lg">Setări</h2></div>
        <p className="text-xs text-slate-500">{COMPANY.agent} · {COMPANY.name}</p>
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
            <div className="font-semibold mb-2">📧 Pași pentru a trimite emailuri direct:</div>
            <ol className="list-decimal list-inside space-y-1 text-sky-700">
              <li>Creează cont gratuit pe <strong>emailjs.com</strong></li>
              <li>Add Email Service → Gmail → conectează contul</li>
              <li>Create Email Template cu variabile: <code className="bg-white px-1 rounded">{`{{to_email}} {{subject}} {{message}} {{from_name}}`}</code></li>
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
            Adresele salvate aici se folosesc automat la trimiterea emailurilor din dosare.
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

// ─── DETAIL ─────────────────────────────────────────────────────
function DetailView({ dosar, tab, setTab, settings, onEdit, onDelete, onUpdate, onOpenReconstatare, galleryIdx, setGalleryIdx }) {
  const s = STATUS[dosar.status]||STATUS.constatare;
  const TABS = [
    {id:"info",label:"Info",icon:<User size={13}/>},
    {id:"etape",label:"Etape",icon:<Clock size={13}/>},
    {id:"despagubire",label:"Despăgubire",icon:<Mail size={13}/>},
    {id:"financiar",label:"Financiar",icon:<DollarSign size={13}/>},
    {id:"schimb",label:"Schimb",icon:<Car size={13}/>},
    {id:"poze",label:"Poze",icon:<Camera size={13}/>},
  ];
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-2xl shadow-sm p-4 border border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
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
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-1.5 border border-slate-100 flex gap-1 overflow-x-auto">
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${tab===t.id?"text-white shadow-sm":"text-slate-500 hover:bg-slate-50"}`}
            style={tab===t.id?{background:"#0f172a"}:{}}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      {tab==="info"        && <InfoTab dosar={dosar}/>}
      {tab==="etape"       && <EtapeTab dosar={dosar} onUpdate={onUpdate} onOpenReconstatare={onOpenReconstatare}/>}
      {tab==="despagubire" && <DespagubireTab dosar={dosar} settings={settings} onUpdate={onUpdate}/>}
      {tab==="financiar"   && <FinanciarTab dosar={dosar} onUpdate={onUpdate}/>}
      {tab==="schimb"      && <SchimbTab dosar={dosar} onUpdate={onUpdate}/>}
      {tab==="poze"        && <PozeTab dosar={dosar} onUpdate={onUpdate} galleryIdx={galleryIdx} setGalleryIdx={setGalleryIdx}/>}
    </div>
  );
}

// ─── INFO TAB ───────────────────────────────────────────────────
function InfoTab({ dosar }) {
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
        <IR l="Data eveniment" v={fmtDate(dosar.dataEveniment)}/><IR l="Data constatare" v={fmtDate(dosar.dataConstatare)}/>
      </Sec>
      {dosar.note && <Sec title="Note" icon={<FileText size={15}/>}><p className="text-sm text-slate-700">{dosar.note}</p></Sec>}
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

// ─── ETAPE TAB ──────────────────────────────────────────────────
function EtapeTab({ dosar, onUpdate, onOpenReconstatare }) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({tip:"reconstatare",data:today(),observatii:""});

  const add = async () => {
    if (!form.data) return;
    // Daca e reconstatare → deschide workflow-ul mare
    if (form.tip === "reconstatare") {
      onOpenReconstatare({
        id: Date.now().toString(),
        tip: "reconstatare",
        data: form.data,
        observatii: form.observatii,
        piese: [],
        poze: [],
        emailExtra: "",
        emailSent: false,
      });
      setShow(false);
      setForm({tip:"reconstatare",data:today(),observatii:""});
      return;
    }
    // Altfel: salveaza ca etapa simpla
    const sm = {cerere_despagubire:"finalizat",aprobare_deviz:"aprobare_deviz",reconstatare:"reconstatare"};
    await onUpdate({...dosar, etape:[...(dosar.etape||[]),{...form,id:Date.now().toString()}], status:sm[form.tip]||dosar.status});
    setShow(false); setForm({tip:"reconstatare",data:today(),observatii:""});
  };

  const del = id => onUpdate({...dosar,etape:dosar.etape.filter(e=>e.id!==id)});

  const all = [{id:"init",tip:"constatare",data:dosar.dataConstatare,observatii:"",_init:true},...(dosar.etape||[])];

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <ST>Etape dosar</ST>
        <button onClick={()=>setShow(!show)} className="flex items-center gap-1 text-sm font-medium text-sky-600"><Plus size={15}/>Adaugă</button>
      </div>
      {show && (
        <div className="bg-sky-50 rounded-xl p-3 mb-4 space-y-2 border border-sky-100">
          <select value={form.tip} onChange={e=>setForm(p=>({...p,tip:e.target.value}))}
            className="w-full border border-sky-200 rounded-lg px-3 py-2 bg-white focus:outline-none">
            {ETAPE_TYPES.map(t=><option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <input type="date" value={form.data} onChange={e=>setForm(p=>({...p,data:e.target.value}))}
            className="w-full border border-sky-200 rounded-lg px-3 py-2 bg-white focus:outline-none"/>
          <textarea value={form.observatii} onChange={e=>setForm(p=>({...p,observatii:e.target.value}))}
            placeholder="Observații (opțional)..." rows={2}
            className="w-full border border-sky-200 rounded-lg px-3 py-2 bg-white focus:outline-none resize-none"/>
          {form.tip === "reconstatare" && (
            <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">
              ℹ Vei fi dus la ecranul complet de reconstatare cu poze, listă piese și email
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={add} className="flex-1 py-2 rounded-lg text-sm font-semibold text-white" style={{background:"#0f172a"}}>
              {form.tip === "reconstatare" ? "Continuă →" : "Salvează"}
            </button>
            <button onClick={()=>setShow(false)} className="flex-1 py-2 rounded-lg text-sm border border-slate-200 bg-white text-slate-600">Anulează</button>
          </div>
        </div>
      )}
      <div className="relative">
        <div className="absolute left-[7px] top-0 bottom-0 w-px bg-slate-100"></div>
        <div className="space-y-4">
          {all.map((e,i)=>{
            const lbl = e._init?"Constatare inițială":(ETAPE_TYPES.find(t=>t.value===e.tip)?.label||e.tip);
            const isRec = e.tip === "reconstatare" && !e._init;
            return (
              <div key={e.id||i} className="flex gap-3 items-start">
                <span className={`w-3.5 h-3.5 rounded-full flex-shrink-0 mt-0.5 border-2 border-white shadow-sm z-10 relative ${e._init?"bg-sky-500":"bg-amber-400"}`}></span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <button onClick={()=>isRec && onOpenReconstatare(e)} className={`font-semibold text-sm text-left ${isRec ? "text-sky-700 hover:text-sky-900" : "text-slate-800"}`}>
                      {lbl} {isRec && "→"}
                    </button>
                    {!e._init && <button onClick={()=>del(e.id)} className="text-slate-300 hover:text-red-400 ml-2"><X size={13}/></button>}
                  </div>
                  <div className="text-xs text-slate-400">{fmtDate(e.data)}</div>
                  {e.observatii && <div className="text-xs text-slate-500 mt-1 bg-slate-50 rounded-lg px-2 py-1">{e.observatii}</div>}
                  {isRec && (
                    <div className="flex gap-3 mt-1.5 text-[10px] text-slate-500">
                      {(e.poze?.length||0)>0   && <span className="flex items-center gap-1"><Camera size={10}/>{e.poze.length}</span>}
                      {(e.piese?.length||0)>0 && <span className="flex items-center gap-1"><FileText size={10}/>{e.piese.filter(p=>p.piesa?.trim()).length} piese</span>}
                      {e.emailSent && <span className="text-emerald-600 flex items-center gap-1"><Check size={10}/>mail trimis</span>}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

// ─── DESPAGUBIRE TAB ───────────────────────────────────────────
function DespagubireTab({ dosar, settings, onUpdate }) {
  const [extra, setExtra] = useState(dosar.despagubire?.emailExtra || "");
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState("");

  const companie = dosar.asigurator?.companie;
  const recipient = getAsigEmail(settings, companie, "despagubire");
  const { subject, body } = useMemo(()=>buildDespagubireEmail(dosar, extra), [dosar, extra]);
  const ejsOk = settings.emailjs?.serviceId && settings.emailjs?.templateId && settings.emailjs?.publicKey;
  const sent = dosar.despagubire?.emailSent;

  const send = async () => {
    if (!recipient) { setStatus("error"); setErr(`Adresa de cerere daună nu este salvată pentru ${companie||"acest asigurator"}. Adaug-o în Setări → Asiguratori.`); return; }
    setStatus("sending"); setErr("");
    try {
      await sendEmail(settings.emailjs, {
        to_email: recipient, subject, message: body,
        from_name: settings.emailjs?.fromName || COMPANY.agent,
        from_email: settings.emailjs?.fromEmail || ""
      });
      setStatus("sent");
      await onUpdate({ ...dosar, despagubire: { emailExtra: extra, emailSent: true, emailSentAt: new Date().toISOString() }, status: "finalizat" });
      setTimeout(()=>setStatus(null), 3000);
    } catch(e) { setStatus("error"); setErr(e.message); }
  };

  const mailto = () => {
    if (!recipient) { setStatus("error"); setErr(`Adresa lipsește pentru ${companie}.`); return; }
    window.open(`mailto:${recipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
  };

  const saveExtra = () => onUpdate({ ...dosar, despagubire: { ...dosar.despagubire, emailExtra: extra } });

  return (
    <Card>
      <ST>Cerere despăgubire</ST>

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
        <label className="text-xs text-slate-500 mb-1.5 block font-medium">Text suplimentar (ex: justificare zile închiriere)</label>
        <textarea value={extra} onChange={e=>setExtra(e.target.value)} onBlur={saveExtra}
          rows={3} placeholder="Ex: Mașina a fost imobilizată 7 zile în așteptarea piesei X comandate la data de..."
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-sky-300 resize-none text-sm"/>
      </div>

      {status==="error" && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 text-xs text-red-700 flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5"/><span>{err}</span>
        </div>
      )}
      {status==="sent" && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-3 text-xs text-emerald-700 flex items-center gap-2">
          <Check size={14}/> Email trimis cu succes!
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
  );
}

// ─── FINANCIAR TAB ──────────────────────────────────────────────
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

  const dl = () => {
    const lines = ["Raport financiar — MSM Management Daune","════════════",
      `Dosar: ${dosar.nrDosar}`,`Proprietar: ${dosar.proprietar?.nume}`,
      `Mașină: ${dosar.masina?.marca} ${dosar.masina?.model} ${dosar.masina?.nrInmatriculare}`,
      `Asigurator: ${dosar.asigurator?.companie}`,"────────────",
      `Sumă facturată: ${saved.sumaFacturata} lei`,`Cheltuieli: ${saved.totalCheltuieli} lei`,
      `Sumă rămasă: ${saved.sumaRamasa} lei`,`Comision 5%: ${(saved.comision||0).toFixed(2)} lei`,
      "────────────","Cheltuieli:",
      ...(saved.cheltuieli||[]).map(c=>`  - ${c.descriere}: ${c.suma} lei`),
      "","Generat de: " + COMPANY.agent + " (" + COMPANY.name + ")",
    ];
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/plain"}));
    a.download=`raport_${dosar.nrDosar||dosar.id}.txt`; a.click();
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <ST>Financiar</ST>
        <div className="flex gap-2">
          <button onClick={dl} className="flex items-center gap-1 text-emerald-600 text-sm font-medium"><Download size={14}/>Raport</button>
          <button onClick={()=>{setFin({...dosar.financiar,cheltuieli:[...(dosar.financiar?.cheltuieli||[])]});setEditing(!editing);}}
            className="flex items-center gap-1 text-sky-600 text-sm font-medium"><Edit size={14}/>{editing?"Anulează":"Editează"}</button>
        </div>
      </div>
      {editing ? (
        <div className="space-y-3">
          <FF label="Sumă facturată (lei)" type="number" v={fin.sumaFacturata} set={v=>setFin(f=>({...f,sumaFacturata:v}))}/>
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
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-sky-300"/>
              <input value={ch.suma} onChange={e=>setCh(p=>({...p,suma:e.target.value}))} type="number" placeholder="lei"
                className="w-20 border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-sky-300"/>
              <button onClick={addCh} className="px-3 py-2 rounded-lg bg-sky-50 text-sky-600"><Plus size={15}/></button>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 text-sm border border-slate-100">
            <div className="flex justify-between"><span className="text-slate-500">Sumă facturată</span><span>{prev.sumaFacturata} lei</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Cheltuieli</span><span className="text-red-500">- {prev.totalCheltuieli} lei</span></div>
            <div className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold"><span>Sumă rămasă</span><span>{prev.sumaRamasa} lei</span></div>
            <div className="flex justify-between font-bold text-emerald-600"><span>Comision 5%</span><span>{prev.comision.toFixed(2)} lei</span></div>
          </div>
          <button onClick={save} className="w-full py-2.5 rounded-xl text-sm font-semibold text-white" style={{background:"#0f172a"}}>Salvează</button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <FBox l="Sumă facturată" v={`${saved?.sumaFacturata||0} lei`} c="#0f172a" bg="#f8fafc"/>
            <FBox l="Cheltuieli"     v={`${saved?.totalCheltuieli||0} lei`} c="#ef4444" bg="#fef2f2"/>
            <FBox l="Sumă rămasă"    v={`${saved?.sumaRamasa||0} lei`} c="#0284c7" bg="#f0f9ff"/>
            <FBox l="Comision 5%"    v={`${(saved?.comision||0).toFixed(2)} lei`} c="#059669" bg="#f0fdf4"/>
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

// ─── SCHIMB TAB ─────────────────────────────────────────────────
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

  const dl = () => {
    const lines = ["Raport mașină schimb — MSM Management Daune","════════════",
      `Dosar: ${dosar.nrDosar}`,`Proprietar: ${dosar.proprietar?.nume}`,
      `Mașină: ${dosar.masina?.marca} ${dosar.masina?.model} ${dosar.masina?.nrInmatriculare}`,"────────────",
      `Start (${savedLbl}): ${fmtDate(savedStart)}`,
      `Data predare mașină: ${fmtDate(saved.dataPredareMasinaSchimb)}`,
      `Zile facturabile: ${saved.zileFacturabile}`,`Tarif/zi: ${saved.tarifZi} lei`,
      `Total facturabil: ${saved.totalFacturabil} lei`,
      "","Generat de: " + COMPANY.agent + " (" + COMPANY.name + ")",
    ];
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/plain"}));
    a.download=`schimb_${dosar.nrDosar||dosar.id}.txt`; a.click();
  };

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <ST>Mașină la schimb</ST>
        <div className="flex gap-2">
          {!editing && <button onClick={dl} className="flex items-center gap-1 text-emerald-600 text-sm font-medium"><Download size={14}/>Raport</button>}
          <button onClick={()=>{setS({...dosar.masinaSchimb});setEditing(!editing);}}
            className="flex items-center gap-1 text-sky-600 text-sm font-medium"><Edit size={14}/>{editing?"Anulează":"Editează"}</button>
        </div>
      </div>
      {editing ? (
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-500 mb-2 block font-medium">Data start (de la care se calculează)</label>
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

// ─── POZE TAB (cu galerie swipe) ───────────────────────────────
function PozeTab({ dosar, onUpdate, galleryIdx, setGalleryIdx }) {
  const ref = useRef();
  const add = async e => {
    const items = await Promise.all(Array.from(e.target.files).map(f=>new Promise(res=>{
      const r=new FileReader();
      r.onload=ev=>res({id:Date.now().toString()+Math.random(),name:f.name,data:ev.target.result,type:f.type,date:new Date().toISOString()});
      r.readAsDataURL(f);
    })));
    await onUpdate({...dosar,poze:[...(dosar.poze||[]),...items]});
    e.target.value="";
  };
  const del = id => onUpdate({...dosar,poze:dosar.poze.filter(p=>p.id!==id)});
  const imagini = (dosar.poze||[]).filter(p=>p.type?.startsWith("image"));

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <ST>Poze & documente</ST>
          <button onClick={()=>ref.current.click()} className="flex items-center gap-1 text-sky-600 text-sm font-medium">
            <Plus size={15}/>Adaugă
          </button>
        </div>
        <input ref={ref} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={add}/>
        {!(dosar.poze?.length) ? (
          <div className="text-center py-10">
            <Camera size={36} className="mx-auto mb-3 text-slate-300"/>
            <p className="text-slate-400 text-sm mb-3">Nicio poză sau document adăugat</p>
            <button onClick={()=>ref.current.click()} className="text-sky-600 text-sm font-medium">Adaugă acum</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {dosar.poze.map((p, idx)=>{
              const imgIdx = imagini.findIndex(i => i.id === p.id);
              return (
                <div key={p.id} className="relative group rounded-xl overflow-hidden border border-slate-100">
                  {p.type?.startsWith("image")
                    ? <img src={p.data} alt={p.name} className="w-full h-28 object-cover cursor-pointer" onClick={()=>setGalleryIdx(imgIdx)}/>
                    : <div className="w-full h-28 bg-slate-50 flex flex-col items-center justify-center gap-1">
                        <FileText size={22} className="text-slate-400"/>
                        <span className="text-xs text-slate-400 px-2 text-center truncate w-full">{p.name}</span>
                      </div>
                  }
                  <button onClick={()=>del(p.id)}
                    className="absolute top-1.5 right-1.5 bg-red-500 text-white rounded-full p-0.5 shadow-sm"><X size={11}/></button>
                  <div className="px-2 py-1.5 bg-white"><div className="text-xs text-slate-400 truncate">{p.name}</div></div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {galleryIdx !== null && imagini[galleryIdx] && (
        <PhotoGallery photos={imagini} index={galleryIdx} onClose={()=>setGalleryIdx(null)} onIndex={setGalleryIdx}/>
      )}
    </>
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

  // Wrapper care decide dacă să facă uppercase
  const updS = (path) => (val) => upd(path, UPPERCASE_FIELDS.has(path) ? (val||"").toUpperCase() : val);

  const TABS=[{id:"info",l:"General"},{id:"proprietar",l:"Proprietar"},{id:"masina",l:"Mașină"},{id:"asigurator",l:"Asigurator"}];

  return (
    <div className="space-y-3">
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
// Input cu auto-uppercase
function UpperInput({ value, onChange, placeholder, className }) {
  return (
    <input type="text" value={value||""}
      onChange={e=>onChange((e.target.value||"").toUpperCase())}
      placeholder={placeholder}
      className={className}/>
  );
}

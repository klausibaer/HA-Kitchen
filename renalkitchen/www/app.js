// ── State ─────────────────────────────────────────────────────────────────────
const S={
  ready:false,configured:false,haToken:false,profileOpen:false,profileSaved:false,
  haUsers:[],   // [{id, name, entityId, picture}] from HA person entities
  tab:'generate',mode:'generate',
  // profiles
  profiles:[],activeProfileId:null,
  // health goal & active profile settings
  healthGoals:[],
  name:'',gender:'',haUserId:null,preset:null,
  mealType:'any',dietStyle:'omnivore',servings:2,count:1,units:'metric',
  potassium:'none',phosphorus:'none',sodium:'none',
  calcium:'none',fluid:'none',protein:'moderate',
  oxalate:'none',purine:'none',
  heartHealthy:false,diabetic:false,glutenFree:false,
  hypertension:false,gout:false,osteoporosis:false,
  histamine:false,lactose:false,ibs:false,
  thyroid:false,liver:false,
  calorieTarget:0,        // kcal/day target (0 = no target)
  extras:'',
  // cooking prefs
  prepTime:'any',cookStyles:[],
  // UI
  loading:false,error:'',
  recipes:[],favs:[],favLoaded:false,
  fridgeItems:[],fridgeInput:'',dishName:'',
  // menu tab
  menuImages:[],
  // pantry
  pantry:[],pantryLoaded:false,pantryGroup:'category',pantryFilter:'',
  pantryAddOpen:false,pantryEditId:null,pantryReceiptOpen:false,pantryReceiptScanning:false,pantryReceiptStatus:'',
  pantryForm:{name:'',quantity:'1',unit:'g',category:'other',location:'fridge',expirationDate:'',note:''},
  menuText:'',ocrLoading:false,ocrProgress:0,ocrError:'',
  menuAnalysis:null,menuLoading:false,menuError:'',
  // nutrition tracker
  nutritionLog:[],  // each entry has profileId field
  loggedThisSession:{},
  logUserPicker:{open:false,entry:null},  // post-log other-user picker
  // manual food log modal
  manualLog:{open:false,mode:'text',name:'',calories:'',protein:'',potassium:'',sodium:'',carbs:'',fat:'',servings:1,analyzing:false,error:''},
  // sensor push
  sensorPushing:{},  // recipeKey → 'pushing'|'ok'|'error'
  swapState:{},servingOverrides:{},
  editingFav:null,
};

// ── Base URL (works under HA Ingress regardless of trailing slash) ─────────────
const BASE=(()=>{
  const meta=document.querySelector('meta[name="ingress-path"]');
  const p=(meta&&meta.content)?meta.content:window.location.pathname;
  return p.endsWith('/')?p:p+'/';
})();

// ── API ───────────────────────────────────────────────────────────────────────
async function apiGet(key){try{const r=await fetch(BASE+`rk/data/${key}`);const d=await r.json();return d.value;}catch{return null;}}
async function apiSet(key,value){try{await fetch(BASE+`rk/data/${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value})});}catch{}}

async function claudeRaw(messages,maxTokens){
  const r=await fetch(BASE+'rk/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({max_tokens:maxTokens||1200,messages})});
  if(!r.ok){
    let msg='Server error '+r.status;
    try{const d=await r.json();msg=d.error||msg;}catch{try{msg=await r.text();}catch{}}
    throw new Error(msg);
  }
  const d=await r.json();
  return d.content.map(b=>b.text||'').join('');
}

// Robust JSON extractor — finds first [ or { and matches to closing bracket
function extractJSON(txt){
  // Try stripping markdown fences first
  const stripped=txt.replace(/```(?:json)?/gi,'').trim();
  // Find first array or object
  const si=stripped.search(/[\[{]/);
  if(si===-1)throw new Error('No JSON found in response');
  const start=stripped[si];
  const end=start==='['?']':'}';
  let depth=0,inStr=false,esc=false;
  for(let i=si;i<stripped.length;i++){
    const c=stripped[i];
    if(esc){esc=false;continue;}
    if(c==='\\'&&inStr){esc=true;continue;}
    if(c==='"'&&!esc)inStr=!inStr;
    if(!inStr){if(c===start)depth++;else if(c===end){depth--;if(depth===0)return JSON.parse(stripped.slice(si,i+1));}}
  }
  throw new Error('Malformed JSON in response');
}

// ── Scaling ───────────────────────────────────────────────────────────────────
const VF={'\u215B':1/8,'\u00BC':1/4,'\u2153':1/3,'\u215C':3/8,'\u00BD':1/2,'\u215D':5/8,'\u2154':2/3,'\u00BE':3/4,'\u215E':7/8};
function pFrac(s){const p=s.match(/^(\d+)\s*\/\s*(\d+)$/);if(p)return+p[1]/+p[2];if(VF[s]!==undefined)return VF[s];const m=s.match(/^(\d+)(.)$/);if(m&&VF[m[2]]!==undefined)return+m[1]+VF[m[2]];return parseFloat(s);}
function fmtN(n){if(n<=0)return'0';const fr=[[1/8,'\u215B'],[1/4,'\u00BC'],[1/3,'\u2153'],[3/8,'\u215C'],[1/2,'\u00BD'],[5/8,'\u215D'],[2/3,'\u2154'],[3/4,'\u00BE'],[7/8,'\u215E']];const w=Math.floor(n),f=n-w;if(f<0.04)return w===0?'':String(w);for(const[v,sym]of fr)if(Math.abs(f-v)<0.07)return w>0?w+sym:sym;return String(Math.round(n*10)/10);}
function scaleIng(ing,ratio){if(!ing||ratio===1)return ing;return ing.replace(/(\d+\s*\/\s*\d+|\d+[^\w\s]|[^\w\s\d]|\d*\.?\d+)(?:\s*[-\u2013]\s*(\d+\s*\/\s*\d+|\d+[^\w\s]|[^\w\s\d]|\d*\.?\d+))?/g,(m,n1,n2)=>{const v1=pFrac(n1.trim());if(isNaN(v1)||v1===0)return m;const s1=fmtN(v1*ratio);if(n2!==undefined){const v2=pFrac(n2.trim());if(!isNaN(v2)&&v2>0)return s1+'-'+fmtN(v2*ratio);}return s1;});}
function scaleNut(v,ratio){const n=parseFloat(v);return isNaN(n)?v:v.replace(/[\d.]+/,Math.round(n*ratio));}

// ── Presets ───────────────────────────────────────────────────────────────────
const PRESETS={
  ckd_early:{potassium:'moderate',phosphorus:'moderate',sodium:'moderate',calcium:'none',fluid:'none',protein:'low',oxalate:'none',purine:'none',heartHealthy:true,diabetic:false,glutenFree:false},
  ckd_late:{potassium:'low',phosphorus:'low',sodium:'moderate',calcium:'moderate',fluid:'moderate',protein:'low',oxalate:'none',purine:'none',heartHealthy:true,diabetic:false,glutenFree:false},
  hemo:{potassium:'low',phosphorus:'low',sodium:'low',calcium:'moderate',fluid:'strict',protein:'high',oxalate:'none',purine:'none',heartHealthy:true,diabetic:false,glutenFree:false},
  peri:{potassium:'moderate',phosphorus:'low',sodium:'low',calcium:'moderate',fluid:'moderate',protein:'high',oxalate:'none',purine:'none',heartHealthy:true,diabetic:false,glutenFree:false},
  stones_c:{potassium:'none',phosphorus:'none',sodium:'moderate',calcium:'moderate',fluid:'none',protein:'moderate',oxalate:'low',purine:'none',heartHealthy:false,diabetic:false,glutenFree:false},
  stones_u:{potassium:'none',phosphorus:'none',sodium:'moderate',calcium:'none',fluid:'none',protein:'moderate',oxalate:'none',purine:'low',heartHealthy:false,diabetic:false,glutenFree:false},
  transplant:{potassium:'moderate',phosphorus:'moderate',sodium:'moderate',calcium:'moderate',fluid:'none',protein:'moderate',oxalate:'none',purine:'none',heartHealthy:true,diabetic:true,glutenFree:false},
};
const PRESET_LABELS=[['ckd_early','Early CKD (1-3)'],['ckd_late','Late CKD (4-5)'],['hemo','Haemodialysis'],['peri','Peritoneal Dialysis'],['stones_c','Calcium Oxalate Stones'],['stones_u','Uric Acid Stones'],['transplant','Post-Transplant']];
const NUT_LABELS={calories:'Calories',protein:'Protein',potassium:'Potassium',phosphorus:'Phosphorus',sodium:'Sodium',calcium:'Calcium',fluid:'Fluid'};
const SAFETY={safe:{bg:'#f0f8f1',bo:'#b8dbbe',tc:'#4a7a55',lbl:'✓ Safe'},caution:{bg:'#fdf5dc',bo:'#e0c870',tc:'#8a6020',lbl:'⚠ Changes'},avoid:{bg:'#fff3f0',bo:'#f5c4b8',tc:'#c04a30',lbl:'✗ Avoid'}};

// ── Utils ─────────────────────────────────────────────────────────────────────
function goalContext(){
  const goalDescs={kidney:'kidney disease management (CKD/dialysis/transplant)',weight:'weight loss with calorie deficit',healthy:'balanced healthy eating with whole foods',diabetes:'diabetes management (low glycaemic index)',heart:'cardiovascular health (low saturated fat)',hypert:'hypertension management (DASH diet)',gout:'gout management (low purine)',stones:'kidney stone prevention',ibs:'irritable bowel syndrome (low-FODMAP)',osteo:'osteoporosis (calcium & vitamin D rich)',liver:'liver disease management',custom:'custom dietary requirements'};
  const goals=(S.healthGoals||[]);
  if(!goals.length)return'general healthy eating';
  return goals.map(id=>{const g=HEALTH_GOALS.find(h=>h.id===id);return goalDescs[id]||(g?g.title:id);}).join(' + ');
}
function rText(){
  const genderStr=S.gender==='male'?'male':S.gender==='female'?'female':S.gender==='other'?'non-binary':'';
  const flags=[S.heartHealthy?'heart-healthy':'',S.diabetic?'diabetic-friendly':'',S.glutenFree?'gluten-free':'',S.lactose?'lactose-free':'',S.histamine?'low-histamine':'',S.ibs?'low-FODMAP':'',S.gout?'low-purine':'',S.hypertension?'DASH/hypertension':'',S.liver?'liver-friendly':''].filter(Boolean).join(', ');
  const restr=`Potassium:${S.potassium},Phosphorus:${S.phosphorus},Sodium:${S.sodium},Calcium:${S.calcium},Fluid:${S.fluid},Protein:${S.protein},Oxalate:${S.oxalate},Purine:${S.purine}${flags?', '+flags:''}`;
  return`Goals: ${goalContext()}. Restrictions: ${restr}${S.calorieTarget?'. Calorie target: '+S.calorieTarget+'kcal/day':''}${genderStr?'. Patient: '+genderStr:''}`;
}function nutShape(){return`"calories":"320","protein":"22g","potassium":"250mg","phosphorus":"180mg","sodium":"280mg","calcium":"80mg"`+(S.fluid!=='none'?`,"fluid":"180ml"`:'')+`,"carbs":"45g"`;}
function extrasStr(){return[S.heartHealthy?'heart-healthy low saturated fat':'',S.diabetic?'diabetic-friendly low glycaemic':'',S.glutenFree?'gluten-free':'',S.lactose?'lactose-free':'',S.histamine?'low-histamine':'',S.ibs?'low-FODMAP':'',S.gout?'low-purine (gout)':'',S.hypertension?'DASH diet (hypertension)':'',S.liver?'liver-friendly no alcohol':'',S.extras].filter(Boolean).join(', ')||'none';}
function unitStr(){return S.units==='metric'?'metric (g,ml,kg)':'imperial (oz,lbs,cups,fl oz)';}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function isFav(r){return S.favs.some(f=>f.name===r.name);}
function opts(pairs,sel){return pairs.map(([v,l])=>`<option value="${v}"${v===sel?' selected':''}>${l}</option>`).join('');}
function tRow(id,label,sub,on){return`<div class="toggle-row${on?' on':''}" data-toggle="${id}"><div><div style="font-size:.84rem;color:#2d1f17">${label}</div><div style="font-size:.7rem;color:#8a7060;margin-top:2px">${sub}</div></div><div class="toggle-track${on?' on':''}"><div class="toggle-thumb${on?' on':''}"></div></div></div>`;}

// ── Profile panel ─────────────────────────────────────────────────────────────
const HEALTH_GOALS=[
  {id:'kidney',   icon:'🫘',title:'Nierengesundheit',     sub:'CKD, Dialyse, Transplantat'},
  {id:'weight',   icon:'⚖️',title:'Gewicht reduzieren',   sub:'Kaloriendefizit, Portionskontrolle'},
  {id:'healthy',  icon:'🥗',title:'Gesund ernähren',      sub:'Ausgewogene Makros, unverarbeitete Lebensmittel'},
  {id:'diabetes', icon:'💉',title:'Diabetesmanagement',   sub:'Niedriger glykämischer Index, Kohlenhydratkontrolle'},
  {id:'heart',    icon:'❤️',title:'Herzgesundheit',       sub:'Wenig gesättigte Fette, Natrium reduzieren'},
  {id:'hypert',   icon:'🩺',title:'Bluthochdruck',        sub:'DASH-Diät, Natrium- & Kaliumkontrolle'},
  {id:'gout',     icon:'🦶',title:'Gicht',                sub:'Purinarm, kein Alkohol, wenig Fructose'},
  {id:'stones',   icon:'🪨',title:'Nierensteine',         sub:'Oxalat- oder Purinkontrolle, viel Flüssigkeit'},
  {id:'ibs',      icon:'🌿',title:'Reizdarm / IBS',       sub:'Low-FODMAP, ballaststoffkontrolliert'},
  {id:'osteo',    icon:'🦴',title:'Osteoporose',          sub:'Kalzium- & Vitamin-D-reich, phosphatarm'},
  {id:'liver',    icon:'🟤',title:'Lebererkrankung',      sub:'Wenig Fett, kein Alkohol, salzarm'},
  {id:'custom',   icon:'✏️',title:'Eigene Einstellungen', sub:'Alle Felder manuell konfigurieren'},
];

// Restriction level ordering — higher index = more restrictive
const RESTR_ORDER=['none','moderate','low','very_low'];
function mostRestrictive(a,b){return RESTR_ORDER.indexOf(a)>=RESTR_ORDER.indexOf(b)?a:b;}
// Protein: 'low' and 'high' conflict → fall back to 'moderate'
function mergeProtein(a,b){if(a===b)return a;if((a==='low'&&b==='high')||(a==='high'&&b==='low'))return'moderate';if(a==='moderate')return b;if(b==='moderate')return a;return'moderate';}

const GOAL_PRESETS={
  kidney:  {potassium:'moderate',phosphorus:'moderate',sodium:'moderate',protein:'low',heartHealthy:true,calcium:'moderate',fluid:'none',oxalate:'none',purine:'none'},
  weight:  {sodium:'moderate',protein:'high',heartHealthy:true,calorieTarget:1600},
  healthy: {heartHealthy:true},
  diabetes:{sodium:'moderate',heartHealthy:true,diabetic:true},
  heart:   {sodium:'low',heartHealthy:true},
  hypert:  {sodium:'low',heartHealthy:true,hypertension:true},
  gout:    {purine:'low',sodium:'moderate',gout:true},
  stones:  {oxalate:'low',sodium:'moderate',fluid:'moderate'},
  ibs:     {ibs:true},
  osteo:   {calcium:'moderate',phosphorus:'moderate',osteoporosis:true},
  liver:   {sodium:'low',heartHealthy:true,liver:true,protein:'low'},
  custom:  {},
};

function recomputeGoalDefaults(){
  const goals=S.healthGoals||[];
  // Start from neutral base
  let merged={potassium:'none',phosphorus:'none',sodium:'none',calcium:'none',fluid:'none',protein:'moderate',oxalate:'none',purine:'none',heartHealthy:false,diabetic:false,glutenFree:false,hypertension:false,gout:false,osteoporosis:false,histamine:false,lactose:false,ibs:false,thyroid:false,liver:false,calorieTarget:0};
  for(const id of goals){
    const p=GOAL_PRESETS[id]||{};
    for(const [k,v] of Object.entries(p)){
      if(k==='protein')merged[k]=mergeProtein(merged[k],v);
      else if(RESTR_ORDER.includes(merged[k]))merged[k]=mostRestrictive(merged[k],v);
      else if(typeof v==='boolean')merged[k]=merged[k]||v;
      else if(k==='calorieTarget')merged[k]=Math.max(merged[k],v);
      else merged[k]=v;
    }
  }
  Object.assign(S,merged);
}

function toggleGoal(goalId){
  const cur=S.healthGoals||[];
  if(cur.includes(goalId)){S.healthGoals=cur.filter(g=>g!==goalId);}
  else{S.healthGoals=[...cur,goalId];}
  S.preset=null;
  recomputeGoalDefaults();
}

function profileFields(){
  const goals=S.healthGoals||[];
  const hasGoal=id=>goals.includes(id);
  const anyGoal=goals.length>0;

  // Helper: compact toggle row
  const tog=(key,label,sub)=>tRow(key,label,sub,S[key]);

  // Helper: calorie target input row
  const calTarget=anyGoal?`
    <div style="margin-bottom:.8rem">
      <div class="lbl">Kalorienziel / Tag <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:.72rem;color:#8a7060">— 0 = kein Ziel</span></div>
      <div style="display:flex;align-items:center;gap:.5rem">
        <input id="pCalTarget" type="number" min="0" max="5000" step="50" class="field" value="${S.calorieTarget||0}" style="max-width:120px"/>
        <span style="font-size:.82rem;color:#8a7060">kcal</span>
      </div>
    </div>`:''

  return`
    <div style="margin-bottom:1.2rem">
      <div class="lbl">Meine Ziele <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:.73rem;color:var(--stone)">— mehrere möglich</span></div>
      <div>
        ${HEALTH_GOALS.map(g=>{const sel=(S.healthGoals||[]).includes(g.id);return`<button class="goal-card${sel?' active':''}" data-togglegoal="${g.id}">
          <span class="goal-icon">${g.icon}</span>
          <div><div style="font-size:.9rem;font-weight:600;color:var(--stone-dark)">${g.title}</div>
          <div style="font-size:.72rem;color:var(--stone);margin-top:2px">${g.sub}</div></div>
          <span style="margin-left:auto;font-size:1rem;flex-shrink:0;width:18px;text-align:center">${sel?'✓':''}</span>
        </button>`}).join('')}
      </div>
    </div>

    ${goals.length>=2?`
    <div id="tradeoffPanel" style="margin-bottom:1.2rem;border-radius:12px;overflow:hidden;border:1px solid #e0d0c0">
      <div style="background:linear-gradient(135deg,#fff5ee,#fef0e4);padding:.65rem 1rem;display:flex;align-items:center;gap:.5rem;border-bottom:1px solid #e8d8c8">
        <span style="font-size:1rem">⚖️</span>
        <span style="font-size:.82rem;font-weight:600;color:#8a5030">Ziel-Kombinationen & Kompromisse</span>
      </div>
      <div style="padding:.75rem 1rem;background:var(--warm-white)">
        ${(()=>{
          const CONFLICTS=[
            {a:'weight',b:'kidney',icon:'⚖️🫘',msg:'Hoher Protein-Bedarf (Gewicht) vs. niedriger Protein-Bedarf (Niere) — hier wurde <strong>moderat</strong> als Kompromiss gesetzt.'},
            {a:'weight',b:'liver',icon:'⚖️🟤',msg:'Hoher Protein-Bedarf (Gewicht) vs. niedriger Protein-Bedarf (Leber) — Kompromiss: <strong>moderat</strong>.'},
            {a:'gout',b:'osteo',icon:'🦶🦴',msg:'Purinarme Kost (Gicht) schränkt Hülsenfrüchte & Fleisch ein, die auch Kalziumquellen sein können. Milchprodukte bevorzugen.'},
            {a:'kidney',b:'osteo',icon:'🫘🦴',msg:'Phosphoreinschränkung (Niere) kann Kalziumaufnahme hemmen. Phosphatarme Kalziumquellen wählen.'},
            {a:'ibs',b:'osteo',icon:'🌿🦴',msg:'Low-FODMAP meidet viele Milchprodukte (Kalziumquelle). Laktosefreie Alternativen oder Anreicherung nötig.'},
            {a:'diabetes',b:'heart',icon:'💉❤️',msg:'Gute Kombi: beide profitieren von Ballaststoffen, niedrigem GI und wenig gesättigten Fetten.'},
            {a:'heart',b:'hypert',icon:'❤️🩺',msg:'Starke Synergie: beide profitieren von DASH-Prinzipien — wenig Natrium, viel Kalium, herzfreundliche Fette.'},
            {a:'kidney',b:'hypert',icon:'🫘🩺',msg:'Achtung: DASH empfiehlt <em>viel Kalium</em>, Nierenkrankheit erfordert <em>wenig Kalium</em> — Kaliumlevel ärztlich klären.'},
            {a:'gout',b:'kidney',icon:'🦶🫘',msg:'Gute Kombi: beide profitieren von purinarmer, natriumarmer Kost und viel Flüssigkeit.'},
            {a:'ibs',b:'healthy',icon:'🌿🥗',msg:'Low-FODMAP schränkt manche "gesunden" Lebensmittel ein (z.B. Zwiebeln, Hülsenfrüchte). Ausreichend Abwechslung achten.'},
          ];
          const synergies=[
            {a:'heart',b:'diabetes',note:'Starke Synergie'},
            {a:'heart',b:'hypert',note:'Starke Synergie'},
            {a:'weight',b:'diabetes',note:'Gut kombinierbar'},
            {a:'gout',b:'kidney',note:'Gut kombinierbar'},
          ];
          const rows=[];
          for(let i=0;i<goals.length;i++){
            for(let j=i+1;j<goals.length;j++){
              const a=goals[i],b=goals[j];
              const cf=CONFLICTS.find(c=>(c.a===a&&c.b===b)||(c.a===b&&c.b===a));
              if(cf){
                const isWarn=cf.msg.includes('Achtung');
                rows.push(`<div style="display:flex;gap:.7rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px solid #f0e8e0">
                  <span style="font-size:1.1rem;flex-shrink:0;margin-top:.1rem">${isWarn?'⚠️':cf.icon}</span>
                  <div style="font-size:.79rem;color:#5c3d2e;line-height:1.55">${cf.msg}</div>
                </div>`);
              } else {
                const syn=synergies.find(s=>(s.a===a&&s.b===b)||(s.a===b&&s.b===a));
                const g1=HEALTH_GOALS.find(h=>h.id===a),g2=HEALTH_GOALS.find(h=>h.id===b);
                if(syn){
                  rows.push(`<div style="display:flex;gap:.7rem;align-items:flex-start;padding:.5rem 0;border-bottom:1px solid #f0e8e0">
                    <span style="font-size:1.1rem;flex-shrink:0;margin-top:.1rem">✅</span>
                    <div style="font-size:.79rem;color:#3a6a40;line-height:1.55"><strong>${syn.note}</strong> — ${g1?.icon||''} ${g1?.title||a} + ${g2?.icon||''} ${g2?.title||b} ergänzen sich.</div>
                  </div>`);
                }
              }
            }
          }
          // Always show merged settings summary
          const RESTR_LABELS={none:'—',moderate:'Moderat',low:'Niedrig',very_low:'Sehr niedrig',high:'Hoch',strict:'Strikt'};
          const active=[
            S.sodium!=='none'&&`Na: ${RESTR_LABELS[S.sodium]||S.sodium}`,
            S.potassium!=='none'&&`K: ${RESTR_LABELS[S.potassium]||S.potassium}`,
            S.phosphorus!=='none'&&`P: ${RESTR_LABELS[S.phosphorus]||S.phosphorus}`,
            S.protein!=='moderate'&&`Protein: ${RESTR_LABELS[S.protein]||S.protein}`,
            S.oxalate!=='none'&&`Oxalat: ${RESTR_LABELS[S.oxalate]||S.oxalate}`,
            S.purine!=='none'&&`Purin: ${RESTR_LABELS[S.purine]||S.purine}`,
            S.calcium!=='none'&&`Ca: ${RESTR_LABELS[S.calcium]||S.calcium}`,
            S.fluid!=='none'&&`Flüssigkeit: ${RESTR_LABELS[S.fluid]||S.fluid}`,
          ].filter(Boolean);
          const summary=`<div style="margin-top:.35rem;padding:.45rem .6rem;background:#f5ede8;border-radius:8px;font-size:.75rem;color:#8a5030">
            <strong>Gesamte Einschränkungen (aus allen Zielen zusammengefasst):</strong><br/>
            ${active.length?active.join(' · '):'Keine aktiven Einschränkungen'}${S.calorieTarget?' · Ziel: '+S.calorieTarget+' kcal/Tag':''}
          </div>`;
          return (rows.length?rows.join(''):'<div style="font-size:.79rem;color:#8a7060;padding:.3rem 0">Keine direkten Konflikte zwischen den gewählten Zielen.</div>')+summary;
        })()}
      </div>
    </div>`:''}

    <div style="margin-bottom:1rem">
      ${S.haUsers.length?`
      <div class="lbl">Home Assistant Person</div>
      <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.7rem">
        ${S.haUsers.map(u=>{
          const sel=S.haUserId===u.id;
          return`<button data-hauser="${u.id}" style="display:flex;align-items:center;gap:.5rem;padding:.4rem .8rem;border:1.5px solid ${sel?'var(--terracotta)':'var(--border)'};background:${sel?'var(--terra-faint)':'white'};border-radius:20px;cursor:pointer;font-size:.82rem;color:${sel?'var(--terracotta)':'var(--stone-dark)'};font-weight:${sel?600:400}">
            ${u.picture?`<img src="${esc(u.picture)}" style="width:20px;height:20px;border-radius:50%;object-fit:cover" onerror="this.style.display='none'"/>`:'👤'}
            ${esc(u.name)}
            ${sel?'<span style="font-size:.8rem">✓</span>':''}
          </button>`;
        }).join('')}
      </div>`:''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem">
        <div><div class="lbl">Name</div><input id="pName" class="field" value="${esc(S.name)}" placeholder="z.B. Max"/></div>
        <div><div class="lbl">Geschlecht</div>
          <div style="display:flex;gap:.4rem;margin-top:.3rem">
            ${[['','–'],['male','♂ Männlich'],['female','♀ Weiblich'],['other','Divers']].map(([v,l])=>
              `<button data-gender="${v}" style="flex:1;padding:.35rem .1rem;border:1.5px solid ${S.gender===v?'var(--terracotta)':'var(--border)'};background:${S.gender===v?'var(--terra-faint)':'white'};border-radius:8px;cursor:pointer;font-size:.72rem;color:${S.gender===v?'var(--terracotta)':'var(--stone)'};font-weight:${S.gender===v?600:400};white-space:nowrap">${l}</button>`
            ).join('')}
          </div>
        </div>
      </div>
    </div>

    ${hasGoal('kidney')?`
    <div class="sec-title">Nierendiät-Preset</div>
    <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:1.2rem">
      ${PRESET_LABELS.map(([k,l])=>`<button class="pill${S.preset===k?' active':''}" data-ppset="${k}" style="font-size:.75rem">${l}</button>`).join('')}
    </div>
    <div class="sec-title">Elektrolyte &amp; Mineralstoffe</div>
    ${rChip('Kalium','potassium',[['none','Keine Einschränkung'],['moderate','Moderat'],['low','Niedrig'],['very_low','Sehr niedrig']])}
    ${rChip('Phosphor','phosphorus',[['none','Keine Einschränkung'],['moderate','Moderat'],['low','Niedrig']])}
    ${rChip('Natrium','sodium',[['none','Keine Einschränkung'],['moderate','Moderat'],['low','Niedrig']])}
    ${rChip('Kalzium','calcium',[['none','Keine Einschränkung'],['moderate','Moderat'],['low','Niedrig']])}
    ${rChip('Flüssigkeit','fluid',[['none','Keine Einschränkung'],['moderate','Max 1,5L / Tag'],['strict','Max 750ml / Tag']])}
    <div class="sec-title" style="margin-top:1rem">Protein &amp; Metabolismus</div>
    ${rChip('Protein','protein',[['moderate','Moderat 0,8g/kg'],['low','Niedrig 0,6g/kg'],['high','Hoch 1,2g/kg']])}
    ${rChip('Oxalat','oxalate',[['none','Keine Einschränkung'],['low','Niedrig Oxalat']])}
    ${rChip('Purin','purine',[['none','Keine Einschränkung'],['low','Niedrig Purin']])}
    <div class="sec-title" style="margin-top:1rem">Zusatzoptionen</div>
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('heartHealthy','Herzfreundlich','Wenig gesättigte Fette — empfohlen bei CKD')}
      ${tog('diabetic','Diabetikerfreundlich','Niedriger glykämischer Index')}
      ${tog('glutenFree','Glutenfrei','Zöliakie oder Glutenunverträglichkeit')}
    </div>`:''}

    ${hasGoal('weight')?`
    <div class="sec-title">Gewichtsabnahme</div>
    ${rChip('Protein','protein',[['high','Hoch 1,2g/kg — sättigt länger'],['moderate','Moderat 0,8g/kg']])}
    ${rChip('Natrium','sodium',[['none','Keine Einschränkung'],['moderate','Moderat — weniger Wasserretention']])}
    ${calTarget}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('heartHealthy','Herzfreundlich','Wenig gesättigte Fette')}
      ${tog('diabetic','Zuckerkontrolle','Niedriger glykämischer Index')}
      ${tog('glutenFree','Glutenfrei','Zöliakie oder Überempfindlichkeit')}
    </div>`:''}

    ${hasGoal('healthy')?`
    <div class="sec-title">Gesunde Ernährung</div>
    ${rChip('Protein','protein',[['moderate','Moderat 0,8g/kg'],['high','Hoch 1,2g/kg']])}
    ${rChip('Natrium','sodium',[['none','Keine Einschränkung'],['moderate','Moderat']])}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('heartHealthy','Herzfreundlich','Wenig gesättigte Fette')}
      ${tog('diabetic','Zuckerkontrolle','Niedriger GI')}
      ${tog('glutenFree','Glutenfrei','')}
      ${tog('lactose','Laktosefrei','Milchzuckerunverträglichkeit')}
      ${tog('histamine','Histaminarm','Histaminintoleranz')}
    </div>`:''}

    ${hasGoal('diabetes')?`
    <div class="sec-title">Diabetes</div>
    ${rChip('Natrium','sodium',[['moderate','Moderat'],['none','Keine Einschränkung']])}
    ${rChip('Protein','protein',[['moderate','Moderat 0,8g/kg'],['high','Hoch 1,2g/kg']])}
    ${calTarget}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('diabetic','Zuckerkontrolle (Pflicht)','Niedriger GI, wenig einfache Zucker')}
      ${tog('heartHealthy','Herzfreundlich','Empfohlen bei Diabetes Typ 2')}
      ${tog('hypertension','Bluthochdruck','Zusätzliche Natriumreduktion')}
    </div>`:''}

    ${hasGoal('heart')?`
    <div class="sec-title">Herzgesundheit</div>
    ${rChip('Natrium','sodium',[['low','Niedrig — Blutdruckkontrolle'],['moderate','Moderat'],['none','Keine']])}
    ${rChip('Protein','protein',[['moderate','Moderat 0,8g/kg'],['high','Hoch 1,2g/kg']])}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('heartHealthy','Herzfreundlich (Pflicht)','Wenig gesättigte Fette')}
      ${tog('diabetic','Zuckerkontrolle','Niedriger GI')}
      ${tog('hypertension','Bluthochdruck','Mehr Natrium- & Kaliumfokus')}
    </div>`:''}

    ${hasGoal('hypert')?`
    <div class="sec-title">Bluthochdruck (DASH-Diät)</div>
    <div style="margin-bottom:.8rem;padding:.65rem .9rem;background:#f0f8fb;border:1px solid #b8d8ec;border-radius:9px;font-size:.8rem;color:#3a6a8a;line-height:1.5">
      💡 Die DASH-Diät senkt den Blutdruck durch viel Kalium (Obst, Gemüse), wenig Natrium und gesättigte Fette.
    </div>
    ${rChip('Natrium','sodium',[['low','Niedrig &lt;1500mg/Tag'],['moderate','Moderat &lt;2300mg/Tag'],['none','Keine']])}
    ${rChip('Kalium','potassium',[['none','Keine Einschränkung (DASH: hoch)'],['moderate','Moderat'],['low','Niedrig']])}
    ${rChip('Protein','protein',[['moderate','Moderat'],['high','Hoch — mehr mageres Protein']])}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('heartHealthy','Herzfreundlich','Wenig gesättigte Fette — zentral')}
      ${tog('hypertension','Bluthochdruck-Modus','Aktiviert blutdrucksenkende Rezepthinweise')}
      ${tog('diabetic','Zuckerkontrolle','Niedriger GI')}
    </div>`:''}

    ${hasGoal('gout')?`
    <div class="sec-title">Gicht</div>
    <div style="margin-bottom:.8rem;padding:.65rem .9rem;background:#fff8f0;border:1px solid #f0d0a8;border-radius:9px;font-size:.8rem;color:#8a5a20;line-height:1.5">
      💡 Purinarme Ernährung reduziert Harnsäure. Innereien, rotes Fleisch, Meeresfrüchte und Alkohol strikt meiden.
    </div>
    ${rChip('Purin','purine',[['low','Niedrig Purin — essenziell'],['none','Keine']])}
    ${rChip('Natrium','sodium',[['moderate','Moderat'],['none','Keine']])}
    ${rChip('Protein','protein',[['moderate','Moderat'],['low','Niedrig']])}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('gout','Gicht-Modus','Betont Harnsäure-senkende Lebensmittel')}
      ${tog('heartHealthy','Herzfreundlich','Gicht erhöht Herzrisiko')}
    </div>`:''}

    ${hasGoal('stones')?`
    <div class="sec-title">Nierensteine</div>
    <div style="margin-bottom:.8rem;padding:.65rem .9rem;background:#f0f8f1;border:1px solid #b8dbbe;border-radius:9px;font-size:.8rem;color:#4a7a55;line-height:1.5">
      💡 Mind. 2–3L Wasser täglich ist die wirksamste Maßnahme gegen Nierensteine aller Art.
    </div>
    ${rChip('Oxalat (Kalziumsteine)','oxalate',[['none','Keine Einschränkung'],['low','Niedrig Oxalat']])}
    ${rChip('Purin (Harnsäuresteine)','purine',[['none','Keine Einschränkung'],['low','Niedrig Purin']])}
    ${rChip('Natrium','sodium',[['moderate','Moderat'],['none','Keine']])}
    ${rChip('Kalzium','calcium',[['moderate','Moderat — nicht zu wenig!'],['none','Keine']])}
    ${rChip('Flüssigkeit','fluid',[['moderate','Viel — mind. 2L'],['none','Keine']])}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('heartHealthy','Herzfreundlich','')}
    </div>`:''}

    ${hasGoal('ibs')?`
    <div class="sec-title">Reizdarm / IBS</div>
    <div style="margin-bottom:.8rem;padding:.65rem .9rem;background:#f8f5fc;border:1px solid #d0c0e8;border-radius:9px;font-size:.8rem;color:#6a4a90;line-height:1.5">
      💡 Low-FODMAP reduziert fermentierbare Kohlenhydrate, die bei IBS Symptome auslösen können.
    </div>
    ${rChip('Protein','protein',[['moderate','Moderat'],['high','Hoch']])}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('ibs','Low-FODMAP-Modus','Vermeidet Zwiebeln, Knoblauch, Weizen, Hülsenfrüchte, Laktose etc.')}
      ${tog('glutenFree','Glutenfrei / Weizenfrei','Zöliakie oder NCGS')}
      ${tog('lactose','Laktosefrei','Milchzuckerunverträglichkeit')}
      ${tog('histamine','Histaminarm','Histaminintoleranz')}
    </div>`:''}

    ${hasGoal('osteo')?`
    <div class="sec-title">Osteoporose</div>
    <div style="margin-bottom:.8rem;padding:.65rem .9rem;background:#fdf8f0;border:1px solid #e8d8b0;border-radius:9px;font-size:.8rem;color:#8a6820;line-height:1.5">
      💡 Kalzium + Vitamin D + Protein schützen die Knochendichte. Wenig Salz und Phosphat helfen Kalzium zu halten.
    </div>
    ${rChip('Kalzium','calcium',[['moderate','Moderat (empfohlen)'],['none','Keine']])}
    ${rChip('Phosphor','phosphorus',[['moderate','Moderat — zu viel hemmt Kalzium'],['none','Keine']])}
    ${rChip('Protein','protein',[['moderate','Moderat'],['high','Hoch — stärkt Knochen']])}
    ${rChip('Natrium','sodium',[['moderate','Moderat — Salz erhöht Kalziumverlust'],['none','Keine']])}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('osteoporosis','Osteoporose-Modus','Hebt Kalzium- & Vitamin-D-reiche Zutaten hervor')}
      ${tog('heartHealthy','Herzfreundlich','')}
    </div>`:''}

    ${hasGoal('liver')?`
    <div class="sec-title">Lebererkrankung</div>
    <div style="margin-bottom:.8rem;padding:.65rem .9rem;background:#f5f0ea;border:1px solid #d8c8a8;border-radius:9px;font-size:.8rem;color:#6a5030;line-height:1.5">
      💡 Bei Leberzirrhose zusätzlich Proteineinschränkung ärztlich klären. Kein Alkohol.
    </div>
    ${rChip('Natrium','sodium',[['low','Niedrig — verhindert Aszites'],['moderate','Moderat'],['none','Keine']])}
    ${rChip('Protein','protein',[['moderate','Moderat'],['low','Niedrig (Zirrhose)']])}
    ${rChip('Phosphor','phosphorus',[['none','Keine'],['moderate','Moderat']])}
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('liver','Leber-Modus','Meidet fettreiche Lebensmittel & Alkohol')}
      ${tog('heartHealthy','Herzfreundlich','Wenig gesättigte Fette')}
      ${tog('diabetic','Zuckerkontrolle','Hepatische Insulinresistenz häufig')}
    </div>`:''}

    ${hasGoal('custom')?`
    <div class="sec-title">Alle Einstellungen</div>
    ${rChip('Kalium','potassium',[['none','Keine'],['moderate','Moderat'],['low','Niedrig'],['very_low','Sehr niedrig']])}
    ${rChip('Phosphor','phosphorus',[['none','Keine'],['moderate','Moderat'],['low','Niedrig']])}
    ${rChip('Natrium','sodium',[['none','Keine'],['moderate','Moderat'],['low','Niedrig']])}
    ${rChip('Kalzium','calcium',[['none','Keine'],['moderate','Moderat'],['low','Niedrig']])}
    ${rChip('Flüssigkeit','fluid',[['none','Keine'],['moderate','Max 1,5L'],['strict','Max 750ml']])}
    ${rChip('Protein','protein',[['moderate','Moderat'],['low','Niedrig'],['high','Hoch']])}
    ${rChip('Oxalat','oxalate',[['none','Keine'],['low','Niedrig']])}
    ${rChip('Purin','purine',[['none','Keine'],['low','Niedrig']])}
    <div class="sec-title" style="margin-top:.8rem">Zusatzoptionen</div>
    <div style="display:flex;flex-direction:column;gap:.45rem;margin-bottom:1rem">
      ${tog('heartHealthy','Herzfreundlich','Wenig gesättigte Fette')}
      ${tog('diabetic','Diabetikerfreundlich','Niedriger GI')}
      ${tog('glutenFree','Glutenfrei','')}
      ${tog('hypertension','Bluthochdruck','DASH-Fokus')}
      ${tog('gout','Gicht','Purinarm')}
      ${tog('osteoporosis','Osteoporose','Kalziumreich')}
      ${tog('ibs','Reizdarm','Low-FODMAP')}
      ${tog('lactose','Laktosefrei','')}
      ${tog('histamine','Histaminarm','')}
      ${tog('liver','Lebererkrankung','')}
    </div>
    ${calTarget}`:''}

    ${anyGoal?`
    <div class="sec-title">Präferenzen</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.8rem;margin-bottom:.8rem">
      <div><div class="lbl">Einheiten</div><select id="pUnits" class="field">${opts([['metric','Metrisch'],['imperial','Imperial']],S.units)}</select></div>
      <div><div class="lbl">Ernährungsstil</div><select id="pDietStyle" class="field">${opts([['omnivore','Alles'],['vegetarian','Vegetarisch'],['vegan','Vegan'],['pescatarian','Pescetarisch']],S.dietStyle)}</select></div>
    </div>
    <div><div class="lbl">Notizen / Allergien</div><input id="pExtras" class="field" value="${esc(S.extras)}" placeholder="z.B. keine Meeresfrüchte, weiche Texturen…"/></div>`:''}

    ${S.profileSaved?`<div style="margin-top:.8rem;padding:.6rem .9rem;background:#f0f8f1;border:1px solid #b8dbbe;border-radius:8px;font-size:.82rem;color:#4a7a55;text-align:center">✓ In Home Assistant gespeichert</div>`:''}
  `;
}


function renderProfile(){
  const hasSaved = S.profiles.length > 0;
  document.getElementById('profileBody').innerHTML=`
    ${hasSaved?`<div style="margin-bottom:1.2rem">
      <div class="lbl">Profil wechseln</div>
      <div style="display:flex;flex-direction:column;gap:.4rem;margin-bottom:.6rem">
        ${S.profiles.map(p=>{const pGoals=(p.healthGoals||(p.healthGoal?[p.healthGoal]:[]));const gArr=pGoals.map(id=>HEALTH_GOALS.find(h=>h.id===id)).filter(Boolean);const g=gArr[0]||null;return`<div style="display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;border-radius:9px;border:1.5px solid ${p.id===S.activeProfileId?'#c4684a':'#e8d8c8'};background:${p.id===S.activeProfileId?'#fff5ee':'white'};cursor:pointer" data-switchprofile="${p.id}">
          ${g?`<span style="font-size:1.2rem">${g.icon}</span>`:''}
          <div style="flex:1">
            <div style="font-size:.86rem;font-weight:${p.id===S.activeProfileId?600:400};color:${p.id===S.activeProfileId?'#c4684a':'#2d1f17'}">${esc(p.name||'Unnamed')}</div>
            <div style="font-size:.7rem;color:#8a7060">${g?g.title:'Kein Ziel gesetzt'}</div>
          </div>
          ${p.id===S.activeProfileId?'<span style="font-size:.75rem;color:#c4684a;font-weight:600">Aktiv</span>':''}
          <button data-deleteprofile="${p.id}" style="border:none;background:none;cursor:pointer;color:#c4684a;font-size:.8rem;padding:.15rem .3rem;opacity:.6" title="Löschen">✕</button>
        </div>`;}).join('')}
      </div>
      <button id="newProfileBtn" style="width:100%;padding:.5rem;border:1.5px dashed #e8d8c8;border-radius:9px;background:none;cursor:pointer;font-size:.83rem;color:#8a7060">+ Neues Profil</button>
    </div>`:`<div style="padding:.8rem 1rem;background:#f4f9fc;border:1px solid #c5dcec;border-radius:10px;font-size:.82rem;color:#4a7a9b;margin-bottom:1.2rem;line-height:1.5">Wähle unten dein Gesundheitsziel und tippe <strong>Profil speichern</strong> um zu beginnen.</div>`}
    ${profileFields()}
  `;
  // bind profile-specific events
  const pn=document.getElementById('pName');if(pn)pn.addEventListener('input',e=>S.name=e.target.value);
  const pu=document.getElementById('pUnits');if(pu)pu.addEventListener('change',e=>{S.units=e.target.value;});
  const pd=document.getElementById('pDietStyle');if(pd)pd.addEventListener('change',e=>{S.dietStyle=e.target.value;});
  const pe=document.getElementById('pExtras');if(pe)pe.addEventListener('input',e=>{S.extras=e.target.value;});
  const pc=document.getElementById('pCalTarget');if(pc)pc.addEventListener('input',e=>{S.calorieTarget=parseInt(e.target.value)||0;});
  document.querySelectorAll('[data-hauser]').forEach(btn=>{btn.addEventListener('click',()=>{
    const uid=btn.dataset.hauser;
    const u=S.haUsers.find(x=>x.id===uid);
    S.haUserId=S.haUserId===uid?null:uid;
    if(u&&S.haUserId)S.name=S.name||u.name;
    renderProfile();
  });});
  document.querySelectorAll('[data-gender]').forEach(btn=>{btn.addEventListener('click',()=>{S.gender=btn.dataset.gender;renderProfile();});});
  document.querySelectorAll('[data-rchip]').forEach(sel=>{sel.addEventListener('change',e=>{S[e.target.dataset.rchip]=e.target.value;renderProfile();});});
  document.querySelectorAll('#profileBody [data-toggle]').forEach(el=>{el.addEventListener('click',()=>{const k=el.dataset.toggle;S[k]=!S[k];renderProfile();});});
  document.querySelectorAll('[data-ppset]').forEach(btn=>{btn.addEventListener('click',()=>applyPreset(btn.dataset.ppset));});
  document.querySelectorAll('[data-togglegoal]').forEach(btn=>{btn.addEventListener('click',()=>{toggleGoal(btn.dataset.togglegoal);renderProfile();});});
  document.querySelectorAll('[data-switchprofile]').forEach(el=>{el.addEventListener('click',e=>{if(e.target.dataset.deleteprofile)return;loadProfile(el.dataset.switchprofile);});});
  document.querySelectorAll('[data-deleteprofile]').forEach(btn=>{btn.addEventListener('click',e=>{e.stopPropagation();deleteProfile(btn.dataset.deleteprofile);});});
  const nb=document.getElementById('newProfileBtn');if(nb)nb.addEventListener('click',newProfile);
}

function rChip(label,key,pairs){
  return`<div class="restriction-chip">
    <div><div class="chip-label">${label}</div></div>
    <div class="chip-select"><select data-rchip="${key}">${pairs.map(([v,l])=>`<option value="${v}"${v===S[key]?' selected':''}>${l}</option>`).join('')}</select></div>
  </div>`;
}

function openProfile(){
  S.profileOpen=true;S.profileSaved=false;
  document.getElementById('overlay').classList.add('open');
  document.getElementById('profilePanel').classList.add('open');
  renderProfile();
}
function closeProfile(){
  S.profileOpen=false;
  document.getElementById('overlay').classList.remove('open');
  document.getElementById('profilePanel').classList.remove('open');
}

// ── Render ────────────────────────────────────────────────────────────────────
function render(){document.getElementById('app').innerHTML=buildApp();bindEvents();}
function update(changes){Object.assign(S,changes);render();}

function buildApp(){
  if(!S.ready)return`<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;color:#8a7060">Loading&#8230;</div>`;
  const noKey=!S.configured?`<div class="no-key-banner">⚠ <strong>Anthropic API key not set.</strong> Go to <strong>Settings → Add-ons → RenalKitchen → Configuration</strong> and enter your key, then restart the addon.</div>`:'';
  const profileInitials=S.name?S.name[0].toUpperCase():'👤';
  const profileName=S.name||(S.profiles.length>1?`${S.profiles.length} profiles`:'Profil einrichten');
  const favCount=S.favs.length>0?`<span style="background:#c4684a;color:white;border-radius:999px;font-size:.65rem;padding:.1rem .4rem;font-weight:600;margin-left:.3rem">${S.favs.length}</span>`:'';
  const goalObjs=(S.healthGoals||[]).map(id=>HEALTH_GOALS.find(g=>g.id===id)).filter(Boolean);
  const tagline=goalObjs.length===0?'Smarter <em style="color:var(--terracotta);font-style:italic">essen</em>':goalObjs.length===1?goalObjs[0].icon+' <em style="color:var(--terracotta);font-style:italic">'+goalObjs[0].title+'</em>':goalObjs.map(g=>g.icon).join(' ')+'<em style="color:var(--terracotta);font-style:italic"> '+goalObjs.length+' Ziele</em>';
  return`<div style="background:var(--cream);min-height:100vh">
  <div style="background:linear-gradient(160deg,#fff5ec,var(--warm-white) 60%);border-bottom:1px solid var(--border);box-shadow:0 2px 16px var(--shadow)">
    <div style="max-width:880px;margin:0 auto;padding:1.1rem 1.2rem .9rem;display:flex;align-items:center;justify-content:space-between;gap:1rem">
      <div>
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.2rem">
          <div style="width:26px;height:26px;background:linear-gradient(135deg,var(--terracotta),var(--terra-light));border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.9rem;box-shadow:0 2px 6px rgba(196,104,74,.3)">🍽</div>
          <span style="font-family:Georgia,serif;font-size:.88rem;color:var(--stone);letter-spacing:.3px">RenalKitchen</span>
        </div>
        <div style="font-family:Georgia,serif;font-size:clamp(1.2rem,4vw,1.7rem);color:var(--stone-dark);line-height:1.15">${tagline}</div>
      </div>
      <button id="openProfileBtn" style="display:flex;flex-direction:column;align-items:center;gap:.3rem;border:none;background:none;cursor:pointer;flex-shrink:0">
        <div class="profile-avatar${S.profileOpen?' active':''}" style="background:linear-gradient(135deg,var(--terracotta),var(--terra-light));width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${S.name?'1.05rem':'1rem'};font-weight:700;color:white;box-shadow:0 3px 10px rgba(196,104,74,.35)">${profileInitials}</div>
        <div style="font-size:.63rem;color:var(--stone);white-space:nowrap;max-width:64px;overflow:hidden;text-overflow:ellipsis">${esc(profileName)}</div>
      </button>
    </div>
    <div style="max-width:880px;margin:0 auto;padding:0 1.2rem .9rem;display:flex;gap:.5rem;justify-content:center">
      <button class="tab${S.tab==='generate'?' active':''}" data-tab="generate">✨ Generieren</button>
      <button class="tab${S.tab==='menu'?' active':''}" data-tab="menu">📋 Menü</button>
      <button class="tab${S.tab==='tracker'?' active':''}" data-tab="tracker">📊 Tagebuch</button>
      <button class="tab${S.tab==='favourites'?' active':''}" data-tab="favourites">★ Favoriten${favCount}</button>
      <button class="tab${S.tab==='pantry'?' active':''}" data-tab="pantry">🧊 Vorrat</button>
    </div>
  </div>
  <div style="max-width:880px;margin:0 auto;padding:1.3rem 1.1rem 3rem">
    ${noKey}
    ${buildProfileSummary()}
    ${S.tab==='favourites'?buildFavs():S.tab==='menu'?buildMenu():S.tab==='tracker'?buildTracker():S.tab==='pantry'?buildPantry():buildGenerate()}
    <div style="text-align:center;padding-top:1.5rem;font-size:.73rem;color:var(--stone-light);border-top:1px solid var(--border);margin-top:.5rem;line-height:1.6">
      Ernährungsangaben sind Schätzwerte. Bei medizinischen Ernährungsfragen immer Rücksprache mit einem Arzt oder Ernährungsberater halten.
    </div>
  </div>
</div>`;
}

function buildProfileSummary(){
  const goalObjs2=(S.healthGoals||[]).map(id=>HEALTH_GOALS.find(g=>g.id===id)).filter(Boolean);
  if(!goalObjs2.length){
    return`<div style="background:linear-gradient(135deg,#fff5ee,#fff0e8);border:1px solid #e8937a;border-radius:10px;padding:.65rem 1rem;margin-bottom:1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem">
      <div style="font-size:.83rem;color:#8a7060">Kein Ziel gesetzt — <strong style="color:#c4684a">Profil antippen</strong> um loszulegen</div>
      <button id="openProfileBtn2" style="padding:.3rem .75rem;background:#c4684a;color:white;border:none;border-radius:7px;font-size:.78rem;cursor:pointer;white-space:nowrap">Einrichten ↗</button>
    </div>`;
  }
  const chips=[];
  if(S.potassium!=='none')chips.push({l:'K',c:'#7a5c9e'});
  if(S.phosphorus!=='none')chips.push({l:'P',c:'#4a7a9b'});
  if(S.sodium!=='none')chips.push({l:'Na',c:'#c4684a'});
  if(S.fluid!=='none')chips.push({l:'💧',c:'#5a9e8e'});
  if(S.protein==='low')chips.push({l:'Prot↓',c:'#7a9e5a'});
  if(S.protein==='high')chips.push({l:'Prot↑',c:'#7a9e5a'});
  if(S.heartHealthy)chips.push({l:'❤',c:'#c04a5a'});
  if(S.diabetic)chips.push({l:'DM',c:'#8a7a4a'});
  if(S.oxalate!=='none')chips.push({l:'Oxa',c:'#9e7a5a'});
  if(S.purine!=='none')chips.push({l:'Pur',c:'#6a7a4a'});
  if(S.hypertension)chips.push({l:'🩺',c:'#4a6a9b'});
  if(S.gout)chips.push({l:'🦶',c:'#9b7a4a'});
  if(S.ibs)chips.push({l:'🌿',c:'#5a8a6a'});
  if(S.histamine)chips.push({l:'Hi',c:'#8a4a9b'});
  if(S.lactose)chips.push({l:'Lak',c:'#6a8a9b'});
  if(S.calorieTarget>0)chips.push({l:S.calorieTarget+'kcal',c:'#c4684a'});
  return`<div style="background:linear-gradient(135deg,#fff5ee,#fff0e8);border:1px solid #e8937a;border-radius:10px;padding:.55rem 1rem;margin-bottom:1rem;display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">
    ${goalObjs2.map(g=>`<span style="font-size:1rem">${g.icon}</span><span style="font-size:.8rem;font-weight:600;color:#c4684a">${g.title}</span>`).join('<span style="color:#e8d0c0">·</span>')}
    ${chips.map(c=>`<span style="padding:.18rem .5rem;background:${c.c}22;border:1px solid ${c.c}44;border-radius:999px;font-size:.72rem;color:${c.c};font-weight:600">${c.l}</span>`).join('')}
    <span style="margin-left:auto;display:flex;align-items:center;gap:.4rem">
      ${S.gender==='male'?'<span title="Männlich">♂</span>':S.gender==='female'?'<span title="Weiblich">♀</span>':S.gender==='other'?'<span>⚧</span>':''}
      ${S.name?`<span style="font-size:.74rem;color:#8a7060;font-style:italic">${esc(S.name)}</span>`:''}
      ${S.haUserId?`<span title="HA verknüpft" style="font-size:.8rem">🏠</span>`:''}
    </span>
  </div>`;
}

// ── Favourites ────────────────────────────────────────────────────────────────
function buildFavs(){
  if(!S.favLoaded)return`<div style="text-align:center;padding:2rem;color:#8a7060">Loading&#8230;</div>`;
  if(!S.favs.length)return`<div class="card"><div style="text-align:center;padding:1.5rem"><div style="font-size:2rem;margin-bottom:.75rem">☆</div><div style="font-family:Georgia,serif;font-size:1.1rem;color:#5c3d2e;margin-bottom:.4rem">No favourites yet</div><div style="font-size:.84rem;color:#8a7060">Generate recipes and tap ☆ to save them here.</div></div></div>`;
  return`<div><div style="margin-bottom:1rem;padding-bottom:.7rem;border-bottom:1px solid #e8d8c8"><div style="font-size:.74rem;text-transform:uppercase;letter-spacing:1px;color:#4a7a55;font-weight:500;margin-bottom:.2rem">${S.favs.length} saved recipe${S.favs.length>1?'s':''} — stored in Home Assistant</div><div style="font-family:Georgia,serif;font-size:1.45rem;color:#5c3d2e">Your favourite recipes</div></div>
  ${S.favs.map((r,i)=>{
    const isEditing=S.editingFav===i;
    return`<div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:-.5rem;position:relative;z-index:2">
        <span class="fav-badge">Saved ${esc(r.savedAt)}</span>
        <button data-favedittoggle="${i}" style="border:none;background:none;cursor:pointer;font-size:.78rem;color:${isEditing?'#c4684a':'#8a7060'};padding:.2rem .5rem;font-weight:${isEditing?600:400}">${isEditing?'✕ Cancel edit':'✏️ Edit'}</button>
      </div>
      ${isEditing?buildFavEditor(r,i):buildRecipeCard(r,'fav',i)}
    </div>`;
  }).join('')}</div>`;
}

function buildFavEditor(r,i){
  return`<div class="recipe-card" style="border-color:#c4684a">
    <div class="recipe-head" style="background:linear-gradient(135deg,#fff5ee,#fef9f5)">
      <div style="font-family:Georgia,serif;font-size:1rem;color:#c4684a;margin-bottom:.75rem;display:flex;align-items:center;gap:.4rem">✏️ Editing recipe</div>
      <div style="margin-bottom:.9rem">
        <div class="lbl">Recipe name</div>
        <input id="favEditName_${i}" class="field" value="${esc(r.name)}" style="font-family:Georgia,serif;font-size:1rem"/>
      </div>
      <div style="display:flex;gap:.6rem">
        <div style="flex:1"><div class="lbl">Prep time</div><input id="favEditPrep_${i}" class="field" value="${esc(r.prepTime||'')}"/></div>
        <div style="flex:1"><div class="lbl">Cook time</div><input id="favEditCook_${i}" class="field" value="${esc(r.cookTime||'')}"/></div>
      </div>
    </div>
    <div style="padding:1.2rem">
      <div class="lbl" style="margin-bottom:.4rem">Tipp / Beschreibung</div>
      <textarea id="favEditTip_${i}" rows="2" class="field" style="resize:vertical;line-height:1.5;margin-bottom:1rem">${esc(r.kidneyTip||'')}</textarea>
      <div class="lbl" style="margin-bottom:.4rem">Personal notes <span style="text-transform:none;letter-spacing:0;font-weight:400;font-size:.7rem;color:#8a7060">— your own comments, variations, reminders</span></div>
      <textarea id="favEditNotes_${i}" rows="2" class="field" style="resize:vertical;line-height:1.5;margin-bottom:1rem">${esc(r.notes||'')}</textarea>
      <div class="lbl" style="margin-bottom:.4rem">Instructions <span style="text-transform:none;letter-spacing:0;font-weight:400;font-size:.7rem;color:#8a7060">— one step per line</span></div>
      <textarea id="favEditInstr_${i}" rows="${(r.instructions||[]).length+2}" class="field" style="resize:vertical;line-height:1.7;font-size:.85rem;margin-bottom:1rem">${(r.instructions||[]).map(esc).join('\n')}</textarea>
      <div class="lbl" style="margin-bottom:.4rem">Ingredients <span style="text-transform:none;letter-spacing:0;font-weight:400;font-size:.7rem;color:#8a7060">— one per line</span></div>
      <textarea id="favEditIngs_${i}" rows="${(r.ingredients||[]).length+2}" class="field" style="resize:vertical;line-height:1.7;font-size:.85rem;margin-bottom:1.2rem">${(r.ingredients||[]).map(esc).join('\n')}</textarea>
      <button data-favsave="${i}" class="btn-main">Save changes</button>
    </div>
  </div>`;
}

// ── Menu ──────────────────────────────────────────────────────────────────────
function buildMenu(){
  const hasText=S.menuText.trim();
  const imgs=S.menuImages;
  const anyActive=imgs.some(i=>i.status==='active'||i.status==='pending');

  const imgQueue=imgs.length?`<div style="margin-bottom:.6rem">
    ${imgs.map(img=>`<div class="img-chip ${img.status}">
      <span style="font-size:1rem">${img.status==='done'?'✓':img.status==='error'?'✗':img.status==='active'?'⟳':'⏳'}</span>
      <div style="flex:1;overflow:hidden">
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${img.status==='done'?'#3a6a40':img.status==='error'?'#c4684a':'var(--stone-dark)'}">${esc(img.name)}</div>
        ${img.status==='error'?`<div style="font-size:.7rem;color:#c4684a">${esc(img.errorMsg||'Fehler beim Lesen')}</div>`:''}
      </div>
      ${img.status==='active'?`<span style="font-size:.72rem;color:var(--terracotta);font-weight:600">…</span>`:''}
      ${img.status==='done'||img.status==='error'?`<button data-removeimg="${img.id}" style="border:none;background:none;cursor:pointer;color:#8a7060;font-size:.9rem;padding:.1rem .3rem;flex-shrink:0">✕</button>`:''}
    </div>`).join('')}
  </div>`:''

  return`<div><div class="card">
    <div class="sec-title">Restaurant-Menü analysieren</div>
    <p style="font-size:.83rem;color:#8a7060;margin-bottom:1.1rem;line-height:1.5">Speisekarten-Fotos hochladen — Claude liest den Text direkt aus den Bildern. Mehrere Bilder werden kombiniert.</p>

    <div style="margin-bottom:1.1rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.55rem">
        <div class="lbl" style="margin:0">📷 Speisekarten-Fotos</div>
        ${imgs.length?`<button data-clearallimgs="1" style="border:none;background:none;cursor:pointer;font-size:.75rem;color:var(--stone)">Alle löschen</button>`:''}
      </div>
      ${imgQueue}
      ${anyActive?`
        <div style="background:var(--terra-faint);border:1px solid #e8937a;border-radius:10px;padding:.75rem 1rem;margin-bottom:.4rem">
          <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem">
            <span style="font-size:1.1rem;animation:spin 1s linear infinite;display:inline-block">⟳</span>
            <span style="font-size:.84rem;font-weight:600;color:var(--terracotta)">Claude liest Bilder…</span>
          </div>
          <div style="height:4px;background:#f0d0c0;border-radius:2px;overflow:hidden">
            <div style="height:100%;background:var(--terracotta);border-radius:2px;animation:pulse 1.5s ease-in-out infinite;width:60%"></div>
          </div>
          <div style="font-size:.72rem;color:var(--stone);margin-top:.4rem">${S.menuImages.filter(i=>i.status==='done').length}/${S.menuImages.length} fertig</div>
        </div>
      `:''}
      <label for="galleryInputPersist" style="width:100%;display:flex;align-items:center;gap:.8rem;padding:.8rem 1rem;background:${anyActive?'#f5f0ec':'var(--warm-white)'};border:1.5px dashed ${anyActive?'#c8b8a8':'var(--border)'};border-radius:10px;cursor:${anyActive?'not-allowed':'pointer'};font-size:.88rem;color:var(--stone-dark);font-weight:500;box-sizing:border-box;pointer-events:${anyActive?'none':'auto'}">
        <span style="font-size:1.3rem">🖼️</span>
        <div style="text-align:left"><div>${anyActive?'Warte auf Abschluss…':'Bilder auswählen (mehrere möglich)'}</div><div style="font-size:.72rem;color:var(--stone);font-weight:400;margin-top:1px">Claude liest Text direkt aus dem Foto</div></div>
      </label>
      ${S.ocrError?`<div style="background:#fff0ee;border:1px solid #e8937a;border-radius:8px;padding:.5rem .75rem;margin-top:.4rem;font-size:.78rem;color:#c4684a">⚠ ${esc(S.ocrError)}</div>`:''} 
    </div>

    <div style="margin-bottom:1.1rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.45rem">
        <div class="lbl" style="margin:0">✏️ Erkannter / eingegebener Text</div>
        ${hasText?`<button data-clearmenutext="1" style="border:none;background:none;cursor:pointer;font-size:.75rem;color:var(--stone)">Löschen</button>`:''}
      </div>
      <textarea id="menuText" rows="7" class="field" style="resize:vertical;line-height:1.5;font-size:.84rem" placeholder="Vorspeisen:&#10;- Caesar Salat&#10;Hauptgerichte:&#10;- Gegrillter Lachs">${esc(S.menuText)}</textarea>
    </div>

    ${hasText&&!anyActive?`<button class="btn-main" id="analyzeMenuBtn" ${S.menuLoading?'disabled':''}>${S.menuLoading?'Analysiere…':'Menü für mein Profil analysieren'}</button>`:''}
  </div>
  ${S.menuError?`<div class="error-box">${esc(S.menuError)}</div>`:''}
  ${S.menuLoading?`<div style="text-align:center;padding:2rem"><div class="spinner"></div><p style="font-family:Georgia,serif;font-style:italic;color:#8a7060">Lese das Menü…</p></div>`:''}
  ${S.menuAnalysis?buildMenuResults():''}
  </div>`;
}
function buildMenuResults(){
  const ma=S.menuAnalysis;
  return`<div><div style="margin-bottom:1rem;padding-bottom:.7rem;border-bottom:1px solid #e8d8c8"><div style="font-size:.74rem;text-transform:uppercase;letter-spacing:1px;color:#4a7a55;font-weight:500;margin-bottom:.2rem">${esc(ma.restaurantType||'')}</div><div style="font-family:Georgia,serif;font-size:1.35rem;color:#5c3d2e">Menu recommendations</div></div>
  ${ma.generalTips?.length?`<div class="info-box"><div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.8px;font-weight:600;color:#4a7a55;margin-bottom:.5rem">General tips</div>${ma.generalTips.map(t=>`<div style="font-size:.83rem;color:#4a7a55;line-height:1.5;margin-bottom:.3rem">· ${esc(t)}</div>`).join('')}</div>`:''}
  <div style="display:flex;gap:.6rem;margin-bottom:.85rem;flex-wrap:wrap">${Object.entries(SAFETY).map(([,v])=>`<div style="padding:.25rem .6rem;background:${v.bg};border:1px solid ${v.bo};border-radius:999px;font-size:.74rem;color:${v.tc};font-weight:500">${v.lbl}</div>`).join('')}</div>
  ${(ma.dishes||[]).map(dish=>{const cfg=SAFETY[dish.safetyRating]||{bg:'#fdf6ee',bo:'#e8d8c8',tc:'#8a7060',lbl:'?'};return`<div class="dish-item"><div class="dish-head" style="background:${cfg.bg};border-bottom:1px solid ${cfg.bo}"><span style="font-weight:700;font-size:.75rem;color:${cfg.tc};padding:.15rem .5rem;background:white;border-radius:999px;border:1px solid ${cfg.bo};flex-shrink:0">${cfg.lbl}</span><span style="font-weight:600;font-size:.88rem;color:#5c3d2e;flex:1">${esc(dish.name)}</span></div><div class="dish-body"><p style="font-size:.82rem;color:#2d1f17;margin:0 0 .5rem;line-height:1.45">${esc(dish.safetyReason)}</p>${dish.omissions?.length?`<div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.6px;font-weight:600;color:#4a7a9b;margin-bottom:.3rem">Ask the kitchen to:</div>${dish.omissions.map(o=>`<div style="display:flex;gap:.4rem;font-size:.81rem;color:#2d1f17;margin-bottom:.2rem"><span style="color:#4a7a9b;flex-shrink:0">→</span><span>${esc(o)}</span></div>`).join('')}`:''}</div></div>`;}).join('')}
  <div style="text-align:center;padding:1rem 0 0;font-size:.73rem;color:#8a7060">Always inform restaurant staff of your dietary requirements.</div></div>`;
}

// ── Generate ──────────────────────────────────────────────────────────────────
function buildGenerate(){
  const genLabel=S.loading?'Crafting…':S.mode==='fridge'?`Generate from ${S.fridgeItems.length} ingredient${S.fridgeItems.length!==1?'s':''}`:S.mode==='adapt'?`Adapt "${esc(S.dishName.trim()||'your dish')}"`:S.count===1?'Generate Recipe':'Generate Recipes';
  return`<div>
  <div style="display:flex;gap:.5rem;margin-bottom:1.1rem">
    <button class="mode-pill${S.mode==='generate'?' active':''}" data-mode="generate">🎲 Überrasch mich</button>
    <button class="mode-pill${S.mode==='fridge'?' active':''}" data-mode="fridge">🧊 Kühlschrank</button>
    <button class="mode-pill${S.mode==='adapt'?' active':''}" data-mode="adapt">🔄 Adaptieren</button>
  </div>

  ${S.mode==='fridge'?`<div class="card" style="border:2px solid #e8937a;background:linear-gradient(135deg,#fff8f4,white)"><div class="sec-title">What's in your fridge?</div>
    <div style="display:flex;gap:.5rem;margin-bottom:.6rem"><input id="fridgeInput" class="field" style="flex:1" value="${esc(S.fridgeInput)}" placeholder="Type ingredient, press Enter"/><button id="fridgeAddBtn" style="padding:0 1rem;background:#c4684a;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:500">Add</button></div>
    ${S.fridgeItems.length?`<div style="display:flex;flex-wrap:wrap;gap:.4rem">${S.fridgeItems.map((item,i)=>`<span style="display:inline-flex;align-items:center;gap:.35rem;padding:.28rem .65rem;background:#fff5ee;border:1.5px solid #e8937a;border-radius:999px;font-size:.8rem;color:#5c3d2e">${esc(item)}<button data-removefridge="${i}" style="border:none;background:none;cursor:pointer;color:#8a7060;font-size:.8rem;line-height:1;padding:0">×</button></span>`).join('')}<button id="clearFridgeBtn" style="border:1px solid #e8d8c8;background:none;border-radius:999px;padding:.28rem .65rem;font-size:.75rem;cursor:pointer;color:#8a7060">Clear all</button></div>`:''}
  </div>`:''}

  ${S.mode==='adapt'?`<div class="card" style="border:2px solid #a0c4d8;background:linear-gradient(135deg,#f4f9fc,white)"><div class="sec-title">Which dish to adapt?</div>
    <input id="dishName" class="field" style="font-size:.95rem;padding:.75rem 1rem;border-color:#a0c4d8" value="${esc(S.dishName)}" placeholder="e.g. Lasagne, Chicken Tikka Masala, Ramen…"/>
    ${S.dishName.trim()?`<div style="margin-top:.7rem;padding:.55rem .85rem;background:#e8f0f5;border:1px solid #c5dcec;border-radius:8px;font-size:.8rem;color:#4a7a9b">Will adapt <strong>${esc(S.dishName.trim())}</strong> to your active restrictions</div>`:''}
  </div>`:''}

  <div class="card">
    <div class="sec-title">Meal settings</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
      <div><div class="lbl">Meal type</div><select id="mealType" class="field">${opts([['any','Any'],['breakfast','Breakfast'],['lunch','Lunch'],['dinner','Dinner'],['snack','Snack'],['soup','Soup/Stew'],['salad','Salad']],S.mealType)}</select></div>
      <div><div class="lbl">Dietary style</div><select id="dietStyle" class="field">${opts([['omnivore','Omnivore'],['vegetarian','Vegetarian'],['vegan','Vegan'],['pescatarian','Pescatarian']],S.dietStyle)}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
      <div><div class="lbl">Servings</div><div class="stepper"><button data-stepper="servings" data-dir="-1">−</button><div class="stepper-val">${S.servings}</div><button data-stepper="servings" data-dir="1">+</button></div></div>
      <div><div class="lbl">How many recipes?</div><div style="display:flex;gap:.5rem;margin-top:.1rem">${[1,2,3].map(n=>`<button class="pill${S.count===n?' active':''}" data-count="${n}" style="flex:1;justify-content:center">${n}</button>`).join('')}</div></div>
    </div>
    <div style="margin-bottom:1rem">
      <div class="lbl">Prep &amp; cook time</div>
      <div style="display:flex;flex-wrap:wrap;gap:.4rem">
        ${[['any','Any time'],['quick','Under 20 min'],['medium','20–45 min'],['relaxed','45 min+']].map(([v,l])=>`<button class="pill${S.prepTime===v?' active':''}" data-preptime="${v}">${l}</button>`).join('')}
      </div>
    </div>
    <div style="margin-bottom:1rem">
      <div class="lbl" style="margin-bottom:.55rem">Rezeptstil <span style="text-transform:none;letter-spacing:0;font-weight:400;font-size:.7rem;color:var(--stone)">— mehrere wählbar</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:.45rem">
        ${[
          ['quick',    '⚡','Schnell','unter 20 Min.'],
          ['easy',     '✅','Kinderleicht','kaum Kochkenntnisse nötig'],
          ['few_ing',  '🔢','Wenig Zutaten','max. 8–10'],
          ['pantry',   '🏺','Aus dem Vorrat','kein extra Einkauf'],
          ['meal_prep','🍱','Meal-prep','für mehrere Tage'],
          ['impress',  '✨','Für Gäste','macht Eindruck'],
          ['comfort',  '🧡','Wohlfühlessen','wärmend & sättigend'],
          ['light',    '🌿','Leicht & frisch','wenig Kalorien'],
          ['budget',   '💰','Günstig','einfache Zutaten'],
          ['weekend',  '☕','Wochenend-Koch','Zeit spielt keine Rolle'],
        ].map(([v,icon,name,sub])=>{const on=(S.cookStyles||[]).includes(v);return`<button class="pill${on?' active':''}" data-cookstyle="${v}" style="display:flex;flex-direction:column;align-items:flex-start;gap:.05rem;padding:.45rem .8rem;border-radius:10px;text-align:left;min-width:0"><span style="display:flex;align-items:center;gap:.3rem;font-size:.79rem;font-weight:600;white-space:nowrap">${icon} ${name}</span><span style="font-size:.65rem;opacity:.8;font-weight:400;white-space:nowrap">${sub}</span></button>`;}).join('')}
      </div>
    </div>
    <div><div class="lbl">Zusätzliche Hinweise</div><input id="extras" class="field" value="${esc(S.extras)}" placeholder="z.B. keine Meeresfrüchte, weiche Konsistenz…"/></div>
  </div>

  ${S.error?`<div class="error-box">${esc(S.error)}</div>`:''}
  ${S.loading?`<div style="text-align:center;padding:2.5rem 1rem"><div class="spinner"></div><p style="font-family:Georgia,serif;font-style:italic;color:#8a7060">Crafting your personalised recipes…</p></div>`:''}
  <button class="btn-main" id="generateBtn" ${S.loading?'disabled':''}>${genLabel}</button>
  ${S.recipes.length?buildRecipes():''}
  </div>`;
}

function buildRecipes(){
  return`<div style="margin-top:1.5rem"><div style="margin-bottom:1.1rem;padding-bottom:.7rem;border-bottom:1px solid #e8d8c8"><div style="font-size:.74rem;text-transform:uppercase;letter-spacing:1px;color:#4a7a55;font-weight:500;margin-bottom:.2rem">${S.recipes.length} recipe${S.recipes.length>1?'s':''} generated</div><div style="font-family:Georgia,serif;font-size:1.45rem;color:#5c3d2e">Your kidney-friendly recipes</div></div>
  ${S.recipes.map((r,i)=>`
    ${r.fridgeIngredientsUsed?.length?`<div class="fridge-banner">From your fridge: ${esc(r.fridgeIngredientsUsed.join(', '))}</div>`:''}
    ${r.adaptations?.length?`<div class="adapt-banner"><div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.8px;font-weight:600;color:#4a7a9b;margin-bottom:.55rem">Adaptations from the original</div>${r.adaptations.map(a=>`<div style="background:white;border:1px solid #c5dcec;border-radius:8px;padding:.45rem .7rem;margin-bottom:.4rem"><div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap;margin-bottom:.15rem"><span style="color:#8a7060;text-decoration:line-through;font-size:.78rem">${esc(a.original)}</span><span style="color:#8a7060">→</span><span style="color:#4a7a55;font-weight:600;font-size:.78rem">${esc(a.replacement)}</span></div><div style="color:#8a7060;font-style:italic;font-size:.73rem;line-height:1.4">${esc(a.reason)}</div></div>`).join('')}</div>`:''}
    ${buildRecipeCard(r,'result',i)}
  `).join('')}</div>`;
}

function buildRecipeCard(r,ctx,idx){
  const base=r.servings||2;
  const sv=S.servingOverrides[`${ctx}_${idx}`]!==undefined?S.servingOverrides[`${ctx}_${idx}`]:base;
  const ratio=sv/base;
  const fav=isFav(r);
  return`<div class="recipe-card">
    <div class="recipe-head">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
        <div style="flex:1"><div style="font-family:Georgia,serif;font-size:1.22rem;color:#5c3d2e;line-height:1.25">${esc(r.name)}</div>
          <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.55rem">${['Servings: '+sv,'Prep: '+r.prepTime,'Cook: '+r.cookTime].map(t=>`<span style="padding:.22rem .6rem;background:#fdf6ee;border:1px solid #e8d8c8;border-radius:999px;font-size:.72rem;color:#8a7060">${t}</span>`).join('')}</div></div>
      <div style="display:flex;gap:.5rem;flex-shrink:0">
          <button data-logmeal="${ctx}_${idx}" class="log-btn${S.loggedThisSession[`${ctx}_${idx}`]?' logged':''}">
            ${S.loggedThisSession[`${ctx}_${idx}`]?'✓ Geloggt':'+ Logg'}
          </button>
          ${S.haToken?`<button data-pushsensor="${ctx}_${idx}" class="sensor-btn${S.sensorPushing[`${ctx}_${idx}`]==='ok'?' ok':S.sensorPushing[`${ctx}_${idx}`]==='error'?' err':''}">
            ${S.sensorPushing[`${ctx}_${idx}`]==='pushing'?'…':S.sensorPushing[`${ctx}_${idx}`]==='ok'?'✓ HA':S.sensorPushing[`${ctx}_${idx}`]==='error'?'✗ HA':'📡 HA'}
          </button>`:''}
          <button data-favtoggle="${ctx}_${idx}" style="background:${fav?'#fdf5dc':'white'};border:1.5px solid ${fav?'#c49a1a':'#e8d8c8'};border-radius:8px;padding:.35rem .55rem;cursor:pointer;font-size:1.1rem;line-height:1">${fav?'★':'☆'}</button>
          <div style="font-size:1.9rem;line-height:1">${esc(r.emoji||'')}</div>
        </div>
      </div>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;padding:.6rem 1.25rem;background:#fdf6ee;border-bottom:1px solid #e8d8c8">
      <span style="font-size:.79rem;color:#8a7060;font-weight:500">Adjust servings</span>
      <div style="display:flex;align-items:center;gap:.55rem">
        <button data-svstep="${ctx}_${idx}" data-dir="-1" style="width:28px;height:28px;border-radius:50%;border:1.5px solid #e8d8c8;background:white;cursor:pointer;color:#8a7060;font-size:1rem">−</button>
        <span style="font-weight:600;font-size:.95rem;color:#5c3d2e;min-width:20px;text-align:center">${sv}</span>
        <button data-svstep="${ctx}_${idx}" data-dir="1" style="width:28px;height:28px;border-radius:50%;border:1.5px solid #e8d8c8;background:white;cursor:pointer;color:#8a7060;font-size:1rem">+</button>
      </div>
    </div>
    <div style="padding:1.4rem">
      <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:1px;font-weight:600;color:#c4684a;margin-bottom:.5rem">Ingredients <span style="color:#8a7060;font-size:.67rem;text-transform:none;letter-spacing:0;font-weight:400">— tap swap to replace</span></div>
      <ul class="ing-list">${buildIngredients(r,ctx,idx,ratio)}</ul>
      <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:1px;font-weight:600;color:#c4684a;margin-bottom:.5rem">Instructions</div>
      <ol style="list-style:none;display:flex;flex-direction:column;gap:.6rem;margin-bottom:1.2rem">
        ${(r.instructions||[]).map((step,i)=>`<li style="display:flex;gap:.7rem;font-size:.86rem;line-height:1.55;color:#2d1f17"><span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#c4684a;color:white;font-size:.68rem;font-weight:600;display:flex;align-items:center;justify-content:center;margin-top:1px">${i+1}</span><span>${esc(step)}</span></li>`).join('')}
      </ol>
      <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:1px;font-weight:600;color:#c4684a;margin-bottom:.5rem">Nutrition per serving</div>
      <div class="nut-grid">${Object.entries(r.nutrition||{}).map(([k,v])=>`<div class="nut-box"><div class="nut-val${ratio!==1?' scaled':''}">${esc(scaleNut(v,ratio))}</div><div class="nut-key">${NUT_LABELS[k]||k}</div></div>`).join('')}</div>
      <div class="kidney-tip"><span style="flex-shrink:0">💚</span>${esc(r.kidneyTip||'')}</div>
      ${r.notes?`<div style="margin-top:.65rem;padding:.65rem .9rem;background:#fffaf5;border:1.5px solid #e8d8c8;border-radius:9px;font-size:.82rem;color:#5c3d2e;line-height:1.5;display:flex;gap:.5rem;align-items:flex-start"><span style="flex-shrink:0;color:#8a7060">📝</span><span>${esc(r.notes)}</span></div>`:''}
    </div>
  </div>`;
}

function buildIngredients(r,ctx,idx,ratio){
  return(r.ingredients||[]).map((ing,ii)=>{
    const swKey=`${ctx}_${idx}_${ii}`;const sw=S.swapState[swKey]||{};
    return`<li class="ing-item">
      <div style="display:flex;align-items:flex-start;gap:.4rem;flex-wrap:wrap">
        <span style="color:#e8937a;flex-shrink:0;margin-top:1px">·</span>
        <span style="flex:1;${sw.swappedTo?'text-decoration:line-through;color:#8a7060;font-size:.8rem':'color:#2d1f17'}">${esc(scaleIng(ing,ratio))}</span>
        ${sw.swappedTo?`<span style="color:#4a7a55;font-weight:500;font-size:.86rem">→ ${esc(scaleIng(sw.swappedTo,ratio))}</span>`:''}
        <div style="display:flex;gap:.3rem;flex-shrink:0">
          ${!sw.opts&&!sw.swapping?`<button data-swap="${swKey}" data-ing="${esc(ing)}" data-ri="${idx}" data-ctx="${ctx}" style="border:1px solid #e8d8c8;background:white;border-radius:6px;padding:.15rem .45rem;font-size:.7rem;cursor:pointer;color:#8a7060">swap</button>`:''}
          ${sw.swappedTo?`<button data-undoswap="${swKey}" style="border:1px solid #e8937a;background:#fff5f2;border-radius:6px;padding:.15rem .45rem;font-size:.7rem;cursor:pointer;color:#c4684a">undo</button>`:''}
          ${sw.swapping?`<span style="font-size:.7rem;color:#8a7060;padding:.15rem .3rem">…</span>`:''}
        </div>
      </div>
      ${sw.err?`<div style="font-size:.72rem;color:#c4684a;margin-left:1.1rem;margin-top:2px">${esc(sw.err)}</div>`:''}
      ${sw.opts?`<div class="swap-opts"><div style="font-size:.7rem;color:#4a7a9b;font-weight:600;margin-bottom:.4rem;text-transform:uppercase;letter-spacing:.5px">Choose substitute:</div>${sw.opts.map((a,oi)=>`<button data-pickswap="${swKey}" data-optidx="${oi}" style="display:block;width:100%;border:1px solid #c5dcec;background:white;border-radius:6px;padding:.3rem .6rem;font-size:.81rem;cursor:pointer;color:#2d1f17;text-align:left;margin-bottom:.3rem">${esc(a)}</button>`).join('')}<button data-cancelswap="${swKey}" style="border:none;background:none;font-size:.7rem;color:#8a7060;cursor:pointer">Cancel</button></div>`:''}
    </li>`;
  }).join('');
}

// ── Tracker ───────────────────────────────────────────────────────────────────
function buildManualLogModal(){
  const ml=S.manualLog;
  if(!ml.open)return'';
  return`<div class="modal-overlay" id="manualLogOverlay">
    <div class="modal-sheet">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.1rem">
        <div style="font-family:Georgia,serif;font-size:1.1rem;color:var(--stone-dark)">Essen eintragen</div>
        <button data-closemanuallog="1" style="border:none;background:none;font-size:1.4rem;cursor:pointer;color:var(--stone);line-height:1">✕</button>
      </div>

      <div style="display:flex;gap:.5rem;margin-bottom:1.1rem">
        <button data-logmode="text" class="mode-toggle-btn${ml.mode==='text'?' active':''}">✏️ Text</button>
        <button data-logmode="image" class="mode-toggle-btn${ml.mode==='image'?' active':''}">📷 Foto analysieren</button>
      </div>

      ${ml.mode==='image'?`
        <div style="margin-bottom:1rem">
          ${ml.imagePreview?`<div style="position:relative;margin-bottom:.8rem">
            <img src="${ml.imagePreview}" style="width:100%;max-height:220px;object-fit:cover;border-radius:12px;display:block"/>
            <button data-clearfoodphoto="1" style="position:absolute;top:.5rem;right:.5rem;border:none;background:rgba(0,0,0,.5);color:white;border-radius:50%;width:26px;height:26px;cursor:pointer;font-size:.85rem">✕</button>
          </div>`:''}
          <button id="foodPhotoBtn" style="width:100%;display:flex;align-items:center;gap:.8rem;padding:.9rem 1rem;background:var(--warm-white);border:1.5px dashed var(--border);border-radius:10px;cursor:pointer;font-size:.88rem;color:var(--stone-dark);font-weight:500" ${ml.analyzing?'disabled':''}>
            <span style="font-size:1.3rem">📸</span>
            <div style="text-align:left"><div>${ml.analyzing?'KI analysiert…':ml.imagePreview?'Anderes Foto':'Foto auswählen'}</div><div style="font-size:.72rem;color:var(--stone);font-weight:400">Claude erkennt Gericht & Nährwerte</div></div>
          </button>
          ${ml.analyzing?`<div style="margin-top:.6rem;display:flex;align-items:center;gap:.5rem;padding:.5rem .75rem;background:#f0f8f1;border-radius:8px"><div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div><span style="font-size:.8rem;color:#4a7a55">Analysiere Bild…</span></div>`:''}
        </div>`:''}

      <div style="margin-bottom:.8rem">
        <div class="lbl">Gericht / Mahlzeit</div>
        <input id="mlName" class="field" value="${esc(ml.name)}" placeholder="z.B. Haferflocken mit Beeren"/>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.8rem">
        <div><div class="lbl">Kalorien (kcal)</div><input id="mlCal" type="number" class="field" value="${ml.calories}" placeholder="350"/></div>
        <div><div class="lbl">Portionen</div><input id="mlSv" type="number" min="0.5" step="0.5" class="field" value="${ml.servings||1}"/></div>
        <div><div class="lbl">Protein (g)</div><input id="mlProt" type="number" class="field" value="${ml.protein}" placeholder="18"/></div>
        <div><div class="lbl">Kohlenhydrate (g)</div><input id="mlCarbs" type="number" class="field" value="${ml.carbs}" placeholder="40"/></div>
        <div><div class="lbl">Fett (g)</div><input id="mlFat" type="number" class="field" value="${ml.fat}" placeholder="8"/></div>
        ${S.potassium!=='none'?`<div><div class="lbl">Kalium (mg)</div><input id="mlPot" type="number" class="field" value="${ml.potassium}" placeholder="300"/></div>`:''}
        ${S.sodium!=='none'?`<div><div class="lbl">Natrium (mg)</div><input id="mlNa" type="number" class="field" value="${ml.sodium}" placeholder="200"/></div>`:''}
      </div>

      ${ml.error?`<div style="padding:.6rem .9rem;background:#fff3f0;border:1px solid #f0b8a8;border-radius:8px;font-size:.8rem;color:#a04030;margin-bottom:.8rem">${esc(ml.error)}</div>`:''}

      <button id="saveManualLog" class="btn-main" ${!ml.name.trim()||ml.analyzing?'disabled':''}>Eintrag speichern</button>
    </div>
  </div>`;
}

// ── User picker modal (log meal for other profiles) ────────────────────────────
function buildLogUserPicker(){
  const p=S.logUserPicker;
  if(!p.open)return'';
  const others=S.profiles.filter(x=>x.id!==S.activeProfileId);
  if(!others.length)return'';
  return`<div class="modal-overlay" id="logUserPickerOverlay">
    <div class="modal-sheet" style="padding:1.2rem 1rem 1.5rem">
      <div style="font-weight:700;font-size:1rem;color:var(--stone-dark);margin-bottom:.25rem">Auch für andere eintragen?</div>
      <div style="font-size:.8rem;color:var(--stone);margin-bottom:1rem"><em>${esc(p.entry?.mealName||'')}</em> wurde für dein Profil gespeichert.</div>
      <div style="display:flex;flex-direction:column;gap:.5rem;margin-bottom:1rem">
        ${others.map(pr=>{
          const gs=pr.healthGoals||(pr.healthGoal?[pr.healthGoal]:[]);
          const icons=gs.map(id=>{const g=HEALTH_GOALS.find(h=>h.id===id);return g?g.icon:'';}).join('');
          return`<button data-logforprofile="${pr.id}" style="display:flex;align-items:center;gap:.7rem;padding:.65rem .9rem;border:1.5px solid var(--border);border-radius:10px;background:white;cursor:pointer;text-align:left">
            <span style="font-size:1.1rem">${icons||'👤'}</span>
            <div><div style="font-size:.88rem;font-weight:600;color:var(--stone-dark)">${esc(pr.name||'Profil')}</div>
            ${icons?`<div style="font-size:.72rem;color:var(--stone)">${gs.map(id=>{const g=HEALTH_GOALS.find(h=>h.id===id);return g?g.title:'';}).join(', ')}</div>`:''}</div>
            <span style="margin-left:auto;color:var(--terracotta);font-size:.8rem">+ eintragen</span>
          </button>`;
        }).join('')}
      </div>
      <button data-closelogpicker="1" style="width:100%;padding:.6rem;border:1px solid var(--border);background:none;border-radius:8px;font-size:.85rem;color:var(--stone);cursor:pointer">Überspringen</button>
    </div>
  </div>`;
}

// ── Pantry / Fridge Storage System ────────────────────────────────────────────

const PANTRY_CATS=[
  {id:'grain',label:'Getreide & Backwaren',icon:'🌾'},
  {id:'veg',label:'Gemüse',icon:'🥦'},
  {id:'fruit',label:'Obst',icon:'🍎'},
  {id:'protein',label:'Protein & Fleisch',icon:'🥚'},
  {id:'dairy',label:'Milch & Käse',icon:'🧀'},
  {id:'spice',label:'Gewürze & Öle',icon:'🧂'},
  {id:'canned',label:'Konserven & Tiefkühl',icon:'🥫'},
  {id:'drink',label:'Getränke',icon:'💧'},
  {id:'other',label:'Sonstiges',icon:'📦'},
];
const PANTRY_LOCS=[
  {id:'fridge',label:'Kühlschrank',icon:'🧊'},
  {id:'freezer',label:'Gefrierfach',icon:'❄️'},
  {id:'pantry',label:'Speisekammer',icon:'🚪'},
  {id:'shelf',label:'Regal',icon:'📚'},
  {id:'cellar',label:'Keller',icon:'🏚️'},
];
const PANTRY_UNITS=['g','kg','ml','L','Stück','Pkg.','Dose','Bund','EL','TL'];

function pantryDaysLeft(expDate){
  if(!expDate)return null;
  const diff=Math.round((new Date(expDate)-new Date())/(1000*60*60*24));
  return diff;
}
function pantryExpiryColor(days){
  if(days===null)return'';
  if(days<0)return'#d32f2f';
  if(days<=3)return'#e65100';
  if(days<=7)return'#f9a825';
  return'#388e3c';
}
function pantryExpiryLabel(days){
  if(days===null)return'';
  if(days<0)return`Abgelaufen`;
  if(days===0)return'Heute!';
  if(days===1)return'Morgen';
  return`${days}d`;
}

function buildPantryForm(isEdit){
  const f=S.pantryForm;
  return`<div class="modal-sheet" style="padding:1.2rem 1rem 1.5rem;max-height:92vh;overflow-y:auto">
    <div style="font-weight:700;font-size:1rem;color:var(--stone-dark);margin-bottom:1rem">${isEdit?'Artikel bearbeiten':'Artikel hinzufügen'}</div>
    <div style="margin-bottom:.7rem"><div class="lbl">Name *</div>
      <input id="pfName" class="field" value="${esc(f.name)}" placeholder="z.B. Haferflocken"/></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.7rem">
      <div><div class="lbl">Menge</div><input id="pfQty" class="field" type="number" min="0" step="0.1" value="${esc(f.quantity)}"/></div>
      <div><div class="lbl">Einheit</div><select id="pfUnit" class="field" style="padding:.5rem">
        ${PANTRY_UNITS.map(u=>`<option value="${u}"${f.unit===u?' selected':''}>${u}</option>`).join('')}
      </select></div>
    </div>
    <div style="margin-bottom:.7rem"><div class="lbl">Kategorie</div>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem">
        ${PANTRY_CATS.map(c=>`<button data-pfcat="${c.id}" style="padding:.3rem .6rem;border:1.5px solid ${f.category===c.id?'var(--terracotta)':'var(--border)'};border-radius:8px;background:${f.category===c.id?'var(--terra-faint)':'white'};font-size:.75rem;cursor:pointer;color:${f.category===c.id?'var(--terracotta)':'var(--stone-dark)'}">${c.icon} ${c.label}</button>`).join('')}
      </div></div>
    <div style="margin-bottom:.7rem"><div class="lbl">Lagerort</div>
      <div style="display:flex;flex-wrap:wrap;gap:.35rem">
        ${PANTRY_LOCS.map(l=>`<button data-pfloc="${l.id}" style="padding:.3rem .6rem;border:1.5px solid ${f.location===l.id?'var(--terracotta)':'var(--border)'};border-radius:8px;background:${f.location===l.id?'var(--terra-faint)':'white'};font-size:.75rem;cursor:pointer;color:${f.location===l.id?'var(--terracotta)':'var(--stone-dark)'}">${l.icon} ${l.label}</button>`).join('')}
      </div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.6rem;margin-bottom:.9rem">
      <div><div class="lbl">MHD / Ablaufdatum</div><input id="pfExp" class="field" type="date" value="${esc(f.expirationDate)}"/></div>
      <div><div class="lbl">Notiz</div><input id="pfNote" class="field" value="${esc(f.note)}" placeholder="optional"/></div>
    </div>
    <div style="display:flex;gap:.5rem">
      <button data-closepantryform="1" style="flex:1;padding:.6rem;border:1px solid var(--border);background:none;border-radius:8px;font-size:.85rem;color:var(--stone);cursor:pointer">Abbrechen</button>
      <button data-savepantryitem="${isEdit?S.pantryEditId:''}" style="flex:2;padding:.6rem;background:var(--terracotta);color:white;border:none;border-radius:8px;font-size:.88rem;font-weight:600;cursor:pointer">${isEdit?'Speichern':'Hinzufügen'}</button>
    </div>
  </div>`;
}

function buildReceiptScanner(){
  return`<div class="modal-sheet" style="padding:1.2rem 1rem 1.5rem;max-height:85vh;overflow-y:auto">
    <div style="font-weight:700;font-size:1rem;color:var(--stone-dark);margin-bottom:.25rem">Kassenbon scannen</div>
    <div style="font-size:.8rem;color:var(--stone);margin-bottom:1rem">Foto vom Kassenbon hochladen — Claude erkennt die Artikel automatisch.</div>
    ${S.pantryReceiptScanning?`
      <div style="text-align:center;padding:2rem;color:var(--terracotta)">
        <div style="font-size:2rem;margin-bottom:.5rem">🧾</div>
        <div style="font-size:.88rem">${S.pantryReceiptStatus||'Analysiere Kassenbon…'}</div>
        <div style="font-size:.75rem;color:var(--stone);margin-top:.4rem">Schritt 1: Text lesen · Schritt 2: Artikel erkennen</div>
      </div>
    `:`
      <button id="receiptPhotoBtn" style="width:100%;display:flex;align-items:center;gap:.8rem;padding:.9rem 1rem;background:var(--warm-white);border:1.5px dashed var(--border);border-radius:10px;cursor:pointer;font-size:.88rem;color:var(--stone-dark);font-weight:500;margin-bottom:.9rem">
        <span style="font-size:1.3rem">🧾</span>
        <div><div>Kassenbon-Foto auswählen</div><div style="font-size:.72rem;color:var(--stone);margin-top:1px">JPG, PNG — Claude liest die Artikel aus</div></div>
      </button>
      <button data-closereceiptscanner="1" style="width:100%;padding:.6rem;border:1px solid var(--border);background:none;border-radius:8px;font-size:.85rem;color:var(--stone);cursor:pointer">Abbrechen</button>
    `}
  </div>`;
}

function buildPantry(){
  if(!S.pantryLoaded)return`<div style="text-align:center;padding:3rem;color:var(--stone)">Lade Vorrat…</div>`;
  const items=S.pantry||[];
  const groupBy=S.pantryGroup;
  const filter=(S.pantryFilter||'').toLowerCase();
  const filtered=filter?items.filter(i=>i.name.toLowerCase().includes(filter)):items;

  // Build group structure
  const groups=groupBy==='category'?PANTRY_CATS:PANTRY_LOCS;
  const keyField=groupBy==='category'?'category':'location';
  const grouped=groups.map(g=>({
    ...g,
    items:filtered.filter(i=>i[keyField]===g.id)
  })).filter(g=>g.items.length);

  // Ungrouped items
  const knownKeys=groups.map(g=>g.id);
  const ungrouped=filtered.filter(i=>!knownKeys.includes(i[keyField]));
  if(ungrouped.length)grouped.push({id:'?',label:'Sonstiges',icon:'📦',items:ungrouped});

  // Expiry summary
  const expiring=items.filter(i=>{const d=pantryDaysLeft(i.expirationDate);return d!==null&&d<=7&&d>=0;});
  const expired=items.filter(i=>{const d=pantryDaysLeft(i.expirationDate);return d!==null&&d<0;});

  return`<div>
    ${(S.pantryAddOpen||S.pantryEditId)?`<div class="modal-overlay" id="pantryFormOverlay">${buildPantryForm(!!S.pantryEditId)}</div>`:''}
    ${S.pantryReceiptOpen?`<div class="modal-overlay" id="receiptOverlay">${buildReceiptScanner()}</div>`:''}

    ${(expired.length||expiring.length)?`<div style="background:#fff5ee;border:1px solid #e8937a;border-radius:10px;padding:.65rem 1rem;margin-bottom:.7rem;font-size:.8rem">
      ${expired.length?`<div style="color:#d32f2f;font-weight:600">⚠️ ${expired.length} Artikel abgelaufen</div>`:''}
      ${expiring.length?`<div style="color:#e65100">${expiring.length} Artikel laufen in ≤7 Tagen ab</div>`:''}
    </div>`:''}

    <div class="card" style="padding:.7rem .9rem">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem">
        <input id="pantryFilter" class="field" style="flex:1;font-size:.82rem;padding:.4rem .7rem" placeholder="Suchen…" value="${esc(S.pantryFilter)}"/>
        <div style="display:flex;border:1px solid var(--border);border-radius:8px;overflow:hidden">
          <button data-pantrygroup="category" style="padding:.35rem .7rem;font-size:.75rem;border:none;cursor:pointer;background:${groupBy==='category'?'var(--terracotta)':'white'};color:${groupBy==='category'?'white':'var(--stone)'};font-weight:${groupBy==='category'?600:400}">Kategorie</button>
          <button data-pantrygroup="location" style="padding:.35rem .7rem;font-size:.75rem;border:none;cursor:pointer;background:${groupBy==='location'?'var(--terracotta)':'white'};color:${groupBy==='location'?'white':'var(--stone)'};font-weight:${groupBy==='location'?600:400}">Ort</button>
        </div>
      </div>
      <div style="display:flex;gap:.4rem">
        <button data-openpantryform="1" style="flex:1;padding:.5rem;background:var(--terracotta);color:white;border:none;border-radius:8px;font-size:.82rem;font-weight:600;cursor:pointer">+ Artikel</button>
        <button data-openreceiptscanner="1" style="flex:1;padding:.5rem;background:var(--sage);color:white;border:none;border-radius:8px;font-size:.82rem;font-weight:600;cursor:pointer">🧾 Kassenbon</button>
        ${S.fridgeItems.length?`<button data-importfrominventory="1" style="padding:.5rem .7rem;border:1.5px solid var(--border);background:none;border-radius:8px;font-size:.75rem;color:var(--stone);cursor:pointer">→ Rezept</button>`:''}
      </div>
    </div>

    ${items.length===0?`<div class="card" style="text-align:center;padding:2.5rem 1rem;color:var(--stone)">
      <div style="font-size:2.5rem;margin-bottom:.7rem">🧊</div>
      <div style="font-size:.95rem;font-weight:600;margin-bottom:.3rem">Dein Vorrat ist leer</div>
      <div style="font-size:.82rem">Füge Artikel hinzu oder scanne einen Kassenbon.</div>
    </div>`:''}

    ${grouped.map(g=>`
    <div class="card" style="padding:.7rem .9rem">
      <div style="font-size:.78rem;font-weight:700;color:var(--stone);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.6rem">${g.icon} ${g.label}</div>
      ${g.items.sort((a,b)=>{
        // Sort expired first, then by days left
        const da=pantryDaysLeft(a.expirationDate),db=pantryDaysLeft(b.expirationDate);
        if(da!==null&&db!==null)return da-db;
        if(da!==null)return-1;
        if(db!==null)return 1;
        return a.name.localeCompare(b.name);
      }).map(item=>{
        const days=pantryDaysLeft(item.expirationDate);
        const color=pantryExpiryColor(days);
        const catObj=(groupBy==='location'?PANTRY_CATS:PANTRY_LOCS).find(x=>x.id===(groupBy==='location'?item.category:item.location));
        return`<div style="display:flex;align-items:center;gap:.6rem;padding:.5rem 0;border-bottom:1px solid #f5ede8">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:.4rem">
              <span style="font-size:.9rem;font-weight:600;color:var(--stone-dark);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.name)}</span>
              ${catObj?`<span style="font-size:.7rem;color:var(--stone)">${catObj.icon}</span>`:''}
            </div>
            <div style="font-size:.75rem;color:var(--stone)">${esc(item.quantity||'')} ${esc(item.unit||'')}${item.note?` · ${esc(item.note)}`:''}</div>
          </div>
          ${days!==null?`<div style="font-size:.72rem;font-weight:600;color:${color};text-align:right;flex-shrink:0;min-width:42px">${pantryExpiryLabel(days)}</div>`:''}
          <button data-editpantryitem="${item.id}" style="border:none;background:none;cursor:pointer;color:#8a7060;font-size:.9rem;padding:.2rem .3rem;flex-shrink:0">✎</button>
          <button data-deletepantryitem="${item.id}" style="border:none;background:none;cursor:pointer;color:#c4684a;font-size:.9rem;padding:.2rem .3rem;flex-shrink:0">✕</button>
        </div>`;
      }).join('')}
    </div>`).join('')}

    ${filtered.length&&items.length?`<div style="text-align:center;padding:.5rem;font-size:.75rem;color:var(--stone)">${filtered.length} Artikel${filter?' (gefiltert)':''}</div>`:''}

    ${items.length>0?`<div class="card" style="padding:.7rem .9rem">
      <div style="font-size:.78rem;font-weight:700;color:var(--stone);text-transform:uppercase;letter-spacing:.05em;margin-bottom:.6rem">🎲 Aus Vorrat kochen</div>
      <div style="font-size:.8rem;color:var(--stone-dark);margin-bottom:.6rem">Die verfügbaren Artikel als Kühlschrankinhalt verwenden:</div>
      <button data-usetocook="1" style="width:100%;padding:.55rem;background:linear-gradient(135deg,var(--terracotta),var(--terra-dark));color:white;border:none;border-radius:8px;font-size:.85rem;font-weight:600;cursor:pointer">Rezepte aus Vorrat generieren →</button>
    </div>`:''}
  </div>`;
}

function buildTracker(){
  const allLog=S.nutritionLog||[];
  // Filter to current profile (legacy entries without profileId count for active profile)
  const log=allLog.filter(e=>!e.profileId||e.profileId===S.activeProfileId);
  const today=new Date();
  const todayStr=today.toISOString().slice(0,10);
  const days=Array.from({length:7},(_,i)=>{
    const d=new Date(today); d.setDate(d.getDate()-(6-i));
    return d.toISOString().slice(0,10);
  });

  const byDay={};
  days.forEach(d=>{byDay[d]={calories:0,protein:0,potassium:0,sodium:0,count:0};});
  log.forEach(e=>{
    if(byDay[e.date]){
      const n=e.nutrition||{};
      const sv=e.servings||1;
      byDay[e.date].calories+=parseFloat(n.calories||0)*sv;
      byDay[e.date].protein+=parseFloat(n.protein||0)*sv;
      byDay[e.date].potassium+=parseFloat(n.potassium||0)*sv;
      byDay[e.date].sodium+=parseFloat(n.sodium||0)*sv;
      byDay[e.date].count++;
    }
  });

  const todayTotals=byDay[todayStr];
  const calTarget=S.calorieTarget||0;
  const maxCal=Math.max(calTarget||200,...days.map(d=>byDay[d].calories));
  const BAR_H=90;
  const weekLabels=['Mo','Di','Mi','Do','Fr','Sa','So'];

  const chart=`<svg width="100%" viewBox="0 0 280 125" style="overflow:visible">
    ${calTarget>0?`<line x1="8" y1="${BAR_H+10-Math.round((calTarget/maxCal)*BAR_H)}" x2="272" y2="${BAR_H+10-Math.round((calTarget/maxCal)*BAR_H)}" stroke="#e8937a" stroke-width="1" stroke-dasharray="4 3"/>
    <text x="275" y="${BAR_H+14-Math.round((calTarget/maxCal)*BAR_H)}" font-size="7" fill="#c4684a">${calTarget}</text>`:''}
    ${days.map((d,i)=>{
      const cal=byDay[d].calories;
      const barH=cal>0?Math.max(6,Math.round((cal/maxCal)*BAR_H)):0;
      const x=10+i*37; const isToday=d===todayStr;
      const overTarget=calTarget>0&&cal>calTarget;
      const wd=weekLabels[(new Date(d).getDay()+6)%7];
      return`
      <rect x="${x}" y="${BAR_H+10-barH}" width="28" height="${barH}" rx="4"
        fill="${overTarget?'#c04a3a':isToday?'#c4684a':'#e8937a'}" opacity="${cal>0?1:.2}" class="chart-bar"/>
      ${cal>0?`<text x="${x+14}" y="${BAR_H+5-barH}" text-anchor="middle" font-size="7.5" fill="#5c3d2e">${Math.round(cal)}</text>`:''}
      <text x="${x+14}" y="${BAR_H+22}" text-anchor="middle" font-size="9" fill="${isToday?'#c4684a':'#8a7060'}" font-weight="${isToday?700:400}">${wd}</text>`;
    }).join('')}
    <line x1="8" y1="${BAR_H+10}" x2="265" y2="${BAR_H+10}" stroke="#e8d8c8" stroke-width="1"/>
    <text x="8" y="10" font-size="8" fill="#b8a898">kcal</text>
  </svg>`;

  const trackedNutrients=[
    {key:'calories',label:'Kalorien',unit:'kcal',color:'#c4684a'},
    {key:'protein',label:'Protein',unit:'g',color:'#4a7a9b'},
    S.potassium!=='none'&&{key:'potassium',label:'Kalium',unit:'mg',color:'#7a5c9e'},
    S.sodium!=='none'&&{key:'sodium',label:'Natrium',unit:'mg',color:'#5a9e8e'},
  ].filter(Boolean);

  const todayEntries=log.filter(e=>e.date===todayStr).sort((a,b)=>b.id-a.id);

  // Calorie target progress bar
  const calProgress=calTarget>0?`<div style="margin-bottom:1rem">
    <div style="display:flex;justify-content:space-between;margin-bottom:.35rem">
      <span style="font-size:.75rem;color:var(--stone);font-weight:600">Kalorienziel</span>
      <span style="font-size:.75rem;color:${todayTotals.calories>calTarget?'#c04a3a':'var(--stone)'}">
        ${Math.round(todayTotals.calories)} / ${calTarget} kcal
      </span>
    </div>
    <div style="height:8px;background:#f0e8e0;border-radius:4px;overflow:hidden">
      <div style="height:100%;width:${Math.min(100,Math.round(todayTotals.calories/calTarget*100))}%;background:${todayTotals.calories>calTarget?'#c04a3a':'#c4684a'};border-radius:4px;transition:width .4s"></div>
    </div>
  </div>`:'';

  return`<div>
    ${buildManualLogModal()}
    ${buildLogUserPicker()}
    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.6rem">
        <div class="sec-title" style="margin:0">Letzte 7 Tage</div>
        ${S.haToken?`<button data-pushdailysensor="1" class="sensor-btn" style="font-size:.72rem">📡 Tages-Sensor</button>`:''}
      </div>
      ${chart}
    </div>

    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.9rem">
        <div class="sec-title" style="margin:0">Heute — ${today.toLocaleDateString('de-DE',{weekday:'long',day:'numeric',month:'long'})}</div>
        <button data-openmanuallog="1" style="padding:.4rem .85rem;background:var(--terracotta);color:white;border:none;border-radius:8px;font-size:.8rem;cursor:pointer;font-weight:600">+ Eintragen</button>
      </div>
      ${calProgress}
      ${todayEntries.length?`
        <div style="display:flex;gap:.7rem;flex-wrap:wrap;margin-bottom:1rem">
          ${trackedNutrients.map(n=>`<div style="text-align:center;min-width:58px">
            <div style="font-size:1.05rem;font-weight:700;color:${n.color}">${Math.round(todayTotals[n.key]||0)}</div>
            <div style="font-size:.68rem;color:#8a7060">${n.label} ${n.unit}</div>
          </div>`).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:.45rem">
          ${todayEntries.map(e=>`<div style="display:flex;align-items:center;gap:.7rem;padding:.5rem .75rem;background:var(--warm-white);border:1px solid var(--border);border-radius:10px">
            <span style="font-size:1rem">${e.isManual?'✏️':'🍽️'}</span>
            <div style="flex:1">
              <div style="font-size:.86rem;font-weight:600;color:var(--stone-dark)">${esc(e.mealName)}</div>
              <div style="font-size:.71rem;color:var(--stone)">${e.servings} Port. · ${Math.round(parseFloat(e.nutrition?.calories||0)*e.servings)} kcal</div>
            </div>
            <button data-deletelog="${e.id}" style="border:none;background:none;cursor:pointer;color:#c4684a;font-size:.85rem;opacity:.6;padding:.2rem .35rem">✕</button>
          </div>`).join('')}
        </div>`
      :`<div style="text-align:center;padding:1.5rem 0;color:#8a7060">
        <div style="font-size:2rem;margin-bottom:.5rem">🍽️</div>
        <div style="font-size:.88rem">Noch nichts eingetragen heute</div>
        <div style="font-size:.78rem;margin-top:.3rem">Rezepte logg'en oder oben "+ Eintragen" tippen</div>
      </div>`}
    </div>

    ${log.length>0?`<div style="text-align:right;padding:.4rem 0">
      <button data-clearlog="1" style="border:none;background:none;cursor:pointer;font-size:.75rem;color:var(--stone)">Alle Einträge löschen</button>
    </div>`:''}</div>`;
}

// ── Events ────────────────────────────────────────────────────────────────────
function bindEvents(){
  const on=(id,ev,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener(ev,fn);};

  on('openProfileBtn','click',openProfile);
  on('openProfileBtn2','click',openProfile);
  on('overlay','click',closeProfile);
  on('closeProfile','click',closeProfile);
  on('saveProfileBtn','click',doSaveProfile);

  on('mealType','change',e=>update({mealType:e.target.value}));
  on('dietStyle','change',e=>update({dietStyle:e.target.value}));
  on('extras','input',e=>{S.extras=e.target.value;});
  on('dishName','input',e=>{S.dishName=e.target.value;});
  on('dishName','keydown',e=>{if(e.key==='Enter')doGenerate();});
  on('fridgeInput','input',e=>{S.fridgeInput=e.target.value;});
  on('fridgeInput','keydown',e=>{if(e.key==='Enter'||e.key===','){e.preventDefault();addFridgeItem();}});

  // Pantry form inputs (use event delegation for dynamic elements)
  document.getElementById('app').addEventListener('input',e=>{
    if(e.target.id==='pantryFilter'){S.pantryFilter=e.target.value;render();}
    if(e.target.id==='pfName')S.pantryForm={...S.pantryForm,name:e.target.value};
    if(e.target.id==='pfQty')S.pantryForm={...S.pantryForm,quantity:e.target.value};
    if(e.target.id==='pfUnit')S.pantryForm={...S.pantryForm,unit:e.target.value};
    if(e.target.id==='pfExp')S.pantryForm={...S.pantryForm,expirationDate:e.target.value};
    if(e.target.id==='pfNote')S.pantryForm={...S.pantryForm,note:e.target.value};
  });
  document.getElementById('app').addEventListener('change',e=>{
    if(e.target.id==='pfUnit')S.pantryForm={...S.pantryForm,unit:e.target.value};
  });

  // (receiptPhotoBtn handling moved into main delegation below)
  on('fridgeAddBtn','click',addFridgeItem);
  on('clearFridgeBtn','click',()=>update({fridgeItems:[],fridgeInput:''}));
  on('generateBtn','click',doGenerate);

  // Menu
  on('menuText','input',e=>update({menuText:e.target.value,menuAnalysis:null}));
  on('analyzeMenuBtn','click',doAnalyzeMenu);

  // Manual log modal (re-rendered inside #app so must bind each render)
  on('saveManualLog','click',doSaveManualLog);
  on('mlName','input',e=>{S.manualLog={...S.manualLog,name:e.target.value};});
  on('mlCal','input',e=>{S.manualLog={...S.manualLog,calories:e.target.value};});
  on('mlProt','input',e=>{S.manualLog={...S.manualLog,protein:e.target.value};});
  on('mlCarbs','input',e=>{S.manualLog={...S.manualLog,carbs:e.target.value};});
  on('mlFat','input',e=>{S.manualLog={...S.manualLog,fat:e.target.value};});
  on('mlPot','input',e=>{S.manualLog={...S.manualLog,potassium:e.target.value};});
  on('mlNa','input',e=>{S.manualLog={...S.manualLog,sodium:e.target.value};});
  on('mlSv','input',e=>{S.manualLog={...S.manualLog,servings:parseFloat(e.target.value)||1};});
  on('manualLogOverlay','click',e=>{if(e.target.id==='manualLogOverlay')update({manualLog:{...S.manualLog,open:false}});});
}

// ── One-time global delegation (NOT inside bindEvents — must not re-register) ─
async function handleFavSave(i){
  const r=S.favs[i];if(!r)return;
  const name=document.getElementById(`favEditName_${i}`)?.value.trim()||r.name;
  const prepTime=document.getElementById(`favEditPrep_${i}`)?.value.trim()||r.prepTime;
  const cookTime=document.getElementById(`favEditCook_${i}`)?.value.trim()||r.cookTime;
  const kidneyTip=document.getElementById(`favEditTip_${i}`)?.value.trim()||r.kidneyTip;
  const notes=document.getElementById(`favEditNotes_${i}`)?.value.trim()??r.notes??'';
  const instructions=(document.getElementById(`favEditInstr_${i}`)?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  const ingredients=(document.getElementById(`favEditIngs_${i}`)?.value||'').split('\n').map(s=>s.trim()).filter(Boolean);
  S.favs[i]={...r,name,prepTime,cookTime,kidneyTip,notes,instructions,ingredients};
  await apiSet('favourites',S.favs);
  update({editingFav:null});
}
// ── Claude Vision OCR — top-level so doScanReceipt and menu tab can both call it
// Compress image to max 1600px wide/tall and JPEG quality 0.82 before OCR.
// Reduces typical phone photo from 5MB to ~300KB, well within server limits.
async function compressImageForOcr(file){
  return new Promise((res,rej)=>{
    const reader=new FileReader();
    reader.onerror=()=>rej(new Error('Lesen fehlgeschlagen'));
    reader.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        const MAX=1600;
        let w=img.width,h=img.height;
        if(w>MAX||h>MAX){
          if(w>h){h=Math.round(h*MAX/w);w=MAX;}
          else{w=Math.round(w*MAX/h);h=MAX;}
        }
        const cv=document.createElement('canvas');
        cv.width=w;cv.height=h;
        cv.getContext('2d').drawImage(img,0,0,w,h);
        const b64=cv.toDataURL('image/jpeg',0.82).split(',')[1];
        res({b64,mime:'image/jpeg'});
      };
      img.onerror=()=>rej(new Error('Bildfehler'));
      img.src=ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function ocrImageWithClaude(file, customPrompt){
  try{
    const {b64,mime}=await compressImageForOcr(file);
    const prompt=customPrompt||'Extract ALL text visible in this image, preserving the structure. Output only the raw transcribed text. Do not summarise or translate.';
    const r=await fetch(BASE+'rk/claude',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({
        max_tokens:1500,
        messages:[{role:'user',content:[
          {type:'image',source:{type:'base64',media_type:mime,data:b64}},
          {type:'text',text:prompt}
        ]}]
      })
    });
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||'Server: '+r.status);
    const text=data.content.map(b=>b.text||'').join('').trim();
    if(!text)throw new Error('Kein Text erkannt');
    return text;
  }catch(e){
    throw e;
  }
}

async function runOcrQueue(files){
  if(!files||!files.length){
    update({ocrError:'Keine Datei ausgewählt'});
    return;
  }
  const newImgs=files.map(f=>({
    id:String(Date.now()+Math.random()),
    name:f.name,status:'pending',file:f,text:''
  }));
  update({menuImages:[...S.menuImages,...newImgs],ocrLoading:true,ocrError:''});

  for(const img of newImgs){
    img.status='active';
    // Force render BEFORE the await so chip shows 'active'
    Object.assign(S,{menuImages:[...S.menuImages]});
    render();
    await new Promise(r=>setTimeout(r,50));
    try{
      const text=await ocrImageWithClaude(img.file);
      img.text=text||'(kein Text erkannt)';
      img.status='done';
    }catch(err){
      img.status='error';
      img.text='';
      img.errorMsg=err.message;
      update({ocrError:'Fehler bei '+img.name+': '+err.message});
    }
    const combined=S.menuImages.filter(i=>i.status==='done'&&i.text)
      .map(i=>i.text).join('\n\n---\n\n');
    Object.assign(S,{menuImages:[...S.menuImages],menuText:combined,ocrProgress:100});
    render();
  }
  update({ocrLoading:false});
}

function initGlobalEvents(){

  // ── Gallery input (multiple) ───────────────────────────────────────────────
  document.getElementById('galleryInputPersist').addEventListener('change',e=>{
    const files=Array.from(e.target.files||[]);
    // Clear AFTER copying — do it async so File objects are safely in our array first
    if(files.length){
      runOcrQueue(files);
      setTimeout(()=>{try{e.target.value='';}catch{}},500);
    }
  });

  // ── Food photo picker — created dynamically to avoid WebView interference ────
  function pickFoodPhoto(){
    const inp=document.createElement('input');
    inp.type='file'; inp.accept='image/*';
    inp.style.cssText='position:fixed;opacity:0;pointer-events:none;top:-9999px';
    document.body.appendChild(inp);
    inp.addEventListener('change',e=>{
      const file=e.target.files&&e.target.files[0];
      document.body.removeChild(inp);
      if(!file)return;
      const reader=new FileReader();
      reader.onload=ev=>{
        const b64=ev.target.result.split(',')[1];
        const mime=file.type||'image/jpeg';
        update({manualLog:{...S.manualLog,imagePreview:ev.target.result,imageData:b64,imageType:mime,analyzing:true,error:''}});
        doAnalyzeFoodPhoto(b64,mime);
      };
      reader.readAsDataURL(file);
    });
    inp.click();
  }

  // ── Delegation (registered once) ───────────────────────────────────────────
  document.getElementById('app').addEventListener('click',e=>{
    // photoBtn replaced by <label> — no longer needs JS click handling
    if(e.target.closest('#receiptPhotoBtn')){
      const inp=document.createElement('input');
      inp.type='file';inp.accept='image/*';
      inp.style.cssText='position:fixed;opacity:0;pointer-events:none;top:-9999px';
      document.body.appendChild(inp);
      inp.addEventListener('change',async ev=>{
        const file=Array.from(ev.target.files||[])[0];
        document.body.removeChild(inp);
        if(!file)return;
        update({pantryReceiptScanning:true,pantryReceiptStatus:'Lese Text vom Kassenbon…'});
        await doScanReceipt(file);
      });
      inp.click();
      return;
    }
    if(e.target.closest('#foodPhotoBtn')){pickFoodPhoto();return;}
    if(e.target.closest('#clearOcrPreview')){update({ocrPreviewUrl:null,menuText:'',menuAnalysis:null});return;}
    const t=e.target.closest('[data-tab],[data-mode],[data-count],[data-stepper],[data-svstep],[data-favtoggle],[data-favedittoggle],[data-favsave],[data-removefridge],[data-swap],[data-undoswap],[data-cancelswap],[data-pickswap],[data-preptime],[data-cookstyle],[data-logmeal],[data-removeimg],[data-clearallimgs],[data-clearmenutext],[data-deletelog],[data-clearlog],[data-pushsensor],[data-pushdailysensor],[data-openmanuallog],[data-closemanuallog],[data-logmode],[data-clearfoodphoto],[data-logforprofile],[data-closelogpicker],[data-openpantryform],[data-closepantryform],[data-savepantryitem],[data-editpantryitem],[data-deletepantryitem],[data-pantrygroup],[data-openreceiptscanner],[data-closereceiptscanner],[data-usetocook],[data-pfcat],[data-pfloc],[data-setgoal],[data-togglegoal]')||e.target;
    if(t.dataset.tab)update({tab:t.dataset.tab});
    if(t.dataset.favedittoggle!==undefined){const i=+t.dataset.favedittoggle;update({editingFav:S.editingFav===i?null:i});}
    if(t.dataset.favsave!==undefined)handleFavSave(+t.dataset.favsave);
    if(t.dataset.mode)update({mode:t.dataset.mode});
    if(t.dataset.count)update({count:+t.dataset.count});
    if(t.dataset.preptime)update({prepTime:t.dataset.preptime});
    if(t.dataset.cookstyle){const v=t.dataset.cookstyle;const cur=S.cookStyles||[];update({cookStyles:cur.includes(v)?cur.filter(x=>x!==v):[...cur,v]});}
    if(t.dataset.stepper)update({[t.dataset.stepper]:Math.max(1,Math.min(12,S[t.dataset.stepper]+(+t.dataset.dir)))});
    if(t.dataset.svstep){const key=t.dataset.svstep;const parts=key.split('_');const ctx=parts[0],idx=+parts[1];const base=(ctx==='result'?S.recipes[idx]:S.favs[idx])?.servings||2;const cur=S.servingOverrides[key]!==undefined?S.servingOverrides[key]:base;update({servingOverrides:{...S.servingOverrides,[key]:Math.max(1,Math.min(20,cur+(+t.dataset.dir)))}});}
    if(t.dataset.favtoggle){const parts=t.dataset.favtoggle.split('_');const ctx=parts[0],idx=+parts[1];const r=ctx==='result'?S.recipes[idx]:S.favs[idx];if(r)doToggleFav(r);}
    if(t.dataset.removefridge!==undefined)update({fridgeItems:S.fridgeItems.filter((_,j)=>j!==+t.dataset.removefridge)});
    if(t.dataset.swap)doSwap(t.dataset.swap,t.dataset.ing,+t.dataset.ri,t.dataset.ctx);
    if(t.dataset.undoswap){const sw={...S.swapState};delete sw[t.dataset.undoswap];update({swapState:sw});}
    if(t.dataset.cancelswap){const sw={...S.swapState};if(sw[t.dataset.cancelswap])delete sw[t.dataset.cancelswap].opts;update({swapState:sw});}
    if(t.dataset.pickswap){const key=t.dataset.pickswap;const sw=S.swapState[key];if(sw?.opts)update({swapState:{...S.swapState,[key]:{swappedTo:sw.opts[+t.dataset.optidx]}}});}
    if(t.dataset.logmeal){const parts=t.dataset.logmeal.split('_');const ctx=parts[0],idx=+parts[1];const r=ctx==='result'?S.recipes[idx]:S.favs[idx];if(r)doLogMeal(r,t.dataset.logmeal);}
    if(t.dataset.removeimg){const id=t.dataset.removeimg;const kept=S.menuImages.filter(i=>i.id!==id);const newText=kept.map(i=>i.text||'').filter(Boolean).join('\n\n---\n\n');update({menuImages:kept,menuText:newText});}
    if(t.dataset.clearallimgs)update({menuImages:[],menuText:'',menuAnalysis:null});
    if(t.dataset.clearmenutext)update({menuText:'',menuAnalysis:null});
    if(t.dataset.deletelog){const id=+t.dataset.deletelog;const nl=S.nutritionLog.filter(e=>e.id!==id);update({nutritionLog:nl});apiSet('nutritionLog',nl);}
    if(t.dataset.clearlog){update({nutritionLog:[]});apiSet('nutritionLog',[]);}
    // Sensor push
    if(t.dataset.pushsensor){const parts=t.dataset.pushsensor.split('_');const ctx=parts[0],idx=+parts[1];const r=ctx==='result'?S.recipes[idx]:S.favs[idx];if(r)doPushRecipeSensor(r,t.dataset.pushsensor);}
    if(t.dataset.pushdailysensor)doPushDailySensor();
    // Manual log modal
    if(t.dataset.openmanuallog)update({manualLog:{...S.manualLog,open:true,error:''}});
    if(t.dataset.closemanuallog)update({manualLog:{...S.manualLog,open:false}});
    if(t.dataset.logmode)update({manualLog:{...S.manualLog,mode:t.dataset.logmode}});
    if(t.dataset.clearfoodphoto)update({manualLog:{...S.manualLog,imagePreview:null,imageData:null,imageType:null}});

    // ── Log for other profile ────────────────────────────────────────────────
    if(t.dataset.logforprofile)doLogForOtherProfile(t.dataset.logforprofile);
    if(t.dataset.closelogpicker)update({logUserPicker:{open:false,entry:null}});

    // ── Pantry ───────────────────────────────────────────────────────────────
    if(t.dataset.openpantryform){
      update({pantryAddOpen:true,pantryEditId:null,
        pantryForm:{name:'',quantity:'1',unit:'g',category:'other',location:'fridge',expirationDate:'',note:''}});
    }
    if(t.dataset.closepantryform)update({pantryAddOpen:false,pantryEditId:null});
    if(t.dataset.pantrygroup)update({pantryGroup:t.dataset.pantrygroup});
    if(t.dataset.pfcat){S.pantryForm={...S.pantryForm,category:t.dataset.pfcat};renderPantryForm();}
    if(t.dataset.pfloc){S.pantryForm={...S.pantryForm,location:t.dataset.pfloc};renderPantryForm();}
    if(t.dataset.editpantryitem){
      const it=S.pantry.find(x=>x.id===t.dataset.editpantryitem);
      if(it)update({pantryEditId:it.id,pantryAddOpen:false,
        pantryForm:{name:it.name,quantity:String(it.quantity||'1'),unit:it.unit||'g',
          category:it.category||'other',location:it.location||'fridge',
          expirationDate:it.expirationDate||'',note:it.note||''}});
    }
    if(t.dataset.deletepantryitem)deletePantryItem(t.dataset.deletepantryitem);
    if(t.dataset.savepantryitem!==undefined)savePantryItem(t.dataset.savepantryitem||null);
    if(t.dataset.openreceiptscanner)update({pantryReceiptOpen:true,pantryReceiptScanning:false});
    if(t.dataset.closereceiptscanner)update({pantryReceiptOpen:false});
    if(t.dataset.usetocook){
      const names=S.pantry.map(i=>i.name+' ('+i.quantity+' '+i.unit+')');
      update({tab:'generate',mode:'fridge',fridgeItems:names.slice(0,20)});
    }
  });
}

// ── Actions ───────────────────────────────────────────────────────────────────
function applyPreset(k){
  const p=PRESETS[k];
  Object.assign(S,{preset:k,...p});
  renderProfile();
}

function profileSnapshot(){
  return{id:S.activeProfileId||Date.now().toString(),healthGoals:S.healthGoals||[],name:S.name,gender:S.gender||'',haUserId:S.haUserId||null,preset:S.preset,
    potassium:S.potassium,phosphorus:S.phosphorus,sodium:S.sodium,calcium:S.calcium,fluid:S.fluid,
    protein:S.protein,oxalate:S.oxalate,purine:S.purine,
    heartHealthy:S.heartHealthy,diabetic:S.diabetic,glutenFree:S.glutenFree,
    hypertension:S.hypertension,gout:S.gout,osteoporosis:S.osteoporosis,
    histamine:S.histamine,lactose:S.lactose,ibs:S.ibs,thyroid:S.thyroid,liver:S.liver,
    calorieTarget:S.calorieTarget||0,
    units:S.units,dietStyle:S.dietStyle,extras:S.extras};
}
function loadProfileData(p){
  // Migrate old single-goal profiles: {healthGoal:'kidney'} → {healthGoals:['kidney']}
  const healthGoals=p.healthGoals||(p.healthGoal?[p.healthGoal]:[]);
  Object.assign(S,{activeProfileId:p.id,healthGoals,name:p.name||'',gender:p.gender||'',haUserId:p.haUserId||null,preset:p.preset||null,
    potassium:p.potassium||'none',phosphorus:p.phosphorus||'none',sodium:p.sodium||'none',
    calcium:p.calcium||'none',fluid:p.fluid||'none',protein:p.protein||'moderate',
    oxalate:p.oxalate||'none',purine:p.purine||'none',
    heartHealthy:!!p.heartHealthy,diabetic:!!p.diabetic,glutenFree:!!p.glutenFree,
    hypertension:!!p.hypertension,gout:!!p.gout,osteoporosis:!!p.osteoporosis,
    histamine:!!p.histamine,lactose:!!p.lactose,ibs:!!p.ibs,thyroid:!!p.thyroid,liver:!!p.liver,
    calorieTarget:p.calorieTarget||0,
    units:p.units||'metric',dietStyle:p.dietStyle||'omnivore',extras:p.extras||''});
}
function loadProfile(id){
  const p=S.profiles.find(x=>x.id===id);
  if(p){loadProfileData(p);renderProfile();render();}
}
function newProfile(){
  S.activeProfileId=Date.now().toString();
  Object.assign(S,{healthGoals:[],name:'',gender:'',haUserId:null,preset:null,potassium:'none',phosphorus:'none',sodium:'none',calcium:'none',fluid:'none',protein:'moderate',oxalate:'none',purine:'none',heartHealthy:false,diabetic:false,glutenFree:false,hypertension:false,gout:false,osteoporosis:false,histamine:false,lactose:false,ibs:false,thyroid:false,liver:false,calorieTarget:0,dietStyle:'omnivore',extras:''});
  renderProfile();
}
async function deleteProfile(id){
  S.profiles=S.profiles.filter(p=>p.id!==id);
  if(S.activeProfileId===id){
    if(S.profiles.length)loadProfileData(S.profiles[0]);
    else S.activeProfileId=null;
  }
  await apiSet('profiles',S.profiles);
  renderProfile();render();
}
async function doSaveProfile(){
  const snap=profileSnapshot();
  const idx=S.profiles.findIndex(p=>p.id===snap.id);
  if(idx>=0)S.profiles[idx]=snap;
  else S.profiles.push(snap);
  S.activeProfileId=snap.id;
  await apiSet('profiles',S.profiles);
  S.profileSaved=true;
  renderProfile();render();
  setTimeout(()=>{S.profileSaved=false;renderProfile();},2500);
}

async function doToggleFav(r){
  const upd=isFav(r)?S.favs.filter(f=>f.name!==r.name):[...S.favs,{...r,savedAt:new Date().toLocaleDateString()}];
  S.favs=upd;await apiSet('favourites',upd);render();
}

function addFridgeItem(){const v=S.fridgeInput.trim();if(v&&!S.fridgeItems.includes(v))S.fridgeItems=[...S.fridgeItems,v];update({fridgeInput:''});}

async function doAnalyzeFoodPhoto(b64,mime){
  try{
    const prompt=`You are a nutrition expert. Analyse this food photo and estimate the nutritional content per serving.
The user's goal is: ${goalContext()}.
Respond ONLY with valid JSON, no markdown:
{"name":"Oatmeal with berries","servings":1,"calories":"380","protein":"12","carbs":"65","fat":"8","potassium":"320","sodium":"180","confidence":"medium"}
Use realistic estimates. confidence: high/medium/low. All values as strings without units.`;
    const r=await fetch(BASE+'rk/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      max_tokens:400,
      messages:[{role:'user',content:[
        {type:'image',source:{type:'base64',media_type:mime,data:b64}},
        {type:'text',text:prompt}
      ]}]
    })});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||'API error');
    const txt=data.content.map(b=>b.text||'').join('');
    const parsed=extractJSON(txt);
    update({manualLog:{...S.manualLog,
      analyzing:false,
      name:parsed.name||S.manualLog.name,
      calories:parsed.calories||'',
      protein:parsed.protein||'',
      carbs:parsed.carbs||'',
      fat:parsed.fat||'',
      potassium:parsed.potassium||'',
      sodium:parsed.sodium||'',
      servings:parseFloat(parsed.servings)||1,
      error:parsed.confidence==='low'?'⚠ Niedrige Konfidenz — bitte Werte prüfen':''
    }});
  }catch(e){
    update({manualLog:{...S.manualLog,analyzing:false,error:'Analyse fehlgeschlagen: '+e.message}});
  }
}

function doSaveManualLog(){
  const ml=S.manualLog;
  if(!ml.name.trim())return;
  const today=new Date().toISOString().slice(0,10);
  const entry={
    id:Date.now(),date:today,mealName:ml.name.trim(),
    servings:ml.servings||1,isManual:true,
    nutrition:{
      calories:ml.calories||'0',protein:ml.protein||'0',
      carbs:ml.carbs||'0',fat:ml.fat||'0',
      potassium:ml.potassium||'0',sodium:ml.sodium||'0'
    }
  };
  const nl=[...S.nutritionLog,entry];
  update({
    nutritionLog:nl,
    manualLog:{open:false,mode:'text',name:'',calories:'',protein:'',potassium:'',sodium:'',carbs:'',fat:'',servings:1,analyzing:false,error:''}
  });
  apiSet('nutritionLog',nl);
}

async function doPushRecipeSensor(r,key){
  update({sensorPushing:{...S.sensorPushing,[key]:'pushing'}});
  const safe=n=>String(n||'').replace(/[^a-z0-9_]/gi,'_').toLowerCase();
  const base=`renalkitchen_recipe_${safe(r.name).slice(0,30)}`;
  const nut=r.nutrition||{};
  const sensors=[
    {entity_id:`${base}_calories`,state:parseFloat(nut.calories)||0,unit:'kcal',icon:'mdi:fire',friendly_name:`${r.name} — Kalorien`},
    {entity_id:`${base}_protein`,state:parseFloat(nut.protein)||0,unit:'g',icon:'mdi:food-steak',friendly_name:`${r.name} — Protein`},
    {entity_id:`${base}_sodium`,state:parseFloat(nut.sodium)||0,unit:'mg',icon:'mdi:shaker-outline',friendly_name:`${r.name} — Natrium`},
    {entity_id:`${base}_potassium`,state:parseFloat(nut.potassium)||0,unit:'mg',icon:'mdi:leaf',friendly_name:`${r.name} — Kalium`},
    {entity_id:`${base}_carbs`,state:parseFloat(nut.carbs)||0,unit:'g',icon:'mdi:grain',friendly_name:`${r.name} — Kohlenhydrate`},
    {entity_id:`${base}_name`,state:r.name,icon:'mdi:food',friendly_name:'RenalKitchen — Letztes Rezept',
      attributes:{emoji:r.emoji||'',prepTime:r.prepTime||'',cookTime:r.cookTime||'',servings:r.servings||1}},
  ];
  try{
    const res=await fetch(BASE+'rk/sensor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sensors})});
    const d=await res.json();
    const ok=res.ok&&d.results?.every(r=>r.ok);
    update({sensorPushing:{...S.sensorPushing,[key]:ok?'ok':'error'}});
    setTimeout(()=>{const sp={...S.sensorPushing};delete sp[key];update({sensorPushing:sp});},4000);
  }catch{update({sensorPushing:{...S.sensorPushing,[key]:'error'}});}
}

// Slugify a profile name for use in HA entity IDs
// "Max Müller" → "max_muller", ensures uniqueness via profileId suffix
function profileSlug(){
  const name=(S.name||'').toLowerCase()
    .replace(/ä/g,'ae').replace(/ö/g,'oe').replace(/ü/g,'ue').replace(/ß/g,'ss')
    .replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,20)||'user';
  return name;
}

async function doPushDailySensor(){
  const slug=profileSlug();
  const today=new Date().toISOString().slice(0,10);
  const log=S.nutritionLog||[];
  const todayLog=log.filter(e=>e.date===today&&(!e.profileId||e.profileId===S.activeProfileId));
  const totals={calories:0,protein:0,potassium:0,sodium:0,carbs:0,fat:0};
  todayLog.forEach(e=>{
    const sv=e.servings||1;const n=e.nutrition||{};
    totals.calories+=parseFloat(n.calories||0)*sv;
    totals.protein+=parseFloat(n.protein||0)*sv;
    totals.potassium+=parseFloat(n.potassium||0)*sv;
    totals.sodium+=parseFloat(n.sodium||0)*sv;
    totals.carbs+=parseFloat(n.carbs||0)*sv;
    totals.fat+=parseFloat(n.fat||0)*sv;
  });
  const calTarget=S.calorieTarget||0;
  // Per-person entity IDs: sensor.renalkitchen_max_daily_calories
  const p=S.name?` (${S.name})`:'';
  const sensors=[
    {entity_id:`renalkitchen_${slug}_daily_calories`,state:Math.round(totals.calories),unit:'kcal',icon:'mdi:fire',friendly_name:`RenalKitchen${p} — Kalorien heute`},
    {entity_id:`renalkitchen_${slug}_daily_protein`,state:Math.round(totals.protein),unit:'g',icon:'mdi:food-steak',friendly_name:`RenalKitchen${p} — Protein heute`},
    {entity_id:`renalkitchen_${slug}_daily_sodium`,state:Math.round(totals.sodium),unit:'mg',icon:'mdi:shaker-outline',friendly_name:`RenalKitchen${p} — Natrium heute`},
    {entity_id:`renalkitchen_${slug}_daily_potassium`,state:Math.round(totals.potassium),unit:'mg',icon:'mdi:leaf',friendly_name:`RenalKitchen${p} — Kalium heute`},
    {entity_id:`renalkitchen_${slug}_daily_carbs`,state:Math.round(totals.carbs),unit:'g',icon:'mdi:grain',friendly_name:`RenalKitchen${p} — Kohlenhydrate heute`},
    {entity_id:`renalkitchen_${slug}_daily_meals`,state:todayLog.length,unit:'Mahlzeiten',icon:'mdi:food-fork-drink',friendly_name:`RenalKitchen${p} — Mahlzeiten heute`},
    ...(calTarget>0?[{entity_id:`renalkitchen_${slug}_daily_calorie_pct`,state:Math.round(totals.calories/calTarget*100),unit:'%',icon:'mdi:percent',friendly_name:`RenalKitchen${p} — Kalorienziel %`}]:[]),
  ];
  try{
    await fetch(BASE+'rk/sensor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sensors})});
    // Brief flash feedback on the button (rebuild tracker)
    render();
  }catch(e){console.error('Sensor push failed',e);}
}

function doLogMeal(r,key){
  const today=new Date().toISOString().slice(0,10);
  const sv=S.servingOverrides[key]||r.servings||1;
  const entry={id:Date.now(),date:today,mealName:r.name,servings:sv,profileId:S.activeProfileId||null,nutrition:r.nutrition||{}};
  const nl=[...S.nutritionLog,entry];
  // If multiple profiles exist, offer to also log for other users
  const otherProfiles=S.profiles.filter(p=>p.id!==S.activeProfileId);
  update({
    nutritionLog:nl,
    loggedThisSession:{...S.loggedThisSession,[key]:true},
    ...(otherProfiles.length?{logUserPicker:{open:true,entry:{...entry},recipeKey:key}}:{})
  });
  apiSet('nutritionLog',nl);
}

function doLogForOtherProfile(profileId){
  const base=S.logUserPicker.entry;
  if(!base)return;
  const entry={...base,id:Date.now()+Math.random(),profileId};
  const nl=[...S.nutritionLog,entry];
  update({nutritionLog:nl,logUserPicker:{...S.logUserPicker,open:false}});
  apiSet('nutritionLog',nl);
}

function renderPantryForm(){
  // Re-render just the pantry form buttons without full render
  render();
}

async function loadPantry(){
  try{
    const r=await fetch(BASE+'rk/pantry');
    const d=await r.json();
    update({pantry:d.items||[],pantryLoaded:true});
  }catch{update({pantry:[],pantryLoaded:true});}
}

async function savePantryItem(editId){
  const f=S.pantryForm;
  if(!f.name.trim())return;
  const body={name:f.name.trim(),quantity:f.quantity,unit:f.unit,
    category:f.category,location:f.location,
    expirationDate:f.expirationDate,note:f.note};
  try{
    let r;
    if(editId){
      r=await fetch(BASE+'rk/pantry/'+editId,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json();
      update({pantry:S.pantry.map(i=>i.id===editId?d.item:i),pantryEditId:null,pantryAddOpen:false});
    }else{
      r=await fetch(BASE+'rk/pantry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const d=await r.json();
      update({pantry:[...S.pantry,d.item],pantryAddOpen:false});
    }
  }catch(e){console.error('Pantry save failed',e);}
}

async function deletePantryItem(id){
  await fetch(BASE+'rk/pantry/'+id,{method:'DELETE'});
  update({pantry:S.pantry.filter(i=>i.id!==id)});
}

async function doScanReceipt(file){
  try{
    // Step 1: OCR — extract raw text from receipt image (same path as menu OCR)
    update({pantryReceiptScanning:true,pantryReceiptStatus:'Lese Text vom Kassenbon…'});
    // ocrImageWithClaude now auto-compresses images before sending
    const rawText=await ocrImageWithClaude(file,'Extract ALL text from this receipt exactly as printed. Preserve every line: product names, quantities, weights, prices. Output raw text only, no interpretation.');

    if(!rawText.trim()){
      update({pantryReceiptScanning:false,pantryReceiptStatus:''});
      alert('Kein Text erkannt. Bitte ein deutlicheres Foto versuchen.');
      return;
    }

    // Step 2: Parse — send raw text to Claude to structure into pantry items
    update({pantryReceiptStatus:'Erkenne Artikel…'});
    const parsePrompt=`This is raw OCR text from a German grocery receipt:

${rawText}

Extract all food/grocery items. Return ONLY valid JSON array, no other text:
[{"name":"...","quantity":"...","unit":"...","category":"..."}]
- category: grain | veg | fruit | protein | dairy | spice | canned | drink | other
- quantity: numeric string (default "1"), unit: g/kg/ml/L/Stück/Pkg./Dose/Bund (default "Stück")
- Skip non-food: Pfand, Tüten, Rabatte, Summe, Steuer
- Use German product names as printed`;

    const r=await fetch(BASE+'rk/claude',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({max_tokens:1500,messages:[{role:'user',content:[{type:'text',text:parsePrompt}]}]})});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||'API error');
    const txt=data.content.map(b=>b.text||'').join('');
    let parsed=extractJSON(txt);
    if(!Array.isArray(parsed))parsed=[];

    if(parsed.length){
      const items=parsed.map(item=>({
        name:item.name||'Unbekannt',quantity:String(item.quantity||'1'),
        unit:item.unit||'Stück',category:item.category||'other',
        location:'fridge',expirationDate:'',note:''
      }));
      const resp=await fetch(BASE+'rk/pantry/bulk',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({items})});
      await resp.json();
      const rp=await fetch(BASE+'rk/pantry');
      const dp=await rp.json();
      update({pantry:dp.items||[],pantryReceiptOpen:false,pantryReceiptScanning:false,pantryReceiptStatus:''});
    }else{
      update({pantryReceiptScanning:false,pantryReceiptStatus:''});
      alert(`Text erkannt, aber keine Artikel gefunden.\n\nRohtext:\n${rawText.slice(0,300)}`);
    }
  }catch(e){
    update({pantryReceiptScanning:false,pantryReceiptStatus:''});
    console.error('Receipt scan failed',e);
    alert('Scan fehlgeschlagen: '+e.message);
  }
}

async function doGenerate(){
  if(S.mode==='fridge')return generateFridge();
  if(S.mode==='adapt')return generateAdapt();
  update({loading:true,error:'',recipes:[],swapState:{},servingOverrides:{}});
  const STYLE_MAP={quick:'under 20 minutes total',easy:'very easy, minimal cooking skill needed',few_ing:'8-10 ingredients or fewer',pantry:'pantry/store-cupboard staples only, no special shopping',meal_prep:'meal-prep friendly, serves multiple days',impress:'impressive presentation, dinner-party worthy',comfort:'comfort food, hearty and warming',light:'light and fresh, low calorie',budget:'budget-friendly with simple inexpensive ingredients',weekend:'leisurely weekend cook, time is not a concern'};
  const styleStr=(S.cookStyles&&S.cookStyles.length)?S.cookStyles.map(v=>STYLE_MAP[v]||v).join(', '):'any style';
  const timeRule=S.prepTime==='quick'?'STRICT: Total time (prep + cook combined) MUST be under 20 minutes. Only suggest dishes that genuinely take this long.':
                 S.prepTime==='medium'?'STRICT: Total time (prep + cook combined) MUST be 20–45 minutes.':
                 S.prepTime==='relaxed'?'Total time should be 45 minutes or more.':'No time constraint.';
  const prompt=`You are a nutrition expert specialising in ${goalContext()}. Generate ${S.count} recipe${S.count>1?'s':''} for ${S.servings} serving${S.servings>1?'s':''} that are specifically optimised for this goal.
Meal type: ${S.mealType==='any'?'any type':S.mealType}
Dietary style: ${S.dietStyle}
${rText()}
Time rule: ${timeRule}
Cooking style: ${styleStr}
Extra requirements: ${extrasStr()}
Units: ${unitStr()}

CRITICAL RULES:
- Every recipe MUST actively support the goal: ${goalContext()}
- The kidneyTip field should be a concise, goal-relevant tip (not always kidney-specific — adapt to the user's actual goal)
- The prepTime and cookTime MUST be realistic for the dish. Do not exaggerate.
- If a dish is quick (stir-fry, salad, pasta, omelette), give it realistic short times.

Respond with ONLY a valid JSON array, no explanation, no markdown fences:
[{"name":"...","emoji":"...","servings":${S.servings},"prepTime":"10 min","cookTime":"15 min","ingredients":["200g cauliflower","..."],"instructions":["Step one...","..."],"nutrition":{${nutShape()}},"kidneyTip":"..."}]`;
  try{
    const t=await claudeRaw([{role:'user',content:prompt}],3000);
    const recipes=extractJSON(t);
    update({loading:false,recipes:Array.isArray(recipes)?recipes:[recipes]});
  }catch(e){update({loading:false,error:e.message});}
}

async function generateFridge(){
  if(!S.fridgeItems.length){update({error:'Add at least one ingredient.'});return;}
  update({loading:true,error:'',recipes:[],swapState:{},servingOverrides:{}});
  const prompt=`You are a nutrition expert for ${goalContext()}. I have these ingredients: ${S.fridgeItems.join(', ')}.
Create ${S.count} recipe${S.count>1?'s':''} for ${S.servings} servings using AS MANY of my ingredients as possible, optimised for my goal.
Meal type: ${S.mealType}, Dietary style: ${S.dietStyle}
${rText()}
Extra: ${extrasStr()}, Units: ${unitStr()}

Respond with ONLY a valid JSON array:
[{"name":"...","emoji":"...","servings":${S.servings},"prepTime":"...","cookTime":"...","fridgeIngredientsUsed":["..."],"ingredients":["..."],"instructions":["..."],"nutrition":{${nutShape()}},"kidneyTip":"..."}]`;
  try{const t=await claudeRaw([{role:'user',content:prompt}],3000);const r=extractJSON(t);update({loading:false,recipes:Array.isArray(r)?r:[r]});}
  catch(e){update({loading:false,error:e.message});}
}

async function generateAdapt(){
  if(!S.dishName.trim()){update({error:'Gib einen Gerichtsnamen ein.'});return;}
  update({loading:true,error:'',recipes:[],swapState:{},servingOverrides:{}});
  const dish=S.dishName.trim();
  const prompt=`Adapt the dish "${dish}" for ${S.servings} servings to support ${goalContext()}.
Dietary style: ${S.dietStyle}. ${rText()}
Extra: ${extrasStr()}, Units: ${unitStr()}

CRITICAL RULES:
- You MUST make "${dish}" specifically. Do not substitute a different dish.
- Keep it recognisable as "${dish}". Only replace ingredients that conflict with the goal/restrictions.
- Set prepTime and cookTime to REALISTIC actual times. Pad Thai = ~10 min prep + 10 min cook. Do not exaggerate.
- The kidneyTip should reflect the user's actual goal (${goalContext()}), not always kidney-specific.

Respond with ONLY a valid JSON array:
[{"name":"${dish} (angepasst)","emoji":"...","servings":${S.servings},"prepTime":"...","cookTime":"...","adaptations":[{"original":"...","replacement":"...","reason":"..."}],"ingredients":["..."],"instructions":["..."],"nutrition":{${nutShape()}},"kidneyTip":"..."}]`;
  try{const t=await claudeRaw([{role:'user',content:prompt}],3000);const r=extractJSON(t);update({loading:false,recipes:Array.isArray(r)?r:[r]});}
  catch(e){update({loading:false,error:e.message});}
}

async function doSwap(swKey,ing,ri,ctx){
  S.swapState={...S.swapState,[swKey]:{swapping:true}};render();
  const r=ctx==='result'?S.recipes[ri]:S.favs[ri];
  try{
    const t=await claudeRaw([{role:'user',content:`Recipe: "${r?.name}". Ingredient to replace: "${ing}". User goal: ${goalContext()}. ${rText()}. Suggest 3 suitable substitute ingredients with quantities. Respond with ONLY a JSON array of 3 strings, e.g. ["200g courgette","150g green beans","100g cabbage"]`}],400);
    const opts=extractJSON(t);
    S.swapState={...S.swapState,[swKey]:{opts:Array.isArray(opts)?opts:Object.values(opts)}};
  }catch{S.swapState={...S.swapState,[swKey]:{err:'Konnte keine Alternativen laden.'}};}
  render();
}

async function doAnalyzeMenu(){
  if(!S.menuText.trim()){update({menuError:'Bitte Menütext eingeben oder ein Bild auswählen.'});return;}
  update({menuLoading:true,menuError:'',menuAnalysis:null});
  const instr=`Du bist ein Ernährungsberater mit Schwerpunkt auf ${goalContext()}. Analysiere diese Restaurantspeisekarte für jemanden mit folgendem Ziel und folgenden Einschränkungen: ${rText()}.
Bewerte jedes Gericht für dieses Ziel und erkläre warum.
Antworte NUR mit validem JSON (kein Markdown, keine Erklärung):
{"restaurantType":"Italienisch","generalTips":["Soße separat bestellen"],"dishes":[{"name":"Caesar Salat","safetyRating":"caution","safetyReason":"Hoher Natriumgehalt durch Dressing","omissions":["Dressing separat bestellen"]}]}
Bewertungen: safe = gut geeignet, caution = mit Anpassungen okay, avoid = nicht empfohlen. Reihenfolge: safe → caution → avoid.

Speisekarte:
${S.menuText.trim()}`;
  try{
    const r=await fetch(BASE+'rk/claude',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({max_tokens:2500,messages:[{role:'user',content:instr}]})});
    const data=await r.json();
    if(!r.ok)throw new Error(data.error||'API Fehler');
    const txt=data.content.map(b=>b.text||'').join('');
    update({menuLoading:false,menuAnalysis:extractJSON(txt)});
  }catch(e){update({menuLoading:false,menuError:e.message});}
}

// ── Init ──────────────────────────────────────────────────────────────────────
initGlobalEvents();
(async function init(){
  const[status,profiles,favs,nutritionLog,haUsersRes]=await Promise.all([
    fetch(BASE+'rk/status').then(r=>r.json()).catch(()=>({configured:false})),
    apiGet('profiles'),
    apiGet('favourites'),
    apiGet('nutritionLog'),
    fetch(BASE+'rk/ha-users').then(r=>r.json()).catch(()=>({users:[]})),
  ]);
  if(profiles&&profiles.length){
    S.profiles=profiles;
    loadProfileData(profiles[0]);
  }
  if(favs)S.favs=favs;
  if(nutritionLog)S.nutritionLog=nutritionLog;
  if(haUsersRes?.users?.length)S.haUsers=haUsersRes.users;
  S.favLoaded=true;
  render();
  // Load pantry async (slightly deferred so main UI is visible first)
  loadPantry();
  update({ready:true,configured:status.configured,haToken:!!status.haToken});
})();

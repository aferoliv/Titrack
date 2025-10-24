/* eslint-disable no-undef */
// App principal para aquisição via Web Serial 
// VERSÃO MESCLADA: Combina funcionalidades das Versões 1 e 2
// - Controle eixo Y, salvamento automático, canais adicionais, auto-exportação (V2)
// - Sistema de beep, logging detalhado, validação de intervalo, configuração flexível (V1)
// 02/09/2025 - Mesclagem personalizada

document.addEventListener("DOMContentLoaded", () => {
  // ===== Utilidades =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const nowFmt = () => {
    const d = new Date();
    return { date: d.toLocaleDateString(), time: d.toLocaleTimeString() };
  };
  const stamp = () => { 
    const d = new Date(); 
    const p = (n)=>String(n).padStart(2,'0'); 
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`; 
  };
  
  // Sistema de beep (da Versão 1)
  const beep = (dur = 120, freq = 440) => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + dur / 1000);
  };
  
  const csvFromRows = (rows, headers) => { 
    if (!rows?.length) return ''; 
    const body = rows.map(r=>headers.map(h=>r[h] ?? '').join(',')).join('\n'); 
    return [headers.join(','), body].join('\n'); 
  };
  const downloadCSV = (rows, filename, headers) => {
    const csv = csvFromRows(rows, headers);
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
  };
  const downloadJSON = (obj, filename) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
  };

  // ===== Elementos =====
  const els = {
    instrumentSelect: $("#instrument"),
    toggleButton: $("#toggle-button"),
    readIntervalValue: $("#read-interval-value"), // Versão 1
    readIntervalUnit: $("#read-interval-unit"),   // Versão 1
    intervalWarning: $("#interval-warning"),      // Versão 1
    realTimeChartCtx: $("#real-time-chart").getContext("2d"),
    experimentChartCtx: $("#experiment-chart").getContext("2d"),
    derivativeChartCtx: $("#derivative-chart").getContext("2d"),
    realTimeTableHead: $("#real-time-table-head"),
    realTimeTableBody: $("#real-time-table-body"),
    experimentTableBody: $("#experiment-table-body"),
    addExperimentDataButton: $("#add-experiment-data-button"),
    downloadRealTimeDataButton: $("#download-real-time-data-button"),
    downloadExperimentDataButton: $("#download-experiment-data-button"),
    downloadDerivativeDataButton: $("#download-derivative-data-button"),
    maxPointsInput: $("#max-points"),
    yMinInput: $("#rt-y-min"),        // Versão 2
    yMaxInput: $("#rt-y-max"),        // Versão 2
    rtFieldSelect: $("#rt-field-select"), // Versão 2
    volumeInput: $("#volume"),
    clearDataButton: $("#clear-data-button"),
    status: $("#status"),
    portInfo: $("#port-info"),
    fileInput: $("#profile-file"),
    profileActions: $("#profile-actions"),
    saveDefault: $("#save-default"),
    supportWarning: $("#support-warning"),
    // Auto-export (Versão 2)
    autoexportStatus: $("#autoexport-status"),
    btnAutoFolder: $("#btn-autoexport-folder"),
    btnAutoDisable: $("#btn-autoexport-disable"),
    btnExportNow: $("#btn-export-now"),
  };

  // ===== Estado =====
  let port, reader, readTimer, updateTimer;
  let buf = "";
  let last = null; // {pH, temperature, ...}
  let rt = [], tit = [], der = [];
  let volumeSum = 0, readCount = 0, titCount = 0;
  let connected = false;
  let profiles = [];
  let currentProfile = null; // Versão 2
  let rtYMin = null, rtYMax = null; // Versão 2
  let rtField = null; // Versão 2

  // ===== Autosave (da Versão 2) =====
  const SESSION_KEY = "serialpha:autosave:v3";
  const MAX_AUTOSAVE_ROWS = 5000;
  const prune = (arr)=> Array.isArray(arr)&&arr.length>MAX_AUTOSAVE_ROWS ? arr.slice(-MAX_AUTOSAVE_ROWS) : arr;
  
  function persistSession(reason = ""){
    try {
      const payload = { 
        ts: Date.now(), 
        reason, 
        rt: prune(rt), 
        tit: prune(tit), 
        der: prune(der), 
        meta: { 
          volumeSum, 
          readCount, 
          titCount, 
          rtYMin, 
          rtYMax, 
          rtField, 
          rtFields: getRTFields() 
        } 
      };
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
      console.log("💾 SESSÃO PERSISTIDA:", reason); // Logging detalhado (V1)
    } catch(e){ 
      console.warn('❌ ERRO persistSession:', e); // Logging detalhado (V1)
    }
  }
  
  function restoreSession(){
    try {
      const saved = localStorage.getItem(SESSION_KEY); 
      if (!saved) return;
      const s = JSON.parse(saved);
      rt = Array.isArray(s.rt)?s.rt:[]; 
      tit = Array.isArray(s.tit)?s.tit:[]; 
      der = Array.isArray(s.der)?s.der:[];
      readCount = Number(s.meta?.readCount)||rt.length; 
      titCount = Number(s.meta?.titCount)||tit.length;
      volumeSum = Number(s.meta?.volumeSum) || (tit.length? Number(tit[tit.length-1].volume)||0 : 0);
      rtYMin = s.meta?.rtYMin ?? null; 
      rtYMax = s.meta?.rtYMax ?? null; 
      rtField = s.meta?.rtField ?? rtField;
      
      updateProfileUI(currentProfile, Array.isArray(s.meta?.rtFields) ? s.meta.rtFields : null);
      if (rtYMin !== null && rtYMin !== "") els.yMinInput.value = rtYMin;
      if (rtYMax !== null && rtYMax !== "") els.yMaxInput.value = rtYMax;
      if (rtField && els.rtFieldSelect.querySelector(`option[value="${rtField}"]`)) els.rtFieldSelect.value = rtField;
      
      renderRTHeaders();
      renderTable(els.realTimeTableBody, rt, getRTHeaders());
      renderTable(els.experimentTableBody, tit, ["time","read","volume","pH","temperature"]);
      
      if (charts.rt) {
        charts.rt.data.datasets[0].data = rt.map(d=>({x:d.read,y:d[rtField]})).filter(p=>p.y !== undefined);
        applyYAxisLimits(); 
        applyYAxisLabel(); 
        charts.rt.update();
      }
      if (charts.tit){ 
        charts.tit.data.datasets[0].data = tit.map(r=>({x:r.volume,y:r.pH})); 
        charts.tit.update(); 
      }
      if (charts.der){ 
        charts.der.data.datasets[0].data = der.map(r=>({x:r.averageVolume,y:r.derivativeValue})); 
        charts.der.update(); 
      }
      if (tit.length) els.addExperimentDataButton.textContent = 'Add';
      toggleDownloads();
      
      console.log("🔄 SESSÃO RESTAURADA:", s.reason || "unknown"); // Logging detalhado (V1)
    } catch(e){ 
      console.warn('❌ ERRO restoreSession:', e); // Logging detalhado (V1)
    }
  }
  
  async function requestPersistentStorage(){ 
    try{ 
      if(navigator.storage?.persist) {
        const granted = await navigator.storage.persist();
        console.log("💾 ARMAZENAMENTO PERSISTENTE:", granted ? "CONCEDIDO" : "NEGADO"); // Logging (V1)
      }
    }catch(e){
      console.warn("❌ ERRO requestPersistentStorage:", e); // Logging (V1)
    } 
  }

  // ===== File System Access (auto-export da Versão 2) =====
  const fs = { dirHandle: null };
  const idbName = 'serialpha-idb', store = 'kvs';
  
  function idbOpen(){ 
    return new Promise((res,rej)=>{ 
      const r = indexedDB.open(idbName,1); 
      r.onupgradeneeded = ()=>{ r.result.createObjectStore(store); }; 
      r.onsuccess=()=>res(r.result); 
      r.onerror=()=>rej(r.error); 
    }); 
  }
  
  async function idbSet(key, val){ 
    const db = await idbOpen(); 
    return new Promise((res,rej)=>{ 
      const tx = db.transaction(store,'readwrite'); 
      tx.objectStore(store).put(val,key); 
      tx.oncomplete=()=>res(); 
      tx.onerror=()=>rej(tx.error); 
    }); 
  }
  
  async function idbGet(key){ 
    const db = await idbOpen(); 
    return new Promise((res,rej)=>{ 
      const tx = db.transaction(store); 
      const req = tx.objectStore(store).get(key); 
      req.onsuccess=()=>res(req.result); 
      req.onerror=()=>rej(req.error); 
    }); 
  }
  
  async function verifyPermission(handle, write){ 
    if (!handle) return false; 
    const opts = write? { mode:'readwrite' } : {}; 
    if ((await handle.queryPermission?.(opts)) === 'granted') return true; 
    return (await handle.requestPermission?.(opts)) === 'granted'; 
  }
  
  async function chooseExportFolder(){
    if (!window.showDirectoryPicker) { 
      alert('Seu navegador não suporta File System Access. Usarei downloads como fallback.'); 
      return; 
    }
    try{
      const dir = await window.showDirectoryPicker();
      if (await verifyPermission(dir,true)) { 
        fs.dirHandle = dir; 
        await idbSet('autoExportDir', dir); 
        updateAutoExportUI(); 
        console.log("📁 PASTA AUTO-EXPORT SELECIONADA"); // Logging (V1)
      }
    } catch(e){ 
      console.log("📁 SELEÇÃO DE PASTA CANCELADA"); // Logging (V1)
    }
  }
  
  async function restoreExportFolder(){
    try{
      const saved = await idbGet('autoExportDir');
      if (saved && await verifyPermission(saved,true)) { 
        fs.dirHandle = saved; 
        console.log("📁 PASTA AUTO-EXPORT RESTAURADA"); // Logging (V1)
      }
    } catch(e){
      console.warn("❌ ERRO restoreExportFolder:", e); // Logging (V1)
    }
    updateAutoExportUI();
  }
  
  function updateAutoExportUI(){ 
    const on = !!fs.dirHandle; 
    els.autoexportStatus.textContent = on? 'Auto-export: On' : 'Auto-export: Off'; 
    els.btnAutoDisable.disabled = !on; 
  }
  
  async function writeTextFile(dirHandle, filename, text){ 
    const fh = await dirHandle.getFileHandle(filename, { create:true }); 
    const w = await fh.createWritable(); 
    await w.write(text); 
    await w.close(); 
  }
  
  async function exportAllToFolder(prefix){
    if (!fs.dirHandle) return false;
    try{
      const ts = stamp();
      if (rt.length){ 
        await writeTextFile(fs.dirHandle, `${prefix}_real_time_${ts}.csv`, csvFromRows(rt,getRTHeaders())); 
      }
      if (tit.length){ 
        await writeTextFile(fs.dirHandle, `${prefix}_titration_${ts}.csv`, csvFromRows(tit,["time","read","volume","pH","temperature"])); 
      }
      if (der.length){ 
        await writeTextFile(fs.dirHandle, `${prefix}_derivative_${ts}.csv`, csvFromRows(der,["averageVolume","derivativeValue"])); 
      }
      console.log("📤 EXPORTAÇÃO PARA PASTA CONCLUÍDA:", prefix); // Logging (V1)
      return true;
    } catch(e){ 
      console.warn('❌ ERRO exportAllToFolder:', e); // Logging (V1)
      return false; 
    }
  }
  
  function exportAllDownloads(prefix){
    const ts = stamp();
    if (rt.length) downloadCSV(rt, `${prefix}_real_time_${ts}.csv`, getRTHeaders());
    if (tit.length) downloadCSV(tit, `${prefix}_titration_${ts}.csv`, ["time","read","volume","pH","temperature"]);
    if (der.length) downloadCSV(der, `${prefix}_derivative_${ts}.csv`, ["averageVolume","derivativeValue"]);
    console.log("📥 DOWNLOAD DE ARQUIVOS CONCLUÍDO:", prefix); // Logging (V1)
  }


  // ===== Perfis (combinado das duas versões) =====
  const DEFAULT_PROFILES = [
    {
      name: " – LUCA210 – Escala pH",
      serial: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" },
      parser: { delimiter: ",", lineTerminator: "\r", fields: ["pH", "temperature"], map: { pH: 0, temperature: 1 },
                validation: { pH: { min: 0, max: 14 } } },
      units: { pH: "", temperature: "°C" },
      timing: { minInterval: 2000 } // 2 segundo mínimo (V1)
    },
    {
      name: " – LUCA210 – Escala Diferença Potencial Elétrico",
      serial: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" },
      parser: { delimiter: ",", lineTerminator: "\r", fields: ["potencial", "temperature"], map: { potencial: 0, temperature: 1 } },
      units: { potencial: "mV", temperature: "°C" },
      timing: { minInterval: 2000 } // 2 segundo mínimo (V1)
    },
    {
      name: "pH Meter 2 (19200),8,1,none",
      serial: { baudRate: 19200, dataBits: 8, stopBits: 1, parity: "none" },
      parser: { delimiter: ",", lineTerminator: "\r\n", fields: ["pH", "temperature"], map: { pH: 0, temperature: 1 } },
      units: { pH: "", temperature: "°C" },
      timing: { minInterval: 500 } // 0.5 segundos mínimo (V1)
    },
    {
      name: "pH 450C",
      serial: { baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none" },
      parser: { delimiter: ";", lineTerminator: "\r\n", fields: ["pH", "temperature"], map: { pH: 0, temperature: 1 } },
      units: { pH: "", temperature: "°C" },
      timing: { minInterval: 200 } // 0.2 segundos mínimo (V1)
    },
    {
      name: "ADS_continuous – Arduino",
      serial: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: "none" },
      parser: { delimiter: ";", lineTerminator: "\n", fields: ["pH"], map: { pH: 0 } },
      units: { pH: "" },
      timing: { minInterval: 100 } // 0.1 segundos mínimo (V1)
    },
    {
      name: "AS7341 – FIA",
      serial: { baudRate: 115200, dataBits: 8, stopBits: 1, parity: "none" },
      parser: { delimiter: ";", lineTerminator: "\n", fields:["pH","ch1","ch2","ch3","ch4","ch5","ch6","ch7","clear","nir"], map:{ "pH":0, "ch1":1, "ch2":2, "ch3":3, "ch4":4, "ch5":5, "ch6":6, "ch7":7, "clear":8, "nir":9 }
      },
      units: {"pH": "a.u." },
      timing: { minInterval: 50 } // 0.05 segundos mínimo (V1)
    }
  ];

  // ===== Funções de conversão de tempo (da Versão 1) =====
  function convertToMilliseconds(value, unit) {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return null;
    
    switch (unit) {
      case 'ms': return num;
      case 's': return num * 1000;
      case 'min': return num * 60 * 1000;
      case 'h': return num * 60 * 60 * 1000;
      default: return null;
    }
  }

  function formatTime(ms) {
    if (ms < 1000) return `${ms} ms`;
    if (ms < 60000) return `${ms / 1000} s`;
    if (ms < 3600000) return `${ms / 60000} min`;
    return `${ms / 3600000} h`;
  }

  function validateInterval() {
    const prof = profiles[Number(els.instrumentSelect.value)];
    if (!prof) return true;

    const value = els.readIntervalValue.value;
    const unit = els.readIntervalUnit.value;
    const ms = convertToMilliseconds(value, unit);
    
    if (!ms) {
      showIntervalWarning("Valor de intervalo inválido");
      return false;
    }

    const minMs = prof.timing?.minInterval || 100;
    if (ms < minMs) {
      showIntervalWarning(`Intervalo mínimo para este instrumento: ${formatTime(minMs)}`);
      return false;
    }

    hideIntervalWarning();
    return true;
  }

  function showIntervalWarning(message) {
    els.intervalWarning.textContent = message;
    els.intervalWarning.style.display = 'block';
  }

  function hideIntervalWarning() {
    els.intervalWarning.style.display = 'none';
  }

  function getCurrentIntervalMs() {
    const value = els.readIntervalValue.value;
    const unit = els.readIntervalUnit.value;
    return convertToMilliseconds(value, unit) || 2000; // fallback para 2s
  }

  function loadProfiles() {
    const saved = localStorage.getItem("instrumentProfiles:v1");
    profiles = saved ? JSON.parse(saved) : DEFAULT_PROFILES;
    renderProfileOptions();
    applyProfileUIFromSelect(); // V2
  }
  
  function saveProfiles() {
    localStorage.setItem("instrumentProfiles:v1", JSON.stringify(profiles));
  }
  
  function renderProfileOptions() {
    els.instrumentSelect.innerHTML = "";
    profiles.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = p.name;
      els.instrumentSelect.add(opt);
    });
    const defIdx = Number(localStorage.getItem("instrumentProfiles:defaultIndex"));
    if (!Number.isNaN(defIdx) && profiles[defIdx]) els.instrumentSelect.value = String(defIdx);
  }

  // ===== Gráficos (combinado das duas versões) =====
  const mkCfg = (label, x, y, maintainAspectRatio = true) => ({
    type: "scatter",
    data: { datasets: [{ label, data: [], showLine: true, borderWidth: 1, pointRadius: 2 }] },
    options: {
      maintainAspectRatio,
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { x: { type: "linear", title: { display: true, text: x } }, y: { title: { display: true, text: y } } }
    },
  });

  // Configuração específica para o gráfico de derivada (sem distorção - V1)
  const mkDerivativeCfg = (label, x, y) => ({
    type: "scatter",
    data: { datasets: [{ label, data: [], showLine: true, borderWidth: 1, pointRadius: 2 }] },
    options: {
      maintainAspectRatio: false, // CHAVE: Desabilita aspect ratio
      responsive: true,
      resizeDelay: 0, // Remove delay no redimensionamento
      plugins: { 
        legend: { display: false },
        // Força redraw no resize
        resize: {
          delay: 0
        }
      },
      scales: { 
        x: { 
          type: "linear", 
          title: { display: true, text: x }
        }, 
        y: { 
          title: { display: true, text: y }
        } 
      },
      // Configurações adicionais para evitar distorção
      animation: {
        duration: 0 // Remove animação que pode causar problemas
      },
      interaction: {
        intersect: false
      }
    },
  });

  const hasChart = typeof window.Chart === "function";
  const charts = {
    rt: hasChart ? new Chart(els.realTimeChartCtx, mkCfg("Tempo real", "# leitura", "valor")) : null,
    tit: hasChart ? new Chart(els.experimentChartCtx, mkCfg("Titulação", "Volume (µL)", "pH")) : null,
    der: hasChart ? new Chart(els.derivativeChartCtx, mkDerivativeCfg("Derivada", "Volume médio (µL)", "dpH/dV ×10³")) : null,
  };

  // Listener para redimensionamento da janela - força resize do gráfico de derivada (V1)
  if (hasChart && charts.der) {
    window.addEventListener('resize', () => {
      setTimeout(() => {
        charts.der.resize();
      }, 100);
    });
  }

  // ===== Profile → UI (da Versão 2) =====
  function getRTFields(){
    if (currentProfile?.parser?.fields?.length) return currentProfile.parser.fields.slice();
    if (rt.length) { const keys = Object.keys(rt[0]).filter(k => !['time','date','read'].includes(k)); if (keys.length) return keys; }
    return ["pH","temperature"];
  }
  
  function renderRTHeaders(){
    const cols = getRTHeaders();
    els.realTimeTableHead.innerHTML = `<tr>${cols.map(c => `<th>${c === 'time' ? 'Hora' : (c === 'read' ? 'Leitura' : c)}</th>`).join('')}</tr>`;
  }
  
  function getRTHeaders(){ return ["time","read", ...getRTFields()]; }
  
  function updateProfileUI(profile, fallbackFields = null){
    const fields = profile?.parser?.fields?.length ? profile.parser.fields : (fallbackFields || getRTFields());
    els.rtFieldSelect.innerHTML = "";
    fields.forEach((f)=>{
      const opt = document.createElement("option"); opt.value = f; opt.textContent = f; els.rtFieldSelect.add(opt);
    });
    if (rtField && fields.includes(rtField)) els.rtFieldSelect.value = rtField;
    else { rtField = fields.includes("pH") ? "pH" : fields[0]; els.rtFieldSelect.value = rtField; }
    renderRTHeaders(); applyYAxisLabel();
  }
  
  function applyProfileUIFromSelect(){
    currentProfile = profiles[Number(els.instrumentSelect.value)] || null;
    updateProfileUI(currentProfile);
  }

  // ===== Y limits (da Versão 2) =====
  function handleYLimitChange(){
    const minVal = els.yMinInput.value.trim();
    const maxVal = els.yMaxInput.value.trim();
    const minNum = minVal === "" ? null : Number(minVal);
    const maxNum = maxVal === "" ? null : Number(maxVal);
    const minValid = (minNum === null) || (!Number.isNaN(minNum));
    const maxValid = (maxNum === null) || (!Number.isNaN(maxNum));
    const orderValid = (minNum === null || maxNum === null) || (minNum < maxNum);
    els.yMinInput.classList.toggle("is-invalid", !minValid || !orderValid);
    els.yMaxInput.classList.toggle("is-invalid", !maxValid || !orderValid);
    if (minValid && maxValid && orderValid){
      rtYMin = minNum; rtYMax = maxNum; applyYAxisLimits(); if (charts.rt) charts.rt.update(); persistSession("rtYLimitsChange");
    }
  }
  
  function applyYAxisLimits(){
    if (!charts.rt) return; const y = charts.rt.options.scales.y;
    if (rtYMin === null || rtYMin === "") delete y.min; else y.min = Number(rtYMin);
    if (rtYMax === null || rtYMax === "") delete y.max; else y.max = Number(rtYMax);
  }
  
  function applyYAxisLabel(){
    if (!charts.rt) return;
    const unit = (currentProfile?.units && currentProfile.units[rtField]) ? ` (${currentProfile.units[rtField]})` : "";
    charts.rt.options.scales.y.title.text = `${rtField}${unit}`;
  }

  // ===== Eventos =====
  els.toggleButton.addEventListener("click", async () => {
    if (connected) await disconnect(); else await connect();
  });
  
  // Eventos para validação de intervalo (V1)
  els.readIntervalValue.addEventListener("input", validateInterval);
  els.readIntervalUnit.addEventListener("change", validateInterval);
  els.instrumentSelect.addEventListener("change", () => {
    validateInterval();
    applyProfileUIFromSelect(); // V2
  });
  
  els.maxPointsInput.addEventListener("change", () => { updateRTChart(); persistSession("maxPointsChange"); });
  els.yMinInput.addEventListener("change", handleYLimitChange); // V2
  els.yMaxInput.addEventListener("change", handleYLimitChange); // V2
  els.rtFieldSelect.addEventListener("change", () => { rtField = els.rtFieldSelect.value || rtField; updateRTChart(true); persistSession("rtFieldChange"); }); // V2
  els.addExperimentDataButton.addEventListener("click", () => { addTitPoint(); persistSession("titAdd"); });
  els.downloadRealTimeDataButton.addEventListener("click", () => downloadCSV(rt, "real_time.csv", getRTHeaders()));
  els.downloadExperimentDataButton.addEventListener("click", () => downloadCSV(tit, "titration.csv", ["time","read","volume","pH","temperature"]));
  els.downloadDerivativeDataButton.addEventListener("click", () => downloadCSV(der, "derivative.csv", ["averageVolume","derivativeValue"]));
  els.clearDataButton.addEventListener("click", () => { clearAllData(); persistSession("clear"); });
  document.addEventListener("keydown", (ev) => { if (ev.ctrlKey && ev.code === "Space") { ev.preventDefault(); addTitPoint(); persistSession("titHotkey"); } });

  // Auto-export UI (V2)
  els.btnAutoFolder.addEventListener("click", chooseExportFolder);
  els.btnAutoDisable.addEventListener("click", async () => { fs.dirHandle=null; await idbSet("autoExportDir", null); updateAutoExportUI(); });
  els.btnExportNow.addEventListener("click", async () => {
    if (fs.dirHandle){
      const ok = await exportAllToFolder("manual");
      if (!ok) alert("Falha ao escrever na pasta. Verifique permissões.");
    } else {
      exportAllDownloads("manual");
    }
  });

  // combo de ações de perfil (V1)
  if (els.profileActions) {
    els.profileActions.addEventListener("change", () => {
      const v = els.profileActions.value;
      if (v === "import") {
        if (!els.fileInput.files?.[0]) els.fileInput.click();
        else importJSONProfiles();
      } else if (v === "export") {
        exportJSONProfiles();
      }
      els.profileActions.value = "";
    });
  }
  // quando usuário escolher arquivo, importamos (V1)
  els.fileInput.addEventListener("change", () => {
    if (els.fileInput.files?.[0]) importJSONProfiles();
  });

  // ===== Lifecycle (V2 + logging V1) =====
  document.addEventListener("visibilitychange", () => { 
    if (document.hidden) {
      persistSession("hidden"); 
      console.log("👁️ PÁGINA OCULTA - dados salvos"); // Logging (V1)
    }
  });
  window.addEventListener("pagehide", () => { 
    persistSession("pagehide"); 
    console.log("📄 PÁGINA FECHANDO - dados salvos"); // Logging (V1)
  });
  window.addEventListener("beforeunload", async () => {
    persistSession("beforeunload");
    console.log("🚪 ANTES DE SAIR - exportando dados"); // Logging (V1)
    if (fs.dirHandle){ 
      try{ await exportAllToFolder("autosave"); }catch(e){ console.warn("❌ ERRO auto-export:", e); } 
    } else { 
      try{ exportAllDownloads("autosave"); } catch(e){ console.warn("❌ ERRO auto-download:", e); } 
    }
  });
  
  if (navigator.serial?.addEventListener){
    navigator.serial.addEventListener("disconnect", async () => {
      try{
        persistSession("serialDisconnect");
        console.log("🔌❌ DESCONEXÃO SERIAL DETECTADA"); // Logging (V1)
        if (!(await exportAllToFolder("disconnect"))) exportAllDownloads("disconnect");
      } finally {
        try{ await disconnect(); } catch(e){ console.warn("❌ ERRO disconnect:", e); }
        alert("Conexão serial perdida. Dados auto-salvos.");
      }
    });
  }

  // ===== Inicialização =====
  if (!("serial" in navigator)) els.supportWarning.hidden = false;
  loadProfiles();
  requestPersistentStorage();
  restoreExportFolder();
  restoreSession();
  validateInterval(); // Validação inicial (V1)


  // ===== Conexão (combinado das duas versões) =====
  async function connect() {
    if (!validateInterval()) { // V1
      alert("Corrija o intervalo de tempo antes de conectar.");
      return;
    }

    applyProfileUIFromSelect(); // V2
    if (!currentProfile) return alert("Seleção de instrumento inválida");
    
    try {
      port = await navigator.serial.requestPort();
      await port.open(currentProfile.serial);
      reader = port.readable.getReader();
      connected = true;
      setStatus("Conectado", port.getInfo());
      startReading(currentProfile);
      setUpdateInterval();
      toggleButton(true);
      persistSession("connect"); // V2
      
      // LOG: Conexão estabelecida (V1)
      console.log("🔌 CONEXÃO ESTABELECIDA");
      console.log("📋 Perfil:", currentProfile.name);
      console.log("⚙️ Configuração serial:", currentProfile.serial);
      console.log("🔧 Parser:", currentProfile.parser);
      console.log("⏱️ Intervalo:", formatTime(getCurrentIntervalMs()));
      
    } catch (e) {
      console.error("❌ ERRO DE CONEXÃO:", e); // V1
      alert("Falha ao conectar. Verifique permissões/cabos e tente novamente.");
      setStatus("Erro ao conectar");
    }
  }
  
  async function disconnect() {
    try {
      if (reader) { await reader.cancel().catch(()=>{}); reader.releaseLock(); }
      if (port) await port.close();
    } finally {
      connected = false;
      clearInterval(readTimer);
      clearInterval(updateTimer);
      toggleButton(false);
      setStatus("Desconectado");
      persistSession("disconnect"); // V2
      console.log("🔌 DESCONECTADO"); // V1
    }
  }
  
  function toggleButton(isConn) {
    els.toggleButton.textContent = isConn ? "Desconectar" : "Conectar";
    els.toggleButton.classList.toggle("btn-warning", isConn);
    els.toggleButton.classList.toggle("btn-success", !isConn);
  }
  
  function setStatus(text, info) {
    els.status.textContent = text;
    if (info) els.portInfo.textContent = `usbVendor=${info.usbVendorId ?? '-'}, usbProduct=${info.usbProductId ?? '-'}`;
    else els.portInfo.textContent = '–';
  }

  // ===== Leitura/Parse (combinado das duas versões) =====
  function startReading(prof) {
    const term = prof.parser?.lineTerminator ?? "\n";
    console.log("📡 INICIANDO LEITURA SERIAL"); // V1
    console.log("🔚 Terminador de linha:", JSON.stringify(term)); // V1
    
    readTimer = setInterval(async () => {
      if (!reader) return;
      try {
        const { value, done } = await reader.read();
        if (done || !value) return;
        
        const rawData = new TextDecoder().decode(value);
        // LOG: Dados brutos recebidos (V1)
        console.log("📥 DADOS BRUTOS:", JSON.stringify(rawData));
        
        buf += rawData;
        let idx;
        while ((idx = buf.indexOf(term)) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + term.length);
          if (!line) continue;
          
          // LOG: Linha completa processada (V1)
          console.log("📄 LINHA PROCESSADA:", JSON.stringify(line));
          
          const parsed = parseLine(line, prof);
          if (parsed) {
            last = parsed;
            // LOG: Dados parseados com sucesso (V1)
            console.log("✅ DADOS PARSEADOS:", parsed);
          } else {
            // LOG: Falha no parse (V1)
            console.log("❌ FALHA NO PARSE da linha:", JSON.stringify(line));
          }
        }
      } catch (e) {
        console.error("❌ ERRO DE LEITURA:", e); // V1
        
        // TRATAMENTO ESPECÍFICO PARA DESCONEXÃO DO DISPOSITIVO (V1)
        if (e instanceof DOMException && e.name === 'NetworkError' && e.message.includes('device has been lost')) {
          console.log("🔌❌ DISPOSITIVO USB DESCONECTADO");
          
          // Interrompe a leitura imediatamente
          clearInterval(readTimer);
          
          // Desconecta e limpa o estado
          await disconnect();
          
          // Mostra mensagem específica para o usuário
          alert("Conexão com instrumento perdida");
          
          return; // Sai da função para evitar mais tentativas de leitura
        }
        
        // Para outros tipos de erro, continua tentando
      }
    }, 100);
  }

  function parseLine(line, prof) {
    const delim = prof.parser?.delimiter ?? ",";
    const fields = prof.parser?.fields || ["pH","temperature"]; // V2
    const map = prof.parser?.map || { pH: 0, temperature: 1 }; // V2

    // Sanitize input: remove NULs and other non-printable control characters, normalize spaces
    const cleaned = String(line)
      .replace(/[\x00-\x1F\x7F]+/g, "")   // remove control characters including \x00
      .replace(/\uFEFF/g, "")               // remove BOM if present
      .replace(/\s+/g, " ")                 // collapse whitespace
      .trim();

    const parts = cleaned.split(delim).map((s) => s.trim());

    // LOG: Detalhes do parsing (V1) — sanitized
    console.log("🔍 PARSING - Delimitador:", JSON.stringify(delim));
    console.log("🔍 PARSING - Linha (sanitizada):", cleaned);
    console.log("🔍 PARSING - Partes:", parts);
    console.log("🔍 PARSING - Mapeamento:", map);

    const data = {}; // V2
    // Prefer canonical keys from map (e.g. { pH:0, temperature:1 }) so internal data uses stable keys
    const canonicalKeys = Object.keys(map && typeof map === 'object' ? map : {}).length ? Object.keys(map) : fields.slice();
    for (const key of canonicalKeys){
      // resolve index: prefer explicit map[key], otherwise fall back to position in fields
      let idx = typeof map[key] === 'number' ? map[key] : fields.indexOf(key);
      if (idx === -1) {
        // last resort: try to find a field that contains the canonical name (case-insensitive/diacritics not handled)
        idx = fields.findIndex(f => String(f).toLowerCase().includes(String(key).toLowerCase()));
        if (idx !== -1) console.debug(`🔁 PARSING - fallback fuzzy index for '${key}' -> ${idx}`);
      }
      if (typeof idx === "number" && idx >= 0 && parts[idx] !== undefined){
        const raw = parts[idx];
        // Extract first numeric token (supports decimals and scientific notation)
        const m = String(raw).match(/[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        const num = m ? parseFloat(m[0]) : NaN;
        data[key] = Number.isNaN(num) ? undefined : num;
      }
    }
    
    // Validação (V1)
    const v = prof.parser?.validation?.pH;

    if (data.pH !== undefined && v){
      if (Number.isNaN(data.pH) || (v.min !== undefined && data.pH < v.min) || (v.max !== undefined && data.pH > v.max)) {
        console.log("❌ VALIDAÇÃO FALHOU para pH:", data.pH, "limites:", v); // V1
        return null;
      }
    }
    
    return data;
  }

  // ===== Update data (combinado das duas versões) =====
  function setUpdateInterval() {
    clearInterval(updateTimer);
    const ms = getCurrentIntervalMs(); // V1
    console.log("⏱️ INTERVALO DE ATUALIZAÇÃO:", formatTime(ms)); // V1
    updateTimer = setInterval(pushRealTime, ms);
    pushRealTime();
  }
  
  function pushRealTime() {
    if (!last) return;
    const row = { ...nowFmt(), read: ++readCount };
    const fields = getRTFields(); // V2
    for (const f of fields){ row[f] = last[f]; } // V2
    rt.push(row);
    renderTable(els.realTimeTableBody, rt, getRTHeaders());
    updateRTChart();
    toggleDownloads();
    els.clearDataButton.disabled = rt.length === 0 && tit.length === 0 && der.length === 0;
  }
  
  function updateRTChart(forceRescale=false) {
    if (!charts.rt) return;
    const maxN = Math.max(1, parseInt(els.maxPointsInput.value, 10));
    const slice = rt.slice(-maxN);
    charts.rt.data.datasets[0].data = slice.map((d) => ({ x: d.read, y: d[rtField] })).filter(p=>p.y !== undefined); // V2
    if (forceRescale) applyYAxisLabel(); // V2
    applyYAxisLimits(); // V2
    charts.rt.update();
  }

  // ===== Titulação / Derivada (combinado das duas versões) =====
  function addTitPoint() {
    if (!last) return;
    const volStep = Math.max(0, parseInt(els.volumeInput.value, 10) || 0);
    let row;
    if (tit.length === 0) {
      row = { ...last, ...nowFmt(), read: ++titCount, volume: 0 };
      els.addExperimentDataButton.textContent = "Add";
    } else {
      volumeSum += volStep;
      row = { ...last, ...nowFmt(), read: ++titCount, volume: volumeSum };
    }
    tit.push(row);
    renderTable(els.experimentTableBody, tit, ["time","read","volume","pH","temperature"]);
    if (charts.tit) { charts.tit.data.datasets[0].data = tit.map((r) => ({ x: r.volume, y: r.pH })); charts.tit.update(); }
    updateDerivative();
    beep(); // V1
    toggleDownloads();
    
    // LOG: Novo ponto de titulação (V1)
    console.log("🧪 NOVO PONTO TITULAÇÃO:", row);
  }
  
  function updateDerivative() {
    der = [];
    for (let i = 1; i < tit.length; i++) {
      const v1 = tit[i - 1].volume, v2 = tit[i].volume;
      const y1 = tit[i - 1].pH,     y2 = tit[i].pH;
      const dv = v2 - v1;
      if (dv === 0) continue;
      const avgV = (v1 + v2) / 2;
      const dYdV = ((y2 - y1) / dv) * 1000; // ×10^3 (V1)
      der.push({ averageVolume: Number(avgV.toFixed(1)), derivativeValue: Number(dYdV.toFixed(2)) });
    }
    if (charts.der) { 
      charts.der.data.datasets[0].data = der.map((r) => ({ x: r.averageVolume, y: r.derivativeValue })); 
      charts.der.update('none'); // Update sem animação para evitar problemas (V1)
    }
  }

  // ===== Tabelas / UI =====
  function renderTable(tbody, data, fields) {
    tbody.innerHTML = data.map((row) => `<tr>${fields.map((f) => `<td>${row[f] ?? ""}</td>`).join("")}</tr>`).join("");
    const wrapper = tbody.closest('.scrollable-table');
    if (wrapper) wrapper.scrollTop = wrapper.scrollHeight;
  }
  
  function toggleDownloads() {
    els.downloadRealTimeDataButton.disabled = rt.length === 0;
    els.downloadExperimentDataButton.disabled = tit.length === 0;
    els.downloadDerivativeDataButton.disabled = der.length === 0;
  }
  
  function clearAllData() {
    rt = []; tit = []; der = []; volumeSum = 0; readCount = 0; titCount = 0;
    renderTable(els.realTimeTableBody, rt, []);
    renderTable(els.experimentTableBody, tit, []);
    [charts.rt, charts.tit, charts.der].forEach((c) => { if (!c) return; c.data.datasets[0].data = []; c.update(); });
    toggleDownloads();
    els.clearDataButton.disabled = true;
    console.log("🗑️ DADOS LIMPOS"); // V1
  }

  // ===== Import/Export de perfis JSON (da Versão 1) =====
  function validateProfileObject(obj) {
    // Aceita {name, serial, parser} ou {instruments:[...]}
    const asList = Array.isArray(obj?.instruments) ? obj.instruments : (Array.isArray(obj) ? obj : [obj]);
    const valid = [];
    for (const p of asList) {
      if (!p || typeof p.name !== 'string' || !p.serial) continue;
      const serial = p.serial;
      if (typeof serial.baudRate !== 'number') continue;
      valid.push({
        name: p.name,
        serial: {
          baudRate: serial.baudRate,
          dataBits: serial.dataBits ?? 8,
          stopBits: serial.stopBits ?? 1,
          parity: serial.parity ?? 'none',
        },
        parser: {
          delimiter: p.parser?.delimiter ?? ',',
          lineTerminator: p.parser?.lineTerminator ?? '\n',
          fields: p.parser?.fields ?? ['pH','temperature'],
          map: p.parser?.map ?? { pH: 0, temperature: 1 },
          validation: p.parser?.validation ?? { pH: { min: 0, max: 14 } },
        },
        units: p.units ?? {},
        timing: p.timing ?? { minInterval: 100 }, // Adiciona timing se não existir (V1)
      });
    }
    return valid;
  }
  
  async function importJSONProfiles() {
    const f = els.fileInput.files?.[0];
    if (!f) { alert('Selecione um arquivo .json'); return; }
    try {
      const text = await f.text();
      const json = JSON.parse(text);
      const list = validateProfileObject(json);
      if (list.length === 0) return alert('JSON inválido para perfis de instrumento.');
      profiles = profiles.concat(list);
      renderProfileOptions();
      saveProfiles();
      alert(`${list.length} perfil(is) importado(s).`);
      applyProfileUIFromSelect(); // V2
      console.log("📥 PERFIS IMPORTADOS:", list.length); // V1
    } catch (e) {
      console.error("❌ ERRO importJSONProfiles:", e); // V1
      alert('Falha ao importar JSON.');
    } finally {
      // limpa o input para permitir reimportar o mesmo arquivo
      els.fileInput.value = '';
    }
  }
  
  function exportJSONProfiles() {
    const payload = { version: 1, instruments: profiles };
    downloadJSON(payload, 'instrument_profiles.json');
    console.log("📤 PERFIS EXPORTADOS"); // V1
  }
});


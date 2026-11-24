/* =========================================================================
 * tga.js — TGA 탭 UI (그래프·목록·분석 표·단계 표·내보내기)
 * 엔진: tga-core.js (window.TGAC), 렌더러: app-plot.js (window.FTIRPlot)
 * ========================================================================= */
(function () {
  'use strict';
  const P = window.FTIRPlot, T = window.TGAC;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fm = (v, d) => (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toFixed(d === undefined ? 1 : d);
  const now = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });
  const PALETTE = ['#4f9dff', '#ff7a59', '#3ddc97', '#c792ea', '#ffd166', '#67e8f9',
    '#f472b6', '#a3e635', '#fb923c', '#94a3b8', '#e879f9', '#34d399'];

  let uid = 0;
  const st = {
    traces: [], selectedId: null, geom: null, legendRects: [],
    view: {
      stacked: false, gap: 0.35, rev: false, grid: true,
      peaksOn: true, labelsOn: false, labelMinProm: 0, summaryOn: true,
      lo: 30, hi: 800, fontSize: 13, legendOn: true, legendPos: 'out', legendScale: 1,
      exportBg: 'transparent', exportFmt: 'journal', exportWidth: '180', exportDpi: 300, exportFont: '',
      xLabel: 'Temperature (°C)', yLabel: 'Weight (%)'
    },
    cfg: { smooth: 5, tempCol: null, wtCol: null, yLo: 0, yHi: 105, sumCodes: '' },
    res: {}      /* id → analyze 결과 */
  };

  /* ------------------------------------------------------------- 로그 */
  function log(msg, cls) {
    const el = $('tLog'); if (!el) return;
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.innerHTML = `<span class="t">${now()}</span>  ${esc(msg)}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  /* -------------------------------------------------------- trace 관리 */
  function newTrace(name, x, y, meta) {
    const t = {
      id: 't' + (++uid), name: name, legend: '', color: PALETTE[st.traces.length % PALETTE.length],
      width: 1.6, dash: 'solid', alpha: 1, visible: true,
      x: x, y: y, peaks: [], meta: meta || {}
    };
    t.p = { x: x, y: y };
    st.traces.push(t);
    return t;
  }
  const getT = (id) => st.traces.find((t) => t.id === id) || null;
  const sel = () => getT(st.selectedId);
  const smoothedY = (y) => { const w = Math.max(1, Math.round(+st.cfg.smooth || 1)); return w > 1 ? T.smooth(y, w) : y; };

  function refreshP(t) { t.p = { x: t.x, y: smoothedY(t.y) }; }

  /* --------------------------------------------------------- 분석 */
  function runAnalysis(t, quiet) {
    if (!t || !t.x || t.x.length < 6) return null;
    const r = T.analyze(t.x, t.y, { smoothWin: Math.max(1, Math.round(+st.cfg.smooth || 1)) });
    st.res[t.id] = r;
    // 주요 지점을 피크 마커로 표시 (T5 / Td onset / Tmax)
    const pk = [];
    const at = (xv) => {
      const p = t.p; let best = 0;
      for (let i = 0; i < p.x.length; i++) if (Math.abs(p.x[i] - xv) < Math.abs(p.x[best] - xv)) best = i;
      return p.y[best];
    };
    if (r.t5 !== null) pk.push({ x: r.t5, y: at(r.t5), prom: 1, label: 'T5 ' + r.t5.toFixed(0), kind: 't5' });
    if (r.td !== null) pk.push({ x: r.td, y: at(r.td), prom: 0.9, label: 'Td ' + r.td.toFixed(0), kind: 'td' });
    if (r.tmax !== null) pk.push({ x: r.tmax, y: at(r.tmax), prom: 0.8, label: 'Tmax ' + r.tmax.toFixed(0), kind: 'tmax' });
    t.peaks = pk;
    if (!quiet) {
      log(`${t.legend || t.name}: T5 ${fm(r.t5)} °C · Td,onset ${fm(r.td)} °C · Tmax ${fm(r.tmax)} °C · 잔량 ${fm(r.residue, 2)} % · 단계 ${r.steps.length}`, 'ok');
    }
    return r;
  }

  /* --------------------------------------------------- 요약(사이드) 패널 */
  function summarySpec() {
    if (!st.view.summaryOn) return null;
    const vis = st.traces.filter((t) => t.visible && st.res[t.id]);
    if (!vis.length) return null;
    const names = vis.map((t) => (t.legend || t.name).replace(/\s*\(합성\)/, ''));
    const manual = (st.cfg.sumCodes || '').split(',').map((s) => s.trim()).filter(Boolean);
    const auto = names.some((n) => n.length > 11);
    const cats = vis.map((t, i) => manual[i] || (auto ? ('S' + (i + 1)) : names[i]));
    const mk = (key, color, marker, unit, fmt, below) => vis.map((t, i) => {
      const r = st.res[t.id];
      const v = key === 't5' ? r.t5 : key === 'td' ? r.td : key === 'residue' ? r.residue
        : key === 'tmax' ? r.tmax : key === 't50' ? r.t50 : null;
      return (v === null || !isFinite(v)) ? null : {
        cat: i, y: v, color: color, marker: marker, below: !!below,
        text: (fmt === 0 ? Math.round(v) : v.toFixed(fmt === undefined ? 1 : fmt)) + unit,
        textShort: (fmt === 0 ? Math.round(v) : v.toFixed(fmt === undefined ? 1 : fmt))
      };
    }).filter(Boolean);

    return {
      panels: [
        {
          title: 'T5% — 규정 감량 온도',
          yLabel: 'T5% (°C)', yFmt: 0, categories: cats,
          points: mk('t5', '#1f4e79', 'circle', ' °C', 1)
        },
        {
          title: 'Td onset — 분해 개시(외삽)',
          yLabel: 'Td (°C)', yFmt: 0, categories: cats,
          points: mk('td', '#b23a2e', 'diamond', ' °C', 1)
        },
        {
          title: '최종 잔량 (Final residue)',
          yLabel: 'Residue (%)', yFmt: 1, yMin: 0, categories: cats,
          points: mk('residue', '#1f4e79', 'circle', ' %', 2)
        }
      ]
    };
  }

  /* ------------------------------------------------------------ 그리기 */
  function renderPlot() {
    const cv = $('tPlot'); if (!cv) return;
    const sum = summarySpec();
    const state = {
      traces: st.traces.map((t) => ({ id: t.id, name: t.name, legend: t.legend, color: t.color,
        lineW: t.width, dash: t.dash, alpha: t.alpha, visible: t.visible, p: t.p, peaks: t.peaks })),
      view: Object.assign({}, st.view),
      theme: {}, selectedId: st.selectedId, summary: sum
    };
    // TGA 는 중량 % 축을 그대로 쓴다 → normHeight 끔, y 범위 지정
    state.view.normHeight = false;
    const g = P.render(cv, state, {});
    st.geom = g.geom; st.legendRects = g.legendRects;
  }

  function renderList() {
    const ul = $('tList'); if (!ul) return;
    ul.innerHTML = '';
    st.traces.forEach((t) => {
      const li = document.createElement('li');
      li.className = 'item' + (t.id === st.selectedId ? ' sel' : '');
      li.innerHTML = `<span class="dot" style="background:${t.color}"></span>
        <span class="nm">${esc(t.legend || t.name)}</span>
        <span class="sub">${t.x.length}점 · ${fm(t.x[0], 0)}–${fm(t.x[t.x.length - 1], 0)} °C</span>
        <span class="acts">
          <button class="mini" data-act="vis" title="표시/숨김">${t.visible ? '◉' : '○'}</button>
          <button class="mini" data-act="up" title="위로">↑</button>
          <button class="mini" data-act="down" title="아래로">↓</button>
          <button class="mini" data-act="del" title="삭제">×</button>
        </span>`;
      li.onclick = (e) => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'vis') { t.visible = !t.visible; renderAll(); return; }
        if (act === 'del') { st.traces = st.traces.filter((z) => z !== t); delete st.res[t.id]; renderAll(); return; }
        if (act === 'up' || act === 'down') {
          const i = st.traces.indexOf(t), j = act === 'up' ? i - 1 : i + 1;
          if (j >= 0 && j < st.traces.length) { st.traces[i] = st.traces[j]; st.traces[j] = t; renderAll(); }
          return;
        }
        st.selectedId = t.id; renderAll();
      };
      ul.appendChild(li);
    });
    const n = $('tCount'); if (n) n.textContent = st.traces.length;
    syncStyle();
  }

  function syncStyle() {
    const t = sel();
    const dis = !t;
    ['tName', 'tLegend', 'tColor', 'tWidth', 'tDash', 'tAlpha'].forEach((id) => { if ($(id)) $(id).disabled = dis; });
    if (!t) return;
    $('tName').value = t.name; $('tLegend').value = t.legend || '';
    $('tColor').value = t.color; $('tWidth').value = t.width;
    $('tDash').value = t.dash; $('tAlpha').value = t.alpha;
  }

  function renderTables() {
    const tb = $('tResTable'); if (!tb) return;
    const body = tb.querySelector('tbody');
    body.innerHTML = '';
    const vis = st.traces;
    if (!vis.length) {
      body.innerHTML = '<tr><td colspan="9" class="muted">TGA 데이터를 불러오면 여기에 결과가 표시됩니다.</td></tr>';
      const sb = $('tStepTable') && $('tStepTable').querySelector('tbody');
      if (sb) sb.innerHTML = '';
      return;
    }
    vis.forEach((t) => {
      const r = st.res[t.id];
      const tr = document.createElement('tr');
      if (t.id === st.selectedId) tr.className = 'sel';
      tr.innerHTML = `<td>${esc(t.legend || t.name)}</td>
        <td>${r ? fm(r.t5) : '—'}</td>
        <td>${r ? fm(r.t10) : '—'}</td>
        <td>${r ? fm(r.t50) : '—'}</td>
        <td>${r ? fm(r.td) : '—'}</td>
        <td>${r ? fm(r.tmax) : '—'}</td>
        <td>${r ? fm(r.residue, 2) : '—'}</td>
        <td>${r ? fm(r.totalLoss, 2) : '—'}</td>
        <td>${r ? (r.steps.length || '—') : '—'}</td>`;
      tr.onclick = () => { st.selectedId = t.id; renderAll(); };
      body.appendChild(tr);
    });

    // 단계 표
    const stb = $('tStepTable');
    if (stb) {
      const sb = stb.querySelector('tbody');
      sb.innerHTML = '';
      const target = sel() || vis[0];
      const r = target && st.res[target.id];
      if (!r || !r.steps.length) {
        sb.innerHTML = '<tr><td colspan="5" class="muted">선택 시료의 중량 감소 단계가 없습니다.</td></tr>';
      } else {
        r.steps.forEach((s, i) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${esc(target.legend || target.name)}</td><td>${i + 1}</td>
            <td>${fm(s.t0, 0)}–${fm(s.t1, 0)}</td><td>${fm(s.loss, 1)}</td><td>${fm(s.to, 1)}</td>`;
          sb.appendChild(tr);
        });
      }
    }
    updateTabInfo();
  }

  function updateTabInfo() {
    const vis = st.traces.filter((t) => t.visible).length;
    const el = $('tTabInfo');
    if (el) el.textContent = `${st.traces.length} 시료 · 표시 ${vis} · 분석 ${Object.keys(st.res).length}`;
  }

  function renderAll() { renderList(); renderPlot(); renderTables(); }

  /* ------------------------------------------------------------ 파일 */
  function loadFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    let done = 0;
    list.forEach((f) => {
      const rd = new FileReader();
      rd.onload = () => {
        const p = T.parseText(String(rd.result || ''), f.name.replace(/\.[^.]+$/, ''), {
          tempCol: st.cfg.tempCol, wtCol: st.cfg.wtCol
        });
        if (!p.ok) { log(`${f.name}: ${p.reason}`, 'warn'); return; }
        const t = newTrace(p.name, p.x, p.y, { cols: p.cols, tempCol: p.tempCol, wtCol: p.wtCol, unit: p.unit });
        refreshP(t);
        runAnalysis(t, true);
        log(`${f.name}: ${p.x.length}점 · ${fm(p.x[0], 0)}–${fm(p.x[p.x.length - 1], 0)} °C · 온도열 ${p.tempCol} / 중량열 ${p.wtCol} (${p.cols}열, ${p.delim})`, 'ok');
        p.warnings.forEach((w) => log('  · ' + w, 'warn'));
        st.selectedId = t.id;
        renderAll();
      };
      rd.readAsText(f, 'utf-8');
      done++;
    });
    if (done) log(`${done}개 파일 처리 시작`);
  }

  function openFiles() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.txt,.csv,.tsv,.asc,.dat';
    inp.multiple = true;
    inp.onchange = () => loadFiles(inp.files);
    inp.click();
  }

  function demo() {
    const d = T.synthDemo();
    st.traces = []; st.res = {}; st.selectedId = null;
    d.forEach((s) => {
      const t = newTrace(s.name, s.data.x, s.data.y, { note: s.note });
      refreshP(t);
      runAnalysis(t, true);
    });
    if (st.traces.length) st.selectedId = st.traces[0].id;
    renderAll();
    log(`데모 데이터 로드: ${d.length}개 (합성 TGA — 실측값 아님)`);
  }

  /* ------------------------------------------------------------ 내보내기 */
  function toCSV() {
    const rows = [['시료', 'T5 (°C)', 'T10 (°C)', 'T50 (°C)', 'Td onset (°C)', 'Tmax (°C)', '잔량 (%)', '총감량 (%)', '단계 수']];
    st.traces.forEach((t) => {
      const r = st.res[t.id]; if (!r) return;
      rows.push([t.legend || t.name, fm(r.t5), fm(r.t10), fm(r.t50), fm(r.td), fm(r.tmax), fm(r.residue, 2), fm(r.totalLoss, 2), r.steps.length]);
    });
    rows.push([]);
    rows.push(['시료', '단계', '구간 (°C)', '손실 (%)', '종료 중량 (%)']);
    st.traces.forEach((t) => {
      const r = st.res[t.id]; if (!r) return;
      r.steps.forEach((s, i) => rows.push([t.legend || t.name, i + 1, `${fm(s.t0, 0)}–${fm(s.t1, 0)}`, fm(s.loss, 1), fm(s.to, 1)]));
    });
    const csv = rows.map((r) => r.join(',')).join('\r\n');
    download('tga-result-' + Date.now() + '.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
    log('분석 결과 CSV 저장', 'ok');
  }

  async function png() {
    if (!st.traces.length) { log('내보낼 TGA 곡선이 없습니다', 'warn'); return; }
    const fmt = st.view.exportFmt || 'journal';
    const o = { wmm: parseInt(st.view.exportWidth, 10) || 180, dpi: parseInt(st.view.exportDpi, 10) || 300,
      labelMinProm: 0, fontFamily: st.view.exportFont || '' };
    if (o.fontFamily && !(await P.ensureFont(o.fontFamily))) log('서체 "' + o.fontFamily + '" 를 불러오지 못했습니다 — 대체 서체로 저장합니다', 'warn');
    const sum = summarySpec();
    const base = {
      traces: st.traces.map((t) => ({ id: t.id, name: t.name, legend: t.legend, color: t.color,
        lineW: t.width, dash: t.dash, alpha: t.alpha, visible: t.visible, p: t.p, peaks: t.peaks })),
      view: Object.assign({}, st.view, { normHeight: false }),
      theme: {}, selectedId: null, summary: sum
    };
    let opts, s = base, tag;
    if (fmt === 'screen') {
      const bg = st.view.exportBg || 'transparent';
      opts = { scale: 2, bg: bg };
      tag = '화면 그대로 (2배) · 배경 ' + (bg === 'transparent' ? '투명' : bg === 'white' ? '흰색' : '앱 테마');
    } else {
      const pre = P.formatPreset(fmt, o);
      s = P.stateForFormat(base, fmt, o);
      // 저널 포맷은 기본적으로 범례를 숨기지만, 겹쳐보기(TGA 기본)에서는 시료 구분이 필요하다
      if (fmt === 'journal' && !s.view.stacked) {
        s.view = Object.assign({}, s.view, { legendOn: true, legendPos: 'tr', legendScale: 0.72 });
      }
      const h = fmt === 'journal' ? Math.round(pre.width * (o.wmm > 120 ? 0.46 : 0.58)) : pre.height;
      opts = { scale: 1, bg: pre.bg, width: pre.width, height: h, font: pre.font, margin: pre.margin, nameMax: pre.nameMax };
      tag = pre.label + (fmt === 'journal' ? ' · ' + pre.width + '×' + h + ' px' : '');
    }
    const url = P.toPNG($('tPlot'), s, opts);
    download('tga-plot-' + Date.now() + '.png', dataURLtoBlob(url), 'image/png');
    log('PNG 내보내기 — ' + tag + (sum ? ' · 요약 패널 포함' : ''), 'ok');
  }

  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  function dataURLtoBlob(url) {
    const parts = url.split(',');
    const bin = atob(parts[1]);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: 'image/png' });
  }

  /* ------------------------------------------------------------ 프로젝트 */
  function saveProject() {
    const prj = {
      app: 'ftir-studio', tab: 'tga', version: 1,
      view: st.view, cfg: st.cfg,
      traces: st.traces.map((t) => ({ name: t.name, legend: t.legend, color: t.color, width: t.width,
        dash: t.dash, alpha: t.alpha, visible: t.visible, x: t.x, y: t.y }))
    };
    download('tga-project-' + Date.now() + '.json', JSON.stringify(prj), 'application/json');
    log('프로젝트 저장', 'ok');
  }

  function loadProject() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const prj = JSON.parse(String(rd.result || '{}'));
          if (!prj.traces) throw new Error('시료 데이터가 없습니다');
          st.traces = []; st.res = {}; st.selectedId = null;
          if (prj.view) Object.assign(st.view, prj.view);
          if (prj.cfg) Object.assign(st.cfg, prj.cfg);
          prj.traces.forEach((d) => {
            const t = newTrace(d.name, d.x, d.y, {});
            t.legend = d.legend || ''; t.color = d.color || t.color; t.width = d.width || 1.6;
            t.dash = d.dash || 'solid'; t.alpha = d.alpha === undefined ? 1 : d.alpha;
            t.visible = d.visible !== false;
            refreshP(t); runAnalysis(t, true);
          });
          if (st.traces.length) st.selectedId = st.traces[0].id;
          syncControls(); renderAll();
          log('프로젝트 열기: ' + st.traces.length + ' 시료', 'ok');
        } catch (e) { log('프로젝트 열기 실패: ' + e.message, 'warn'); }
      };
      rd.readAsText(f, 'utf-8');
    };
    inp.click();
  }

  /* ------------------------------------------------------------ 컨트롤 */
  function syncControls() {
    $('tViewMode').value = st.view.stacked ? 'stacked' : 'overlay';
    $('tGap').value = st.view.gap;
    $('tGrid').checked = !!st.view.grid;
    $('tPeaks').checked = !!st.view.peaksOn;
    $('tLabels').checked = !!st.view.labelsOn;
    $('tSummary').checked = !!st.view.summaryOn;
    $('tFont').value = st.view.fontSize;
    $('tLegendPos').value = st.view.legendPos;
    $('tExportFmt').value = st.view.exportFmt;
    $('tExportWidth').value = String(st.view.exportWidth);
    $('tExportDpi').value = String(st.view.exportDpi);
    if ($('tExportFont')) $('tExportFont').value = st.view.exportFont || '';
    $('tExportBg').value = st.view.exportBg;
    $('tLo').value = st.view.lo; $('tHi').value = st.view.hi;
    $('tSmooth').value = st.cfg.smooth;
    $('tSumCodes').value = st.cfg.sumCodes || '';
  }

  function rerunAll(quiet) {
    st.traces.forEach((t) => runAnalysis(t, quiet));
    renderAll();
  }

  function bind() {
    if (!$('tList')) return;

    const on = (id, fn) => { const e = $(id); if (e) e.onclick = fn; };

    on('tOpen', openFiles);
    on('tDemo', demo);
    on('tShowAll', () => { st.traces.forEach((t) => t.visible = true); renderAll(); });
    on('tHideAll', () => { st.traces.forEach((t) => t.visible = false); renderAll(); });
    on('tClear', () => {
      if (!st.traces.length) return;
      st.traces = []; st.res = {}; st.selectedId = null; renderAll(); log('모든 TGA 시료 삭제');
    });
    on('tRunSel', () => { runAnalysis(sel(), false); renderAll(); });
    on('tRunAll', () => { rerunAll(false); });
    on('tCSV', toCSV);
    on('tSave', saveProject);
    on('tLoad', loadProject);

    // 스타일
    const onStyle = () => {
      const t = sel(); if (!t) return;
      t.name = $('tName').value || t.name;
      t.legend = $('tLegend').value;
      t.color = $('tColor').value;
      t.width = Math.max(0.5, +$('tWidth').value || 1.6);
      t.dash = $('tDash').value;
      t.alpha = Math.min(1, Math.max(0.1, +$('tAlpha').value || 1));
      renderAll();
    };
    ['tName', 'tLegend', 'tColor', 'tWidth', 'tDash', 'tAlpha'].forEach((id) => { $(id).oninput = onStyle; $(id).onchange = onStyle; });

    // 표시 설정
    const onView = () => {
      st.view.stacked = $('tViewMode').value === 'stacked';
      st.view.gap = Math.max(0, +$('tGap').value || 0);
      st.view.grid = $('tGrid').checked;
      st.view.peaksOn = $('tPeaks').checked;
      st.view.labelsOn = $('tLabels').checked;
      st.view.summaryOn = $('tSummary').checked;
      st.view.fontSize = Math.max(8, +$('tFont').value || 13);
      st.view.legendPos = $('tLegendPos').value;
      st.view.exportFmt = $('tExportFmt').value;
      st.view.exportWidth = parseInt($('tExportWidth').value, 10) || 180;
      st.view.exportDpi = parseInt($('tExportDpi').value, 10) || 300;
      if ($('tExportFont')) st.view.exportFont = $('tExportFont').value || '';
      st.view.exportBg = $('tExportBg').value;
      const lo = +$('tLo').value, hi = +$('tHi').value;
      if (isFinite(lo) && isFinite(hi) && Math.abs(hi - lo) > 5) { st.view.lo = lo; st.view.hi = hi; }
      const tc = $('tTempCol').value, wc = $('tWtCol').value;
      st.cfg.tempCol = (tc === '' || tc === null) ? null : (parseInt(tc, 10) || 0);
      st.cfg.wtCol = (wc === '' || wc === null) ? null : (parseInt(wc, 10) || 0);
      const sm = +$('tSmooth').value;
      if (isFinite(sm) && sm !== st.cfg.smooth) { st.cfg.smooth = Math.max(1, sm | 0); st.traces.forEach(refreshP); rerunAll(true); }
      const codes = $('tSumCodes').value;
      if (codes !== st.cfg.sumCodes) st.cfg.sumCodes = codes;
      renderPlot(); renderTables();
    };
    ['tViewMode', 'tGap', 'tGrid', 'tPeaks', 'tLabels', 'tSummary', 'tFont', 'tLegendPos',
      'tExportFmt', 'tExportWidth', 'tExportDpi', 'tExportFont', 'tExportBg', 'tLo', 'tHi', 'tSmooth', 'tSumCodes']
      .forEach((id) => { const e = $(id); if (e) { e.onchange = onView; e.oninput = onView; } });

    // 아래쪽 탭
    document.querySelectorAll('#mainTga .dtag').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('#mainTga .dtag').forEach((z) => z.classList.toggle('active', z === b));
        document.querySelectorAll('#tBottom .panel').forEach((p) => p.classList.toggle('active', p.id === 'tpanel-' + b.dataset.dtag));
      };
    });
    if ($('tClearLog')) $('tClearLog').onclick = () => { $('tLog').innerHTML = ''; };
    if ($('tDemo2')) $('tDemo2').onclick = demo;
    if ($('tOpen2')) $('tOpen2').onclick = openFiles;

    // 아래 패널 높이 조절
    const rz = $('tResizer'), main = $('mainTga');
    if (rz && main) {
      let drag = false, y0 = 0, h0 = 0;
      const H = () => parseInt(getComputedStyle(main).getPropertyValue('--bottomH') || '300', 10) || 300;
      rz.onmousedown = (e) => { drag = true; y0 = e.clientY; h0 = H(); e.preventDefault(); };
      window.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const h = Math.max(90, Math.min(window.innerHeight - 220, h0 - (e.clientY - y0)));
        main.style.setProperty('--bottomH', h + 'px');
      });
      window.addEventListener('mouseup', () => { drag = false; });
      rz.ondblclick = () => main.style.setProperty('--bottomH', H() < 60 ? '300px' : '34px');
    }

    // 드래그앤드롭
    const dz = $('tDrop');
    if (dz) {
      dz.onclick = openFiles;
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('hot'); }));
      ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('hot'); }));
      dz.addEventListener('drop', (e) => loadFiles(e.dataTransfer.files));
    }
    window.addEventListener('dragover', (e) => { if (window.APP_TAB === 'tga') e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (window.APP_TAB !== 'tga') return;
      if (dz && e.target instanceof Node && dz.contains(e.target)) return;
      e.preventDefault();
      loadFiles(e.dataTransfer.files);
    });
  }

  /* 창 크기·탭 전환 시 다시 그리기 */
  let _rt = 0;
  const redrawSoon = () => { clearTimeout(_rt); _rt = setTimeout(() => { renderPlot(); }, 80); };
  window.addEventListener('resize', redrawSoon);
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('.ttab');
    if (b && b.dataset.ttab === 'tga') setTimeout(renderPlot, 60);
  });

  window.TGAUI = { openFiles, png, loadProject, saveProject, demo, bind, renderPlot, state: st };
  document.addEventListener('DOMContentLoaded', () => { bind(); syncControls(); });
  if (document.readyState !== 'loading') { bind(); syncControls(); }
})();

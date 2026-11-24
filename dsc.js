/* =========================================================================
 * dsc.js — DSC 탭 UI (그래프·목록·분석 표·내보내기)
 * 엔진: dsc-core.js (window.DSCC), 렌더러: app-plot.js (window.FTIRPlot)
 * ========================================================================= */
(function () {
  'use strict';
  const P = window.FTIRPlot, D = window.DSCC;
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
      stacked: true, normHeight: true, gap: 0.35, rev: false, grid: true,
      peaksOn: true, labelsOn: true, labelMinProm: 0, summaryOn: true,
      lo: 20, hi: 320, fontSize: 13, legendOn: true, legendPos: 'out', legendScale: 1,
      exportBg: 'transparent',
      exportFmt: 'journal', exportWidth: '180', exportDpi: 300, exportFont: '',
      xLabel: 'Temperature (°C)', yLabel: 'Heat flow (mW/mg)'
    },
    cfg: {
      mass: 5, beta: 20, unit: 'mW/mg', smooth: 3,
      pk1: 180, pk2: 250, tg1: 30, tg2: 90,
      refKey: 'PA6', refVal: 190, tempCol: null, hfCol: null,
      auto: true, autoHalf: 25
    },
    res: {}      /* id → {peak, tg, xc} */
  };

  /* ------------------------------------------------------------- 로그 */
  function log(msg, cls) {
    const el = $('dLog'); if (!el) return;
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.innerHTML = `<span class="t">${now()}</span>  ${esc(msg)}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  /* -------------------------------------------------------- trace 관리 */
  function newTrace(name, x, y, meta) {
    const t = {
      id: 'd' + (++uid), name: name, legend: '', color: PALETTE[st.traces.length % PALETTE.length],
      width: 1.6, dash: 'solid', alpha: 1, visible: true,
      x: x, y: y, peaks: [], meta: meta || {}
    };
    t.p = { x: x, y: y };
    st.traces.push(t);
    return t;
  }
  const getT = (id) => st.traces.find((t) => t.id === id) || null;
  const sel = () => getT(st.selectedId);

  /* 표시용 스무딩(분석에도 동일 적용) */
  function smoothedY(y) {
    const w = Math.max(1, Math.round(+st.cfg.smooth || 1));
    return w > 1 ? D.smooth(y, w) : y;
  }
  function refreshP(t) { t.p = { x: t.x, y: smoothedY(t.y) }; }

  /* 자동 구간 · 베이스라인 (피크 밖 영역 적합 — DSC 표준 관행)
   * 1) 스캔 양끝 평균을 잇는 직선에서 출발
   * 2) 최대 편차점(피크)을 찾고, 피크 주변(±12~18 % 구간)을 뺀 나머지로 직선 재적합 ×3
   * 3) 그 직선 대비 편차가 최대의 1 % 아래로 떨어질 때까지 확장 + 8 % 패딩 → 적분 구간
   * 4) Tg: 피크 앞쪽 영역에서 |기울기| 이동평균이 최대인 곳을 중심으로 확장
   * → 문턱·현(chord) 방식과 달리 넓은 피크(경화 발열)도 ΔH 가 보존된다.
   */
  function autoDetect(t) {
    const x = t.x, y = t.p.y, n = x.length;
    const out = { pkLo: x[0], pkHi: x[n - 1], tgLo: x[0], tgHi: x[n - 1], noPeak: false };
    if (n < 12) { out.noPeak = true; return out; }

    const e = Math.max(5, Math.round(n * 0.05));
    let bx0 = D.mean(x.slice(0, e)), by0 = D.mean(y.slice(0, e));
    let bx1 = D.mean(x.slice(n - e)), by1 = D.mean(y.slice(n - e));
    let m = (by1 - by0) / ((bx1 - bx0) || 1), b = by0 - m * bx0;

    let bi = 0, resSd = 0;
    for (let pass = 0; pass < 3; pass++) {
      let bd = 0;
      for (let i = 0; i < n; i++) {
        const d = y[i] - (m * x[i] + b);
        if (Math.abs(d) > Math.abs(bd)) { bd = d; bi = i; }
      }
      const half = (x[n - 1] - x[0]) * (0.12 + pass * 0.03);
      const xs = [], ys = [];
      for (let i = 0; i < n; i++) if (Math.abs(x[i] - x[bi]) > half) { xs.push(x[i]); ys.push(y[i]); }
      if (xs.length < 10) break;
      const f = D.linfit(xs, ys);
      m = f.a; b = f.b;
      // 잔차 표준편차(피크 제외 구간) → 피크 유무 판정
      let s = 0;
      for (let i = 0; i < xs.length; i++) { const d = ys[i] - (m * xs[i] + b); s += d * d; }
      resSd = Math.sqrt(s / xs.length);
    }

    let bd = 0;
    for (let i = 0; i < n; i++) {
      const d = y[i] - (m * x[i] + b);
      if (Math.abs(d) > Math.abs(bd)) { bd = d; bi = i; }
    }

    // 피크가 잔차 대비 충분히 큰가
    if (Math.abs(bd) < Math.max(4 * resSd, 1e-9)) out.noPeak = true;

    const thr = Math.abs(bd) * 0.01;
    let li = bi, ri = bi;
    if (thr > 0 && !out.noPeak) {
      while (li > 0 && Math.abs(y[li - 1] - (m * x[li - 1] + b)) > thr) li--;
      while (ri < n - 1 && Math.abs(y[ri + 1] - (m * x[ri + 1] + b)) > thr) ri++;
    }
    const pad = Math.max(1, Math.round((x[ri] - x[li]) * 0.08));
    out.pkLo = Math.max(x[0], x[li] - pad);
    out.pkHi = Math.min(x[n - 1], x[ri] + pad);
    out.peakX = x[bi];
    out.baseFit = { m: m, b: b };
    out.sign = bd >= 0 ? 1 : -1;
    out.resSd = resSd;

    // Tg — 피크 앞쪽에서 기울기 이동평균 최대
    const sl = new Float64Array(n);
    for (let i = 1; i < n - 1; i++) sl[i] = (y[i + 1] - y[i - 1]) / ((x[i + 1] - x[i - 1]) || 1);
    const w = Math.max(5, Math.round(n * 0.02)), asl = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = i - w; k <= i + w; k++) { if (k < 0 || k >= n) continue; s += Math.abs(sl[k]); c++; }
      asl[i] = c ? s / c : 0;
    }
    const preEnd = out.noPeak ? x[n - 1] : Math.max(x[0] + (x[n - 1] - x[0]) * 0.15, out.pkLo - 10);
    let ti = -1, ts = 0;
    for (let i = 0; i < n; i++) {
      if (x[i] > preEnd) break;
      if (asl[i] > ts) { ts = asl[i]; ti = i; }
    }
    if (ti >= 0 && ts > 0) {
      const tthr = ts * 0.35;
      let a = ti, bb = ti;
      while (a > 0 && asl[a - 1] > tthr) a--;
      while (bb < n - 1 && asl[bb + 1] > tthr) bb++;
      out.tgLo = Math.max(x[0], x[a] - 8);
      out.tgHi = Math.min(x[n - 1], x[bb] + 8, preEnd);
    }
    return out;
  }

  /* ------------------------------------------------------------ 분석 */
  function runAnalysis(t, quiet) {
    if (!t) return null;
    const cfg = st.cfg;
    const y = smoothedY(t.y);
    t.p = { x: t.x, y: y };
    const base = { x: t.x, y: y, beta: cfg.beta, unit: cfg.unit, mass: cfg.mass };
    let pkLo, pkHi, tgW1, tgW2, baseFit = null, noPeak = false;
    if (cfg.auto) {
      const w = autoDetect(t);
      pkLo = w.pkLo; pkHi = w.pkHi; tgW1 = w.tgLo; tgW2 = w.tgHi;
      baseFit = w.baseFit; noPeak = !!w.noPeak;
    } else {
      pkLo = cfg.pk1; pkHi = cfg.pk2; tgW1 = cfg.tg1; tgW2 = cfg.tg2;
    }
    const pkOpt = Object.assign({ x1: pkLo, x2: pkHi }, base);
    if (baseFit) pkOpt.baseFit = baseFit;
    const pk = noPeak
      ? { ok: false, reason: '뚜렷한 피크 없음 (자동 검출)' }
      : (pkHi > pkLo) ? D.analyzePeak(pkOpt) : { ok: false, reason: '피크 구간이 올바르지 않습니다' };
    if (pk.ok) { pk.x1 = pkLo; pk.x2 = pkHi; }
    // Tg 구간은 데이터 범위로 클램프
    const tx0 = t.x[0], tx1 = t.x[t.x.length - 1];
    const tgLo = Math.max(tx0, Math.min(tgW1, tgW2)), tgHi = Math.min(tx1, Math.max(tgW1, tgW2));
    const tg = (tgHi - tgLo > 5) ? D.analyzeTg(Object.assign({ x1: tgLo, x2: tgHi }, base))
      : { ok: false, reason: 'Tg 구간이 데이터 범위를 벗어났습니다' };
    const xc = (pk.ok && cfg.refVal > 0) ? D.crystallinity(pk.dH, cfg.refVal) : null;
    if (pk.ok && pk.dH !== null && Math.abs(pk.dH) < 2 && !cfg.auto && !quiet) {
      pk.note = 'weak';
    }
    st.res[t.id] = { peak: pk, tg: tg, xc: xc, at: now() };

    // 그래프 마커
    const marks = [];
    if (tg.ok && tg.tgMid !== null) {
      marks.push({ x: tg.tgMid, y: D.interpAt(t.x, y, tg.tgMid), prom: 0.5, label: 'Tg ' + tg.tgMid.toFixed(1) });
    }
    if (pk.ok) {
      marks.push({ x: pk.peakX, y: pk.peakY, prom: 1, label: pk.peakX.toFixed(1) });
      if (pk.onset !== null) marks.push({ x: pk.onset, y: D.interpAt(t.x, y, pk.onset), prom: 0.3, label: 'on' });
      if (pk.endset !== null) marks.push({ x: pk.endset, y: D.interpAt(t.x, y, pk.endset), prom: 0.3, label: 'end' });
    }
    t.peaks = marks;

    if (!quiet) {
      if (pk.ok && pk.note === 'weak') log(`${t.name}: 구간 ${fm(pk.x1, 0)}–${fm(pk.x2, 0)} °C 에 뚜렷한 피크가 없습니다 (ΔH≈0). 구간을 조정하거나 '피크 구간 자동'을 켜세요`, 'warn');
      if (pk.ok) {
        log(`${t.name}: 구간 ${fm(pk.x1, 0)}–${fm(pk.x2, 0)} °C · 피크 ${fm(pk.peakX)} °C · onset ${fm(pk.onset)} / endset ${fm(pk.endset)} °C · ΔH ${fm(pk.dH)} J/g` +
          (xc !== null ? ` · 결정화도 ${fm(xc)} %` : '') + (pk.dHnote ? ' (' + pk.dHnote + ')' : ''), pk.dH === null ? 'warn' : 'ok');
      } else log(`${t.name}: 피크 분석 실패 — ${pk.reason}`, 'warn');
      if (tg.ok) log(`${t.name}: Tg(중간) ${fm(tg.tgMid)} °C (onset ${fm(tg.tgOnset)} / end ${fm(tg.tgEnd)}) · ΔCp ${fm(tg.dCp, 3)} J/(g·K)`, 'ok');
      else log(`${t.name}: Tg 분석 실패 — ${tg.reason}`, 'warn');
    }
    return st.res[t.id];
  }

  /* ------------------------------------------------------------ 그리기 */
  /* 우측 요약(사이드) 패널 — 전이점·ΔH만 따로 */
  function summarySpec() {
    if (!st.view.summaryOn) return null;
    const vis = st.traces.filter((t) => t.visible && st.res[t.id]);
    if (!vis.length) return null;
    const names = vis.map((t) => (t.legend || t.name).replace(/\s*\(합성\)/, ''));
    const auto = names.some((n) => n.length > 11);
    const cats = names.map((n, i) => (auto ? ('S' + (i + 1)) : n));
    const tPts = [], hPts = [];
    vis.forEach((t, i) => {
      const r = st.res[t.id] || {};
      const pk = r.peak && r.peak.ok ? r.peak : null;
      const tg = r.tg && r.tg.ok ? r.tg : null;
      if (pk && isFinite(pk.peakX)) {
        const endo = pk.sign >= 0;
        tPts.push({ cat: i, y: pk.peakX, color: endo ? '#1f4e79' : '#b23a2e',
          marker: endo ? 'circle' : 'diamond', below: !endo,
          text: (endo ? 'Tm ' : 'Tc ') + pk.peakX.toFixed(1) + ' °C', textShort: pk.peakX.toFixed(1) });
      }
      if (tg && isFinite(tg.tgMid)) {
        tPts.push({ cat: i, y: tg.tgMid, color: '#1f7a4d', marker: 'square',
          text: 'Tg ' + tg.tgMid.toFixed(1), textShort: tg.tgMid.toFixed(1) });
      }
      if (pk && isFinite(pk.dH)) {
        hPts.push({ cat: i, y: Math.abs(pk.dH), color: '#1f4e79', marker: 'circle',
          text: Math.abs(pk.dH).toFixed(1) + ' J/g', textShort: Math.abs(pk.dH).toFixed(1) });
      }
    });
    if (!tPts.length && !hPts.length) return null;
    return {
      panels: [
        { title: '전이 온도 (Transition temperatures)', yLabel: 'Temperature (°C)', yFmt: 0, categories: cats,
          legend: [{ name: 'Tm', color: '#1f4e79', marker: 'circle' },
                   { name: 'Tc', color: '#b23a2e', marker: 'diamond' },
                   { name: 'Tg', color: '#1f7a4d', marker: 'square' }],
          points: tPts },
        { title: '피크 면적 (ΔH)', yLabel: 'ΔH (J/g)', yFmt: 1, yMin: 0, categories: cats, points: hPts }
      ]
    };
  }

  function renderPlot() {
    const cv = $('dPlot'); if (!cv) return;
    if (!cv.clientWidth) return;
    st.summary = summarySpec();
    const out = P.render(cv, st, {});
    st.geom = cv._geom; st.legendRects = (out && out.legendRects) || [];
    updateTabInfo();
  }

  function renderList() {
    const ul = $('dList'); if (!ul) return;
    ul.innerHTML = '';
    st.traces.forEach((t, i) => {
      const li = document.createElement('li');
      if (t.id === st.selectedId) li.className = 'sel';
      if (!t.visible) li.classList.add('hidden-trace');
      const unit = t.meta && t.meta.unit ? t.meta.unit : '';
      li.innerHTML = `<span class="sw" style="background:${t.color}"></span>
        <span class="nm">${esc(t.legend || t.name)}<small>${t.x.length}점 · ${fm(t.x[0], 0)}–${fm(t.x[t.x.length - 1], 0)} °C · ${esc(unit)}</small></span>
        <button class="ico" data-act="vis" title="표시/숨김">${t.visible ? '●' : '○'}</button>
        <button class="ico" data-act="up" title="위로">↑</button>
        <button class="ico" data-act="down" title="아래로">↓</button>
        <button class="ico" data-act="del" title="삭제">✕</button>`;
      li.onclick = (e) => {
        const b = e.target.closest('button');
        if (b) {
          const a = b.dataset.act;
          if (a === 'vis') t.visible = !t.visible;
          if (a === 'up' && i > 0) { st.traces.splice(i, 1); st.traces.splice(i - 1, 0, t); }
          if (a === 'down' && i < st.traces.length - 1) { st.traces.splice(i, 1); st.traces.splice(i + 1, 0, t); }
          if (a === 'del') { st.traces = st.traces.filter((z) => z !== t); delete st.res[t.id]; if (st.selectedId === t.id) st.selectedId = st.traces.length ? st.traces[0].id : null; }
        } else st.selectedId = t.id;
        renderAll();
      };
      ul.appendChild(li);
    });
    $('dCount').textContent = st.traces.length;
    syncStyle();
  }

  function syncStyle() {
    const t = sel(); const on = !!t;
    ['dName', 'dLegend', 'dColor', 'dWidth', 'dDash', 'dAlpha'].forEach((id) => { if ($(id)) $(id).disabled = !on; });
    if (!on) return;
    $('dName').value = t.name; $('dLegend').value = t.legend || '';
    $('dColor').value = t.color; $('dWidth').value = t.width;
    $('dDash').value = t.dash; $('dAlpha').value = t.alpha;
  }

  function renderTables() {
    const tb = $('dResTable').querySelector('tbody'); if (!tb) return;
    tb.innerHTML = '';
    const pk2 = $('dPkTable').querySelector('tbody');
    if (pk2) pk2.innerHTML = '';
    st.traces.forEach((t) => {
      const r = st.res[t.id];
      const tr = document.createElement('tr');
      if (t.id === st.selectedId) tr.className = 'sel';
      const pk = r && r.peak && r.peak.ok ? r.peak : null;
      const tg = r && r.tg && r.tg.ok ? r.tg : null;
      const note = !r ? '미분석'
        : (!pk ? (r.peak && r.peak.reason ? r.peak.reason : '피크 구간 확인')
          : (pk.dH === null ? 'ΔH 계산 불가(단위/질량)' : (tg ? '' : 'Tg 미검출')));
      tr.innerHTML = `<td>${esc(t.legend || t.name)}</td>
        <td class="num">${tg ? fm(tg.tgMid) : '—'}</td><td class="num">${tg ? fm(tg.tgOnset) : '—'}</td>
        <td class="num">${tg ? fm(tg.tgEnd) : '—'}</td><td class="num">${tg ? fm(tg.dCp, 3) : '—'}</td>
        <td class="num">${pk ? fm(pk.onset) : '—'}</td><td class="num">${pk ? fm(pk.peakX) : '—'}</td>
        <td class="num">${pk ? fm(pk.endset) : '—'}</td>
        <td class="num">${pk ? fm(pk.dH, 2) : '—'}</td>
        <td class="num">${r && r.xc !== null && r.xc !== undefined ? fm(r.xc) : '—'}</td>
        <td>${esc(note)}</td>`;
      tr.onclick = () => { st.selectedId = t.id; renderAll(); };
      tb.appendChild(tr);

      if (pk2 && pk) {
        const tr2 = document.createElement('tr');
        tr2.innerHTML = `<td>${esc(t.legend || t.name)}</td><td>${fm(pk.x1, 0)}–${fm(pk.x2, 0)}</td>
          <td class="num">${fm(pk.peakX)}</td><td class="num">${fm(pk.height, 3)}</td>
          <td class="num">${fm(pk.area, 3)}</td><td class="num">${fm(pk.onset)}</td><td class="num">${fm(pk.endset)}</td>
          <td>${pk.sign >= 0 ? '흡열' : '발열'}</td>`;
        pk2.appendChild(tr2);
      }
      if (pk2 && tg) {
        const tr3 = document.createElement('tr');
        tr3.innerHTML = `<td>${esc(t.legend || t.name)}</td><td>${fm(tg.x1, 0)}–${fm(tg.x2, 0)} (Tg)</td>
          <td class="num">${fm(tg.tgMid)}</td><td class="num">${fm(tg.step, 4)}</td><td class="num">—</td>
          <td class="num">${fm(tg.tgOnset)}</td><td class="num">${fm(tg.tgEnd)}</td><td>스텝</td>`;
        pk2.appendChild(tr3);
      }
    });
  }

  function updateTabInfo() {
    const el = $('dTabInfo'); if (!el) return;
    const n = st.traces.length, a = Object.keys(st.res).length;
    el.textContent = `${n} 시료 · 분석 ${a}건 · β ${st.cfg.beta} °C/min`;
  }

  function renderAll() { renderList(); renderPlot(); renderTables(); }

  /* --------------------------------------------------------- 파일 읽기 */
  function loadFiles(files) {
    const arr = Array.from(files || []);
    if (!arr.length) return;
    let done = 0;
    arr.forEach((f) => {
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const r = D.parseText(rd.result, f.name, { tempCol: st.cfg.tempCol, hfCol: st.cfg.hfCol });
          if (!r.ok) { log(`${f.name}: 읽기 실패 — ${r.reason}`, 'err'); return; }
          const name = f.name.replace(/\.[^.]+$/, '');
          const t = newTrace(name, r.x, r.y, { unit: r.unit, dir: r.dir, meta: r.meta, raw: String(rd.result), file: f.name });
          st.selectedId = t.id;
          st.cfg.unit = r.unit;
          if ($('dUnit')) $('dUnit').value = r.unit;
          log(`${f.name}: ${r.x.length}점 · ${fm(r.x[0], 0)}–${fm(r.x[r.x.length - 1], 0)} °C · 단위 ${r.unit} · 온도열 ${r.meta.tempCol} / 열유량열 ${r.meta.hfCol} (${r.meta.cols}열, ${r.meta.delim}, ${r.dir === 'cool' ? '냉각' : '가열'})`, 'ok');
          r.warnings.forEach((w) => log('  · ' + w, 'warn'));
          runAnalysis(t, true);
          done++;
          renderAll();
        } catch (e) { log(`${f.name}: 처리 오류 — ${e.message}`, 'err'); }
      };
      rd.onerror = () => log(`${f.name}: 파일을 읽을 수 없습니다`, 'err');
      rd.readAsText(f);
    });
  }

  function openFiles() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.multiple = true;
    inp.accept = '.txt,.csv,.tsv,.dpt,.asc,.dat';
    inp.onchange = () => loadFiles(inp.files);
    inp.click();
  }

  function demo() {
    const arr = D.synthDemo();
    st.traces = []; st.res = {}; st.selectedId = null;
    arr.forEach((d) => {
      const t = newTrace(d.name, d.data.x, d.data.y, { unit: 'mW/mg', dir: 'heat', synth: true });
      t.color = d.color;
    });
    st.cfg.unit = 'mW/mg'; st.cfg.beta = 20; st.cfg.mass = 5;
    if ($('dUnit')) $('dUnit').value = 'mW/mg';
    if ($('dBeta')) $('dBeta').value = 20;
    st.selectedId = st.traces[0].id;
    st.view.lo = 20; st.view.hi = 320;
    if ($('dLo')) $('dLo').value = 20; if ($('dHi')) $('dHi').value = 320;
    st.traces.forEach((t) => runAnalysis(t, true));
    renderAll();
    log(`데모 데이터 로드: ${arr.length}개 (합성 DSC — 실측값 아님). 분석 설정의 피크 구간 180–250 °C, Tg 구간 30–90 °C 기준으로 자동 분석했습니다.`, 'warn');
  }

  /* ------------------------------------------------------------- 내보내기 */
  function toCSV() {
    const rows = [['시료', 'Tg 중간(°C)', 'Tg 시작(°C)', 'Tg 끝(°C)', 'ΔCp(J/g·K)', 'Tm 시작(°C)', 'Tm 피크(°C)', 'Tm 끝(°C)', 'ΔH(J/g)', '결정화도(%)', 'ΔHm°(J/g)', '질량(mg)', '가열속도(°C/min)', '단위']];
    st.traces.forEach((t) => {
      const r = st.res[t.id]; if (!r) return;
      const pk = r.peak && r.peak.ok ? r.peak : {};
      const tg = r.tg && r.tg.ok ? r.tg : {};
      rows.push([t.legend || t.name, tg.tgMid, tg.tgOnset, tg.tgEnd, tg.dCp, pk.onset, pk.peakX, pk.endset, pk.dH, r.xc, st.cfg.refVal, st.cfg.mass, st.cfg.beta, st.cfg.unit]
        .map((v) => (v === null || v === undefined || (typeof v === 'number' && !isFinite(v))) ? '' : (typeof v === 'number' ? +v.toFixed(4) : String(v).replace(/,/g, ';'))));
    });
    const csv = rows.map((r) => r.join(',')).join('\r\n');
    download('dsc-result-' + Date.now() + '.csv', '\uFEFF' + csv, 'text/csv;charset=utf-8');
    log('분석 결과 CSV 저장', 'ok');
  }

  async function png() {
    if (!st.traces.length) { log('내보낼 DSC 곡선이 없습니다', 'warn'); return; }
    const fmt = st.view.exportFmt || 'journal';
    const o = {
      wmm: parseInt(st.view.exportWidth, 10) || 180,
      dpi: parseInt(st.view.exportDpi, 10) || 300, fontFamily: st.view.exportFont || '',
      labelMinProm: st.view.labelMinProm
    };
    if (o.fontFamily && !(await P.ensureFont(o.fontFamily))) log('서체 "' + o.fontFamily + '" 를 불러오지 못했습니다 — 대체 서체로 저장합니다', 'warn');
    let opts, s = st, tag;
    if (fmt === 'screen') {
      const bg = st.view.exportBg || 'transparent';
      opts = { scale: 2, bg: bg };
      tag = '화면 그대로 (2배) · 배경 ' + (bg === 'transparent' ? '투명' : bg === 'white' ? '흰색' : '앱 테마');
    } else {
      const pre = P.formatPreset(fmt, o);
      s = P.stateForFormat(st, fmt, o);
      // DSC 는 세로가 긴 곡선이라 저널 높이를 조금 더 준다
      const h = fmt === 'journal' ? Math.round(pre.width * (o.wmm > 120 ? 0.42 : 0.52)) : pre.height;
      // 저널 도판에서는 on/end 보조 라벨을 빼고 피크·Tg 만 남긴다(지면에서 글자가 겹침)
      if (fmt === 'journal') {
        s = Object.assign({}, s, {
          traces: s.traces.map((t) => Object.assign({}, t, {
            peaks: (t.peaks || []).filter((pk) => !/^(on|end|tg)/i.test((pk.label || '').trim()))
          }))
        });
      }
      opts = { scale: 1, bg: pre.bg, width: pre.width, height: h, font: pre.font, margin: pre.margin, nameMax: pre.nameMax };
      tag = pre.label + (fmt === 'journal' ? ' · ' + pre.width + '×' + h + ' px' : '');
    }
    const url = P.toPNG($('dPlot'), s, opts);
    download('dsc-plot-' + Date.now() + '.png', dataURLtoBlob(url), 'image/png');
    log('PNG 내보내기 — ' + tag, 'ok');
  }

  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  function dataURLtoBlob(url) {
    const [head, b64] = url.split(',');
    const mime = (head.match(/:(.*?);/) || [])[1] || 'image/png';
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  /* -------------------------------------------------------- 프로젝트 저장 */
  function saveProject() {
    const data = {
      app: 'ftir-studio-dsc', version: 1,
      view: st.view, cfg: st.cfg,
      traces: st.traces.map((t) => ({ name: t.name, legend: t.legend, color: t.color, width: t.width, dash: t.dash, alpha: t.alpha, visible: t.visible, x: t.x, y: t.y, meta: { unit: t.meta.unit, dir: t.meta.dir } }))
    };
    download('dsc-project-' + Date.now() + '.json', JSON.stringify(data), 'application/json');
    log('DSC 프로젝트 저장 (' + st.traces.length + ' 시료)', 'ok');
  }
  function loadProject() {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
    inp.onchange = () => {
      const f = inp.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const d = JSON.parse(rd.result);
          if (!d || !d.traces) throw new Error('DSC 프로젝트 파일이 아닙니다');
          st.traces = []; st.res = {};
          Object.assign(st.view, d.view || {});
          Object.assign(st.cfg, d.cfg || {});
          d.traces.forEach((t) => {
            const nt = newTrace(t.name, t.x, t.y, t.meta || {});
            nt.legend = t.legend || ''; nt.color = t.color; nt.width = t.width; nt.dash = t.dash;
            nt.alpha = t.alpha; nt.visible = t.visible !== false;
          });
          st.selectedId = st.traces.length ? st.traces[0].id : null;
          syncControls();
          st.traces.forEach((t) => runAnalysis(t, true));
          renderAll();
          log(`DSC 프로젝트 로드: ${d.traces.length} 시료`, 'ok');
        } catch (e) { log('프로젝트 열기 실패 — ' + e.message, 'err'); }
      };
      rd.readAsText(f);
    };
    inp.click();
  }

  /* ------------------------------------------------------------- 컨트롤 */
  function syncControls() {
    $('dViewMode').value = st.view.stacked ? 'stacked' : 'overlay';
    $('dGap').value = st.view.gap;
    $('dNormH').checked = st.view.normHeight;
    $('dRev').checked = st.view.rev;
    $('dGrid').checked = st.view.grid;
    $('dPeaks').checked = st.view.peaksOn;
    $('dLabels').checked = st.view.labelsOn;
    if ($('dSummary')) $('dSummary').checked = !!st.view.summaryOn;
    $('dLo').value = st.view.lo; $('dHi').value = st.view.hi;
    $('dFont').value = st.view.fontSize;
    $('dLegendPos').value = st.view.legendPos;
    $('dExportBg').value = st.view.exportBg;
    if ($('dExportFmt')) $('dExportFmt').value = st.view.exportFmt || 'journal';
    if ($('dExportWidth')) $('dExportWidth').value = String(st.view.exportWidth || '180');
    if ($('dExportDpi')) $('dExportDpi').value = String(st.view.exportDpi || 300);
    if ($('dExportFont')) $('dExportFont').value = st.view.exportFont || '';
    $('dMass').value = st.cfg.mass;
    $('dBeta').value = st.cfg.beta;
    $('dUnit').value = st.cfg.unit;
    $('dSmooth').value = st.cfg.smooth;
    $('dPk1').value = st.cfg.pk1; $('dPk2').value = st.cfg.pk2;
    $('dTg1').value = st.cfg.tg1; $('dTg2').value = st.cfg.tg2;
    $('dRefSel').value = st.cfg.refKey;
    $('dRefVal').value = st.cfg.refVal;
    if ($('dAuto')) {
      $('dAuto').checked = !!st.cfg.auto;
      ['dPk1', 'dPk2', 'dTg1', 'dTg2'].forEach((id) => { $(id).disabled = !!st.cfg.auto; });
    }
  }

  function fillRefs() {
    const s = $('dRefSel');
    s.innerHTML = '<option value="custom">직접 입력</option>' +
      D.REFS.map((r) => `<option value="${esc(r.k)}">${esc(r.k)} · ${r.v} J/g</option>`).join('');
    s.onchange = () => {
      const r = D.REFS.find((z) => z.k === s.value);
      st.cfg.refKey = s.value;
      if (r) {
        st.cfg.refVal = r.v; $('dRefVal').value = r.v;
        log(r.v === 0 ? '결정화도 계산 안 함' : `ΔHm° = ${r.v} J/g (${r.k}) — ${r.note}`, r.v === 0 ? 'ok' : 'warn');
      }
      rerunAll(true); renderAll();
    };
    $('dRefVal').onchange = () => {
      st.cfg.refVal = Math.max(0, +$('dRefVal').value || 0);   // 0 = 결정화도 계산 안 함
      st.cfg.refKey = 'custom';
      rerunAll(true); renderAll();
    };
  }

  function rerunAll(quiet) {
    st.traces.forEach((t) => runAnalysis(t, quiet));
    renderTables(); updateTabInfo();
  }

  function bind() {
    // 상단 공용 버튼은 app.js 가 탭에 따라 라우팅한다(window.DSCUI).

    $('dDrop').onclick = openFiles;
    $('dShowAll').onclick = () => { st.traces.forEach((t) => t.visible = true); renderAll(); };
    $('dHideAll').onclick = () => { st.traces.forEach((t) => t.visible = false); renderAll(); };
    $('dClear').onclick = () => {
      if (!st.traces.length) return;
      st.traces = []; st.res = {}; st.selectedId = null; renderAll(); log('모든 DSC 시료 삭제');
    };

    // 스타일
    const onStyle = () => {
      const t = sel(); if (!t) return;
      t.name = $('dName').value || t.name;
      t.legend = $('dLegend').value;
      t.color = $('dColor').value;
      t.width = Math.max(0.5, +$('dWidth').value || 1.6);
      t.dash = $('dDash').value;
      t.alpha = Math.min(1, Math.max(0.1, +$('dAlpha').value || 1));
      renderAll();
    };
    ['dName', 'dLegend', 'dColor', 'dWidth', 'dDash', 'dAlpha'].forEach((id) => { $(id).oninput = onStyle; $(id).onchange = onStyle; });

    // 표시 설정
    const onView = () => {
      st.view.stacked = $('dViewMode').value === 'stacked';
      st.view.gap = Math.max(0, +$('dGap').value || 0);
      st.view.normHeight = $('dNormH').checked;
      st.view.rev = $('dRev').checked;
      st.view.grid = $('dGrid').checked;
      st.view.peaksOn = $('dPeaks').checked;
      st.view.labelsOn = $('dLabels').checked;
      if ($('dSummary')) st.view.summaryOn = $('dSummary').checked;
      st.view.fontSize = Math.max(8, +$('dFont').value || 13);
      st.view.legendPos = $('dLegendPos').value;
      st.view.exportBg = $('dExportBg').value;
      if ($('dExportFmt')) st.view.exportFmt = $('dExportFmt').value;
      if ($('dExportWidth')) st.view.exportWidth = parseInt($('dExportWidth').value, 10) || 180;
      if ($('dExportDpi')) st.view.exportDpi = parseInt($('dExportDpi').value, 10) || 300;
      if ($('dExportFont')) st.view.exportFont = $('dExportFont').value || '';
      const lo = +$('dLo').value, hi = +$('dHi').value;
      if (isFinite(lo) && isFinite(hi) && Math.abs(hi - lo) > 1) { st.view.lo = lo; st.view.hi = hi; }
      renderPlot();
    };
    ['dViewMode', 'dGap', 'dNormH', 'dRev', 'dGrid', 'dPeaks', 'dLabels', 'dSummary', 'dFont', 'dLegendPos',
      'dExportBg', 'dExportFmt', 'dExportWidth', 'dExportDpi', 'dExportFont', 'dLo', 'dHi'].forEach((id) => { if ($(id)) { $(id).onchange = onView; $(id).oninput = onView; } });

    // 분석 설정
    const onCfg = () => {
      st.cfg.mass = Math.max(0.01, +$('dMass').value || 5);
      st.cfg.beta = Math.max(0.1, +$('dBeta').value || 20);
      st.cfg.unit = $('dUnit').value;
      st.cfg.smooth = Math.max(1, +$('dSmooth').value || 1);
      if ($('dAuto')) {
        st.cfg.auto = $('dAuto').checked;
        ['dPk1', 'dPk2', 'dTg1', 'dTg2'].forEach((id) => { $(id).disabled = st.cfg.auto; });
      }
      st.cfg.pk1 = +$('dPk1').value; st.cfg.pk2 = +$('dPk2').value;
      st.cfg.tg1 = +$('dTg1').value; st.cfg.tg2 = +$('dTg2').value;
      rerunAll(false); renderAll();
    };
    ['dMass', 'dBeta', 'dUnit', 'dSmooth', 'dPk1', 'dPk2', 'dTg1', 'dTg2', 'dAuto'].forEach((id) => { $(id).onchange = onCfg; });

    $('dRun').onclick = $('dRunSel2').onclick = () => {
      const t = sel(); if (!t) { log('시료를 선택하세요', 'warn'); return; }
      runAnalysis(t, false); renderAll();
    };
    $('dRunAll').onclick = $('dRunAll2').onclick = () => {
      if (!st.traces.length) { log('분석할 DSC 곡선이 없습니다', 'warn'); return; }
      st.traces.forEach((t) => runAnalysis(t, true));
      renderAll();
      log(`전체 ${st.traces.length} 시료 분석 완료 (피크 ${st.cfg.pk1}–${st.cfg.pk2} °C, Tg ${st.cfg.tg1}–${st.cfg.tg2} °C)`, 'ok');
    };
    $('dReparse').onclick = () => {
      const t = sel(); if (!t || !t.meta.raw) { log('다시 읽을 원본이 없습니다', 'warn'); return; }
      st.cfg.tempCol = $('dTempCol').value === '' ? null : +$('dTempCol').value;
      st.cfg.hfCol = $('dHfCol').value === '' ? null : +$('dHfCol').value;
      const r = D.parseText(t.meta.raw, t.meta.file || t.name, { tempCol: st.cfg.tempCol, hfCol: st.cfg.hfCol });
      if (!r.ok) { log('열 다시 읽기 실패 — ' + r.reason, 'err'); return; }
      t.x = r.x; t.y = r.y; t.meta.unit = r.unit; st.cfg.unit = r.unit; $('dUnit').value = r.unit;
      runAnalysis(t, false); renderAll();
      log(`열 다시 읽기: 온도열 ${r.meta.tempCol} / 열유량열 ${r.meta.hfCol}`, 'ok');
    };
    $('dCSV').onclick = toCSV;
    $('dClearLog').onclick = () => { $('dLog').innerHTML = ''; };

    // 아래 패널 탭
    document.querySelectorAll('.dtag').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('.dtag').forEach((z) => z.classList.toggle('active', z === b));
        document.querySelectorAll('#dBottom .panel').forEach((p) => p.classList.toggle('active', p.id === 'dpanel-' + b.dataset.dtag));
      };
    });

    // 아래 패널 높이 조절
    {
      const rz = $('dResizer'), main = $('mainDsc');
      let drag2 = null;
      rz.addEventListener('mousedown', (e) => { drag2 = { y: e.clientY, h: parseInt(getComputedStyle(main).getPropertyValue('--bottomH')) || 300 }; e.preventDefault(); });
      window.addEventListener('mousemove', (e) => {
        if (!drag2) return;
        const h = Math.max(90, Math.min(window.innerHeight - 200, drag2.h - (e.clientY - drag2.y)));
        main.style.setProperty('--bottomH', h + 'px');
        renderPlot();
      });
      window.addEventListener('mouseup', () => { drag2 = null; });
      rz.addEventListener('dblclick', () => {
        const cur = parseInt(getComputedStyle(main).getPropertyValue('--bottomH')) || 300;
        main.style.setProperty('--bottomH', (cur > 120 ? 90 : 300) + 'px');
        renderPlot();
      });
    }

    window.addEventListener('resize', () => setTimeout(renderPlot, 120));

    // 드래그 앤 드롭
    {
      const dz = $('dDrop');
      let depth = 0;
      window.addEventListener('dragenter', (e) => { e.preventDefault(); if (window.APP_TAB !== 'dsc') return; depth++; dz.classList.add('over'); });
      window.addEventListener('dragover', (e) => { e.preventDefault(); });
      window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--depth <= 0) dz.classList.remove('over'); });
      window.addEventListener('drop', (e) => {
        e.preventDefault(); depth = 0; dz.classList.remove('over');
        if (window.APP_TAB !== 'dsc') return;
        loadFiles(e.dataTransfer.files);
      });
    }

    // 그래프 상호작용
    const cv = $('dPlot');
    let drag = null;
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;border:1px solid #4f9dff;background:rgba(79,157,255,.13);display:none;pointer-events:none;z-index:10';
    $('dPlotWrap').appendChild(box);
    const px2x = (px) => {
      const g = st.geom; if (!g) return null;
      const t = (px - g.m.l) / g.pw;
      const frac = st.view.rev ? (1 - t) : t;
      return g.xLo + frac * (g.xHi - g.xLo);
    };
    cv.addEventListener('mousedown', (e) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      for (const lr of st.legendRects) {
        if (x >= lr.x && x <= lr.x + lr.w && y >= lr.y && y <= lr.y + lr.h) { st.selectedId = lr.id; renderAll(); return; }
      }
      drag = { x0: x, y0: y, moved: false };
    });
    cv.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (Math.abs(x - drag.x0) > 4) drag.moved = true;
      if (drag.moved) {
        box.style.display = 'block';
        box.style.left = Math.min(drag.x0, x) + 'px'; box.style.top = Math.max(0, Math.min(drag.y0, y)) + 'px';
        box.style.width = Math.abs(x - drag.x0) + 'px'; box.style.height = Math.abs(y - drag.y0) + 'px';
      }
    });
    cv.addEventListener('mouseup', (e) => {
      const r = cv.getBoundingClientRect(), x = e.clientX - r.left;
      if (drag && drag.moved) {
        const a = px2x(drag.x0), b = px2x(x);
        if (a !== null && b !== null && Math.abs(b - a) > 1) {
          st.view.lo = Math.min(a, b); st.view.hi = Math.max(a, b);
          $('dLo').value = st.view.lo.toFixed(1); $('dHi').value = st.view.hi.toFixed(1);
          renderPlot();
        }
      }
      drag = null; box.style.display = 'none';
    });
    cv.addEventListener('mouseleave', () => { drag = null; box.style.display = 'none'; });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), xq = px2x(e.clientX - r.left);
      if (xq === null) return;
      const f = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      let lo = xq + (st.view.lo - xq) * f, hi = xq + (st.view.hi - xq) * f;
      if (hi - lo < 2) return;
      st.view.lo = lo; st.view.hi = hi;
      $('dLo').value = lo.toFixed(1); $('dHi').value = hi.toFixed(1);
      renderPlot();
    }, { passive: false });
    cv.addEventListener('dblclick', () => {
      const xs = st.traces.length ? st.traces.flatMap((t) => [t.x[0], t.x[t.x.length - 1]]) : [20, 320];
      st.view.lo = Math.min.apply(null, xs); st.view.hi = Math.max.apply(null, xs);
      $('dLo').value = st.view.lo.toFixed(0); $('dHi').value = st.view.hi.toFixed(0);
      renderPlot();
    });
  }

  /* --------------------------------------------------------------- 초기화 */
  function init() {
    if (!$('dPlot')) return;
    fillRefs();
    syncControls();
    bind();
    renderAll();
    log('DSC 분석 탭 — ASCII(.txt/.csv/.tsv) 온도·열유량 파일을 끌어다 놓으세요. Bruker DSC는 OPUS에서 ASCII로 내보내면 됩니다.');
  }

  window.DSCUI = { openFiles, demo, png, saveProject, loadProject, runAll: () => $('dRunAll').click() };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
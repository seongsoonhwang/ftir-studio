/* =========================================================================
 * app.js — UI 결선 (시료 · 표시 · 전처리 · 피크 · 정성 · 지수 · 라이브러리)
 * ========================================================================= */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const C = window.FTIRC;
  const P = window.FTIRPlot;
  const BANDS = window.FTIR_BANDS;

  const PALETTE = ['#4f9dff', '#ff7a59', '#3ddc97', '#c792ea', '#ffd166',
    '#67e8f9', '#f472b6', '#a3e635', '#fb923c', '#94a3b8', '#e879f9', '#34d399'];

  let uid = 0;
  const state = {
    traces: [],
    view: {
      stacked: true, normHeight: true, gap: 0.35, rev: true, grid: true,
      peaksOn: true, labelsOn: true, lo: 400, hi: 4000, fontSize: 13,
      legendOn: true, legendPos: 'out', legendScale: 1,
      exportBg: 'transparent',
      exportFmt: 'journal',        // journal | ppt | screen
      exportWidth: '180',          // 저널 폭(mm): 180=double, 88=single
      exportDpi: 300
    },
    pre: {
      smooth: { on: false, win: 9, order: 2 },
      baseline: { mode: 'none', deg: 3, p1: 4000, p2: 400 },
      atr: { on: false, n1: 2.40, n2: 1.52 },
      norm: 'none', normBand: [1440, 1480], normTarget: 1, normLocalBase: false
    },
    selectedId: null,
    peakOpts: { minProm: 0.015, minSep: 8 },
    legendRects: [],
    sel: null,
    lib: []
  };

  /* ------------------------------------------------------------- helpers */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d) => (v === null || v === undefined || !isFinite(v)) ? '—' : Number(v).toFixed(d === undefined ? 3 : d);
  const now = () => new Date().toLocaleTimeString('ko-KR', { hour12: false });

  function log(msg, cls) {
    const el = $('log');
    const line = document.createElement('div');
    if (cls) line.className = cls;
    line.innerHTML = `<span class="t">${now()}</span>  ${esc(msg)}`;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }

  function getTrace(id) { return state.traces.find((t) => t.id === id) || null; }
  function sel() { return getTrace(state.selectedId); }

  function download(filename, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  /* -------------------------------------------------------- trace 관리 */
  function newTrace(name, x, y, extra) {
    const t = Object.assign({
      id: 't' + (++uid), name: name, legend: '', color: PALETTE[state.traces.length % PALETTE.length],
      width: 1.6, dash: 'solid', alpha: 1, visible: true,
      x: x, y: y, peaks: [], frozen: false, fillDiff: false
    }, extra || {});
    t.p = t.frozen ? { x: t.x, y: t.y } : C.applyPipeline({ x: t.x, y: t.y }, state.pre);
    state.traces.push(t);
    return t;
  }

  function reprocess() {
    state._normInfo = null;
    for (const t of state.traces) {
      if (t.frozen) { t.p = { x: t.x, y: t.y }; continue; }
      t.p = C.applyPipeline({ x: t.x, y: t.y }, state.pre);
      if (!state._normInfo && t.p.normInfo) state._normInfo = t.p.normInfo;
    }
    for (const t of state.traces) {
      if (!t.frozen && t.peaks.length) {
        const pk = C.findPeaks(t.p.x, t.p.y, { minProm: state.peakOpts.minProm, minSep: state.peakOpts.minSep, maxPeaks: 120 });
        pk.forEach((p) => { p.label = p.x.toFixed(0); });
        t.peaks = pk;
      }
    }
    updatePreBadge();
    renderAll();
  }

  function logNormInfo() {
    const ni = state._normInfo;
    const band = ni ? `${ni.band[0].toFixed(0)}–${ni.band[1].toFixed(0)} cm⁻¹` : '';
    let msg, kind = 'ok';
    if (!ni || ni.mode !== 'bandpeak') {
      msg = '정규화: 기준 밴드 정보를 얻지 못했습니다'; kind = 'warn';
    } else if (!ni.ok) {
      msg = `정규화 생략: ${band} 안에 유효한 피크가 없습니다 (최대 ${ni.peakY == null ? 'n/a' : ni.peakY.toFixed(4)}, 전체 높이의 0.5 % 미만)`;
      kind = 'warn';
    } else {
      msg = `정규화: ${band} 최대 피크 ${ni.peakX.toFixed(1)} cm⁻¹ · 높이 ${ni.peakY.toFixed(4)} → 기준값 ${ni.target}`
        + `${ni.localBase ? ' (양끝 직선 기준 높이)' : ''} · 배율 ×${ni.scale.toFixed(2)} (첫 시료 기준, 시료마다 개별 계산)`;
      if (ni.scale > 100) { msg += ' — 배율이 큽니다. 기준 밴드 선택을 확인하세요'; kind = 'warn'; }
    }
    if (state._normLog === msg) return;
    state._normLog = msg;
    log(msg, kind);
  }

  function updatePreBadge() {
    const bits = [];
    if (state.pre.smooth.on) bits.push('SG');
    if (state.pre.baseline.mode !== 'none') bits.push({ linear: '선형BL', poly: '다항BL', rubber: '러버BL' }[state.pre.baseline.mode]);
    if (state.pre.atr.on) bits.push('ATR');
    if (state.pre.norm === 'bandpeak') {
      const b = state.pre.normBand || [1440, 1480];
      bits.push(`피크높이 ${Math.min(...b).toFixed(0)}–${Math.max(...b).toFixed(0)}`);
    } else if (state.pre.norm !== 'none') bits.push('정규화');
    $('preBadge').textContent = bits.length ? bits.join('·') : '기본';
  }

  /* ------------------------------------------------------------ 렌더링 */
  function renderAll() {
    renderTraceList();
    syncSelectors();
    renderPlot();
    renderPeakTable();
    renderIdxTable();
    renderLibTable(state._libMatch);
    updateTabInfo();
  }

  function renderTraceList() {
    const ul = $('traceList');
    ul.innerHTML = '';
    $('traceCount').textContent = state.traces.length;
    state.traces.forEach((t, i) => {
      const li = document.createElement('li');
      li.className = (t.id === state.selectedId ? 'sel' : '') + (t.visible ? '' : ' hidden-trace');
      li.onclick = () => { state.selectedId = t.id; renderAll(); };

      const sw = document.createElement('span');
      sw.className = 'sw'; sw.style.background = t.color;

      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = t.legend || t.name;
      const small = document.createElement('small');
      small.textContent = (t.p ? t.p.x.length : 0) + ' pt' + (t.peaks.length ? ' · 피크 ' + t.peaks.length : '');
      nm.appendChild(small);

      const mk = (txt, title, fn) => {
        const b = document.createElement('button');
        b.className = 'ico'; b.textContent = txt; b.title = title;
        b.onclick = (e) => { e.stopPropagation(); fn(); };
        return b;
      };
      const eye = mk(t.visible ? '◉' : '○', '표시 전환', () => { t.visible = !t.visible; renderAll(); });
      const up = mk('↑', '위로', () => moveTrace(t, -1));
      const dn = mk('↓', '아래로', () => moveTrace(t, 1));
      const del = mk('✕', '삭제', () => { state.traces = state.traces.filter((z) => z !== t); if (state.selectedId === t.id) state.selectedId = state.traces.length ? state.traces[state.traces.length - 1].id : null; renderAll(); log(`시료 삭제: ${t.name}`); });

      li.append(sw, nm, eye, up, dn, del);
      ul.appendChild(li);
    });
    if (state.selectedId) syncStyleEditor();
  }

  function moveTrace(t, dir) {
    const i = state.traces.indexOf(t), j = i + dir;
    if (j < 0 || j >= state.traces.length) return;
    state.traces.splice(j, 0, state.traces.splice(i, 1)[0]);
    renderAll();
  }

  function syncStyleEditor() {
    const t = sel(); if (!t) return;
    $('styName').value = t.name;
    $('styLegend').value = t.legend || '';
    $('styColor').value = t.color;
    $('styWidth').value = t.width;
    $('styDash').value = t.dash;
    $('styAlpha').value = t.alpha;
  }

  function renderPlot() {
    const canvas = $('plot');
    const res = P.render(canvas, state);
    state.legendRects = res.legendRects || [];
    state.geom = canvas._geom;
  }

  function syncSelectors() {
    const opts = state.traces.map((t) => `<option value="${t.id}">${esc(t.legend || t.name)}</option>`).join('');
    for (const id of ['cmpA', 'cmpB', 'idTrace', 'idxTrace', 'libTrace']) {
      const el = $(id);
      const prev = el.value;
      el.innerHTML = opts;
      if (state.traces.some((t) => t.id === prev)) el.value = prev;
      else if (state.selectedId) el.value = state.selectedId;
    }
    const visible = state.traces.filter((t) => t.visible);
    if ($('cmpA').options.length && $('cmpA').selectedIndex < 0 && visible.length) $('cmpA').selectedIndex = visible.length - 1;
    if ($('cmpB').options.length && $('cmpB').selectedIndex < 0) $('cmpB').selectedIndex = 0;
  }

  function updateTabInfo() {
    const active = document.querySelector('.tab.active').dataset.tab;
    let txt = '';
    if (active === 'peaks') {
      const t = sel();
      txt = t ? `${t.legend || t.name} · 피크 ${t.peaks.length}개` : '시료를 선택하세요';
    } else if (active === 'index') {
      txt = 'CI는 밴드 적분비 — ATR 보정 유무를 반드시 함께 보고하세요';
    } else if (active === 'ident') {
      txt = '점수는 정답이 아니라 후보 순위입니다';
    }
    $('tabInfo').textContent = txt;
  }

  /* --------------------------------------------------------- 데이터 추가 */
  function addParsed(parsed, quiet) {
    if (parsed.error) { log(`[읽기 실패] ${parsed.name}: ${parsed.error}`, 'err'); return null; }
    const sp = C.spectrumFromParsed(parsed);
    const t = newTrace(parsed.name, sp.x, sp.y, { unit: parsed.unit });
    state.selectedId = t.id;
    log(`불러옴: ${parsed.name} (${sp.x.length} pt, ${sp.x[0].toFixed(0)}–${sp.x[sp.x.length - 1].toFixed(0)} cm⁻¹, ${parsed.unit === 'trans' ? '%T→A 변환' : '흡광도'})`, 'ok');
    parsed.warnings.forEach((w) => log('  · ' + w, 'warn'));
    return t;
  }

  function logOpusInfo(p) {
    const i = p.info || {};
    log(`OPUS 바이너리: 블록 ${i.blocks}개 → '${i.spectrum}' 선택 · 내부 무결성 ${i.verify === 'ok' ? 'OK' : i.verify}`,
      i.verify === 'ok' ? 'ok' : 'warn');
    const meta = [
      i.instrument && `${i.instrument}${i.serial ? ' (#' + i.serial + ')' : ''}`,
      i.resolution && `${i.resolution} cm⁻¹`, i.scans && `${i.scans} scan`,
      i.accessory && String(i.accessory).split(' ')[0], i.detector
    ].filter(Boolean).join(' · ');
    if (meta) log('  · ' + meta);
    if (i.others && i.others.length) log('  · 함께 들어있던 블록: ' + i.others.join(', '));
  }

  function handleFiles(files) {
    const list = Array.from(files);
    if (!list.length) return;
    let pending = list.length;
    const done = () => { if (--pending === 0) { renderAll(); log(`${list.length}개 파일 처리 완료`, 'ok'); } };
    for (const f of list) {
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const buf = rd.result;
          const u8 = new Uint8Array(buf);
          const parsed = (window.FTIROpus && FTIROpus.isOpus(u8))
            ? FTIROpus.parse(buf, { name: f.name })
            : C.parseText(new TextDecoder('utf-8').decode(u8), f.name.replace(/\.[^.]+$/, ''));
          if (parsed.source === 'opus' && !parsed.error) logOpusInfo(parsed);
          addParsed(parsed);
        } catch (e) {
          log(`[예외] ${f.name}: ${e.message}`, 'err');
        }
        done();
      };
      rd.onerror = () => { log(`[읽기 오류] ${f.name}`, 'err'); done(); };
      rd.readAsArrayBuffer(f);
    }
  }

  /* ------------------------------------------------------------- 피크 */
  function detectPeaks(t, quiet) {
    const pk = C.findPeaks(t.p.x, t.p.y, { minProm: state.peakOpts.minProm, minSep: state.peakOpts.minSep, maxPeaks: 150 });
    pk.forEach((p) => { p.label = p.x.toFixed(0); });
    t.peaks = pk;
    if (!quiet) log(`${t.legend || t.name}: 피크 ${pk.length}개 검출 (minProm ${state.peakOpts.minProm}, 간격 ${state.peakOpts.minSep} cm⁻¹)`);
    return pk;
  }

  function renderPeakTable() {
    const body = $('peakTable').querySelector('tbody');
    body.innerHTML = '';
    const targets = state.traces.filter((t) => t.peaks && t.peaks.length);
    if (!targets.length) {
      body.innerHTML = '<tr><td colspan="6" style="color:#6b7f96">피크를 검출하면 여기에 표시됩니다.</td></tr>';
      return;
    }
    for (const t of targets) {
      const sorted = t.peaks.slice().sort((a, b) => b.x - a.x);
      sorted.forEach((pk) => {
        const idx = t.peaks.indexOf(pk);
        const hits = C.assignBand(pk.x);
        const tr = document.createElement('tr');
        if (t.id === state.selectedId) tr.className = 'sel';
        const assign = hits.length
          ? hits.map((h) => `${esc(h.label)} <span class="badge">${esc(h.ko.split(' ')[0])}</span>`).join('<br>')
          : '<span style="color:#5d6f85">—</span>';
        tr.innerHTML = `<td>${esc(t.legend || t.name)}</td>
          <td class="num">${pk.x.toFixed(1)}</td>
          <td class="num">${fmt(pk.y, 3)}</td>
          <td class="num">${fmt(pk.prom, 3)}</td>
          <td>${assign}</td>
          <td><input class="lbl" data-tid="${t.id}" data-idx="${idx}" value="${esc(pk.label || '')}"></td>`;
        body.appendChild(tr);
      });
    }
    body.querySelectorAll('input.lbl').forEach((inp) => {
      inp.oninput = () => {
        const t = getTrace(inp.dataset.tid);
        const pk = t && t.peaks[+inp.dataset.idx];
        if (pk) { pk.label = inp.value; renderPlot(); }
      };
    });
  }

  /* --------------------------------------------------------- 정성 판정 */
  function runIdentify(t) {
    if (!t) { log('정성 판정: 시료를 선택하세요', 'warn'); return; }
    for (const tr of state.traces) if (!tr.peaks.length) detectPeaks(tr, true);
    const res = C.scoreMaterials(t.p, t.peaks, BANDS);
    const body = $('idTable').querySelector('tbody');
    body.innerHTML = '';
    res.slice(0, 8).forEach((r) => {
      const miss = r.detail.filter((d) => !d.found && d.w >= 2).map((d) => d.t).slice(0, 4);
      const lvl = r.score >= 0.85 ? 'hi' : r.score >= 0.6 ? 'mid' : 'lo';
      const tr = document.createElement('tr');
      tr.innerHTML = `<td><b>${esc(r.ko)}</b><br><span style="color:#6d8299;font-size:11px">${esc(r.cls)}</span></td>
        <td class="num"><span class="badge ${lvl}">${(r.score * 100).toFixed(0)}%</span>
          <div style="font-size:10px;color:#6d8299">설명 ${(r.explain * 100).toFixed(0)}%</div></td>
        <td class="num">${r.got}/${r.tot}</td>
        <td>${miss.length ? esc(miss.join(', ')) : '<span style="color:#5d6f85">—</span>'}</td>
        <td style="max-width:320px; white-space:normal; font-size:11px; color:#8ea3ba">${esc(r.note || '')}</td>`;
      tr.onclick = () => showIdDetail(r);
      body.appendChild(tr);
    });
    showIdDetail(res[0]);
    log(`정성 판정(${t.legend || t.name}): 1위 ${res[0].ko} ${(res[0].score * 100).toFixed(0)}%, 2위 ${res[1].ko} ${(res[1].score * 100).toFixed(0)}%`);
    state._idRes = { trace: t, res };
    switchTab('ident');
  }

  function showIdDetail(r) {
    if (!r) return;
    const got = r.detail.filter((d) => d.found && d.w >= 2).map((d) => `${d.t}`);
    const miss = r.detail.filter((d) => !d.found && d.w >= 2).map((d) => `${d.t}`);
    $('idDetail').innerHTML = `<b>${esc(r.ko)}</b> · 점수 ${(r.score * 100).toFixed(0)}% (마커 충족 ${(r.scoreBand * 100).toFixed(0)}% · 스펙트럼 설명률 ${(r.explain * 100).toFixed(0)}%)<br>
      검출: ${esc(got.join(' · ') || '—')}<br>
      미검출: ${esc(miss.join(' · ') || '—')}
      ${r.meanDist < 90 ? `<br><span style="color:#7f93a9">평균 밴드 위치 편차 ${r.meanDist.toFixed(1)} cm⁻¹</span>` : ''}
      ${r.note ? `<br><span style="color:#7f93a9">${esc(r.note)}</span>` : ''}`;
  }

  /* --------------------------------------------------------- 열화 지수 */
  function fillIndexPresets() {
    $('idxPreset').innerHTML = BANDS.indices.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    $('idxNote').textContent = BANDS.indices[0].note;
    $('idxAtr').checked = !!BANDS.indices[0].atr;
  }
  function currentPreset() { return BANDS.indices.find((p) => p.id === $('idxPreset').value) || BANDS.indices[0]; }

  function calcRow(t, preset, atr, out) {
    const r = C.calcIndex({ x: t.x, y: t.y }, preset, { atr });
    out.push({ name: t.legend || t.name, preset: preset.name, ...r });
    return r;
  }

  function renderIdxTable() {
    const body = $('idxTable').querySelector('tbody');
    if (!state._idx || !state._idx.length) {
      body.innerHTML = '<tr><td colspan="7" style="color:#6b7f96">지수를 계산하면 여기에 표시됩니다.</td></tr>';
      return;
    }
    body.innerHTML = '';
    for (const row of state._idx) {
      const tr = document.createElement('tr');
      const delta = (row.valueRaw !== undefined && isFinite(row.valueRaw) && row.valueRaw)
        ? ((row.value / row.valueRaw - 1) * 100) : null;
      const flag = row.numZero ? ' <span class="badge lo">n.d.</span>' : '';
      tr.innerHTML = `<td>${esc(row.name)}</td>
        <td>${esc(row.preset)}</td>
        <td class="num"><b>${fmt(row.value, 4)}</b>${flag}</td>
        <td class="num">${fmt(row.valueRaw, 4)}${delta !== null ? ` <span style="color:#7f93a9">(${delta > 0 ? '+' : ''}${delta.toFixed(1)}%)</span>` : ''}</td>
        <td class="num">${fmt(row.num, 4)}</td>
        <td class="num">${fmt(row.den, 4)}</td>
        <td style="color:#8ea3ba; font-size:11px">${row.atr ? 'ATR 보정' : '미보정'}${row.numZero ? ' · 분자 면적 ≤ 0 (해당 밴드 미검출)' : ''}</td>`;
      body.appendChild(tr);
    }
  }

  /* ---------------------------------------------------------- 라이브러리 */
  function renderLibTable(match) {
    const body = $('libTable').querySelector('tbody');
    body.innerHTML = '';
    if (!state.lib.length) {
      body.innerHTML = '<tr><td colspan="6" style="color:#6b7f96">등록된 표준시료가 없습니다. 시료를 불러온 뒤 “선택 시료를 표준으로 등록”을 누르세요.</td></tr>';
    } else {
      const scores = new Map();
      if (match) match.results.forEach((r) => scores.set(r.id, r));
      for (const ref of state.lib) {
        const m = scores.get(ref.id);
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${esc(ref.name)}</td>
          <td>${esc(ref.created || '')}</td>
          <td class="num">${m ? `<b>${m.score}</b>` : '—'}</td>
          <td class="num">${m ? m.r.toFixed(3) : '—'}</td>
          <td class="num">${m ? m.r2.toFixed(3) : '—'}</td>
          <td><button class="ico" data-del="${ref.id}" title="삭제">✕</button></td>`;
        body.appendChild(tr);
      }
      body.querySelectorAll('button[data-del]').forEach((b) => {
        b.onclick = () => {
          state.lib = state.lib.filter((r) => r.id !== b.dataset.del);
          C.saveLibrary(state.lib);
          state._libMatch = null;
          renderLibTable(null);
          log('라이브러리 항목 삭제');
        };
      });
    }
    if (match) {
      const top = match.results.slice().sort((a, b) => b.score - a.score)[0];
      $('libInfo').innerHTML = top
        ? `<b>가장 유사:</b> ${esc(top.name)} · 점수 ${top.score}/1000 · R=${top.r.toFixed(3)} · R'=${top.r2.toFixed(3)}<br>
           <span style="color:#7f93a9">점수 = 1000×(0.6·R + 0.4·R′) 자체 정의. 1000에 가까울수록 형태 일치. 첨가제·충전제가 다르면 크게 떨어집니다.</span>`
        : '';
    }
  }

  /* ---------------------------------------------------------- 차이 스펙트럼 */
  function makeDiff() {
    const A = getTrace($('cmpA').value), B = getTrace($('cmpB').value);
    if (!A || !B || A === B) { log('차이 스펙트럼: 서로 다른 두 시료를 선택하세요', 'warn'); return; }
    const lo = Math.max(Math.min(...A.p.x), Math.min(...B.p.x), 400);
    const hi = Math.min(Math.max(...A.p.x), Math.max(...B.p.x), 4000);
    const grid = [];
    for (let v = lo; v <= hi; v += 2) grid.push(v);
    const ra = C.resample(A.p.x, A.p.y, 2, lo, hi);
    const rb = C.resample(B.p.x, B.p.y, 2, lo, hi);
    const ya = ra.y.slice(), yb = rb.y.slice();
    const mode = $('cmpNorm').value;
    const b1 = +$('cmpB1').value, b2 = +$('cmpB2').value;
    const normTo = (x, y) => {
      if (mode === 'none') return 1;
      if (mode === 'max') return Math.max(...y.map(Math.abs)) || 1;
      const lo2 = Math.min(b1, b2), hi2 = Math.max(b1, b2);
      if (mode === 'bandpeak') {
        let h = -Infinity;
        for (let i = 0; i < x.length; i++) if (x[i] >= lo2 && x[i] <= hi2 && y[i] > h) h = y[i];
        return (isFinite(h) && h > 1e-9) ? h : 1;
      }
      const a = C.bandArea(x, y, lo2, hi2, lo2, hi2);
      return Math.abs(a) || 1;
    };
    const ka = normTo(ra.x, ya), kb = normTo(rb.x, yb);
    const diff = ya.map((v, i) => v / ka - yb[i] / kb);
    const amax = Math.max(...diff.map(Math.abs));
    const name = `차이 ${A.legend || A.name} − ${B.legend || B.name} (Δmax ${amax.toFixed(3)})`;
    const t = newTrace(name, ra.x, diff, { frozen: true, fillDiff: true, color: '#ff7a59', width: 1.4 });
    t.peaks = C.findPeaks(t.p.x, t.p.y, { minProm: 0.05, minSep: 10, maxPeaks: 60 }).map((p) => ({ ...p, label: p.x.toFixed(0) }));
    state.selectedId = t.id;
    renderAll();
    log(`차이 스펙트럼 생성: ${name} (정규화=${mode})`, 'ok');
    switchTab('peaks');
  }

  /* ------------------------------------------------------------- 프로젝트 */
  function saveProject() {
    const data = {
      app: 'ftir-studio', version: 1, saved: new Date().toISOString(),
      view: state.view, pre: state.pre, peakOpts: state.peakOpts,
      traces: state.traces.map((t) => ({
        name: t.name, legend: t.legend, color: t.color, width: t.width, dash: t.dash,
        alpha: t.alpha, visible: t.visible, frozen: !!t.frozen, fillDiff: !!t.fillDiff,
        x: t.x.map((v) => +v.toFixed(2)), y: t.y.map((v) => +v.toFixed(6)),
        peaks: t.peaks.map((p) => ({ x: p.x, y: p.y, prom: p.prom, label: p.label }))
      }))
    };
    download('ftir-project-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data), 'application/json');
    log(`프로젝트 저장 (${data.traces.length}개 시료)`, 'ok');
  }

  function loadProject(file) {
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(String(rd.result));
        if (!d.traces) throw new Error('traces 없음');
        state.traces = [];
        Object.assign(state.view, d.view || {});
        Object.assign(state.pre, d.pre || {});
        if (d.peakOpts) Object.assign(state.peakOpts, d.peakOpts);
        for (const tr of d.traces) {
          const t = newTrace(tr.name, tr.x, tr.y, {
            legend: tr.legend, color: tr.color, width: tr.width, dash: tr.dash,
            alpha: tr.alpha, visible: tr.visible, frozen: tr.frozen, fillDiff: tr.fillDiff
          });
          t.peaks = (tr.peaks || []).map((p) => ({ ...p }));
        }
        state.selectedId = state.traces.length ? state.traces[0].id : null;
        syncControlsFromState();
        reprocess();
        log(`프로젝트 열기: ${state.traces.length}개 시료`, 'ok');
      } catch (e) {
        log('프로젝트 열기 실패: ' + e.message, 'err');
      }
    };
    rd.readAsText(file);
  }

  function syncControlsFromState() {
    $('viewMode').value = state.view.stacked ? 'stacked' : 'overlay';
    $('viewGap').value = state.view.gap;
    $('viewNormHeight').checked = state.view.normHeight;
    $('viewRev').checked = state.view.rev;
    $('viewGrid').checked = state.view.grid;
    $('viewPeaks').checked = state.view.peaksOn;
    $('viewLabels').checked = state.view.labelsOn;
    $('viewLo').value = state.view.lo;
    $('viewHi').value = state.view.hi;
    $('viewFont').value = state.view.fontSize;
    $('viewLegendOn').checked = state.view.legendOn;
    $('viewLegendPos').value = state.view.legendPos;
    $('viewLegendScale').value = state.view.legendScale;
    $('viewLabelMin').value = state.view.labelMinProm === undefined ? 0.03 : state.view.labelMinProm;
    if ($('viewExportBg')) $('viewExportBg').value = state.view.exportBg || 'transparent';
    if ($('viewExportFmt')) $('viewExportFmt').value = state.view.exportFmt || 'journal';
    if ($('viewExportWidth')) $('viewExportWidth').value = String(state.view.exportWidth || '180');
    if ($('viewExportDpi')) $('viewExportDpi').value = String(state.view.exportDpi || 300);
    $('smoothOn').checked = state.pre.smooth.on;
    $('smoothWin').value = state.pre.smooth.win;
    $('smoothOrder').value = state.pre.smooth.order;
    $('baseMode').value = state.pre.baseline.mode;
    $('baseDeg').value = state.pre.baseline.deg;
    $('baseP1').value = state.pre.baseline.p1;
    $('baseP2').value = state.pre.baseline.p2;
    $('atrOn').checked = state.pre.atr.on;
    $('atrN1').value = state.pre.atr.n1;
    $('atrN2').value = state.pre.atr.n2;
    $('normMode').value = state.pre.norm;
    $('normB1').value = state.pre.normBand[0];
    $('normB2').value = state.pre.normBand[1];
    $('normTarget').value = state.pre.normTarget == null ? 1 : state.pre.normTarget;
    $('normLocalBase').checked = !!state.pre.normLocalBase;
    $('peakMinProm').value = state.peakOpts.minProm;
    $('peakMinSep').value = state.peakOpts.minSep;
  }

  /* --------------------------------------------------------------- 탭 */
  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
    updateTabInfo();
  }

  /* -------------------------------------------------------------- 이벤트 */
  /* 상위 탭 (FT-IR / DSC) */
  function switchTopTab(name) {
    window.APP_TAB = name;
    const app = $('app');
    if (app) app.dataset.tab = name;
    document.querySelectorAll('.ttab').forEach((b) => b.classList.toggle('active', b.dataset.ttab === name));
    setTimeout(() => window.dispatchEvent(new Event('resize')), 30);
  }

  function bind() {
    document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => switchTab(b.dataset.tab); });
    document.querySelectorAll('.ttab').forEach((b) => { b.onclick = () => switchTopTab(b.dataset.ttab); });

    $('btnOpen').onclick = () => {
      if (window.APP_TAB === 'dsc' && window.DSCUI) return window.DSCUI.openFiles();
      if (window.APP_TAB === 'tga' && window.TGAUI) return window.TGAUI.openFiles();
      $('fileInput').click();
    };
    $('fileInput').onchange = (e) => { handleFiles(e.target.files); e.target.value = ''; };

    // 드래그&드롭 — 창 전체
    let dragDepth = 0;
    const dz = $('dropzone');
    dz.onclick = () => $('fileInput').click();
    window.addEventListener('dragenter', (e) => { e.preventDefault(); if (window.APP_TAB === 'dsc' || window.APP_TAB === 'tga') return; dragDepth++; dz.classList.add('over'); });
    window.addEventListener('dragover', (e) => { e.preventDefault(); });
    window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) dz.classList.remove('over'); });
    window.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; dz.classList.remove('over');
      if (window.APP_TAB === 'dsc' || window.APP_TAB === 'tga') return;   // DSC/TGA 탭은 자체 드롭핸들러
      handleFiles(e.dataTransfer.files);
    });

    $('btnDemo').onclick = () => {
      if (window.APP_TAB === 'dsc' && window.DSCUI) return window.DSCUI.demo();
      if (window.APP_TAB === 'tga' && window.TGAUI) return window.TGAUI.demo();
      const d = window.FTIR_DEMO();
      state.traces = [];
      d.forEach((s) => newTrace(s.name, s.x, s.y));
      state.selectedId = state.traces.length ? state.traces[0].id : null;
      log(`데모 데이터 로드: ${d.length}개 (합성 스펙트럼 — 실측값 아님)`, 'warn');
      renderAll();
    };

    $('btnSave').onclick = () => {
      if (window.APP_TAB === 'dsc' && window.DSCUI) return window.DSCUI.saveProject();
      if (window.APP_TAB === 'tga' && window.TGAUI) return window.TGAUI.saveProject();
      saveProject();
    };
    $('btnLoad').onclick = () => {
      if (window.APP_TAB === 'dsc' && window.DSCUI) return window.DSCUI.loadProject();
      if (window.APP_TAB === 'tga' && window.TGAUI) return window.TGAUI.loadProject();
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.json';
      inp.onchange = () => inp.files[0] && loadProject(inp.files[0]);
      inp.click();
    };
    $('btnPNG').onclick = () => {
      if (window.APP_TAB === 'dsc' && window.DSCUI) return window.DSCUI.png();
      if (window.APP_TAB === 'tga' && window.TGAUI) return window.TGAUI.png();
      if (!state.traces.length) { log('내보낼 스펙트럼이 없습니다', 'warn'); return; }
      const fmt = state.view.exportFmt || 'journal';
      const o = {
        wmm: parseInt(state.view.exportWidth, 10) || 180,
        dpi: parseInt(state.view.exportDpi, 10) || 300,
        labelMinProm: state.view.labelMinProm
      };
      let opts, st = state, tag;
      if (fmt === 'screen') {
        const bg = state.view.exportBg || 'transparent';
        opts = { scale: 2, bg: bg };
        tag = '화면 그대로 (2배) · 배경 ' + (bg === 'transparent' ? '투명' : bg === 'white' ? '흰색' : '앱 테마');
      } else {
        const pre = P.formatPreset(fmt, o);
        st = P.stateForFormat(state, fmt, o);
        opts = { scale: 1, bg: pre.bg, width: pre.width, height: pre.height, font: pre.font, margin: pre.margin, nameMax: pre.nameMax };
        tag = pre.label + (fmt === 'journal' ? ' · ' + pre.width + '×' + pre.height + ' px' : '');
      }
      const url = P.toPNG($('plot'), st, opts);
      download('ftir-plot-' + Date.now() + '.png', url.split(',')[1] ? dataURLtoBlob(url) : url, 'image/png');
      log('PNG 내보내기 — ' + tag, 'ok');
    };
    $('btnHelp').onclick = () => { const d = $('helpDlg'); d.showModal(); d.scrollTop = 0; };
    $('btnHelpClose').onclick = () => $('helpDlg').close();

    $('btnShowAll').onclick = () => { state.traces.forEach((t) => t.visible = true); renderAll(); };
    $('btnHideAll').onclick = () => { state.traces.forEach((t) => t.visible = false); renderAll(); };
    $('btnClear').onclick = () => {
      if (!state.traces.length) return;
      state.traces = []; state.selectedId = null; state._idx = null; state._libMatch = null;
      renderAll(); log('모든 시료 삭제');
    };

    // 스타일 편집
    const onStyle = () => {
      const t = sel(); if (!t) return;
      t.name = $('styName').value || t.name;
      t.legend = $('styLegend').value;
      t.color = $('styColor').value;
      t.width = Math.max(0.5, +$('styWidth').value || 1.6);
      t.dash = $('styDash').value;
      t.alpha = Math.min(1, Math.max(0.1, +$('styAlpha').value || 1));
      renderTraceList(); syncSelectors(); renderPlot();
    };
    ['styName', 'styLegend', 'styColor', 'styWidth', 'styDash', 'styAlpha'].forEach((id) => {
      $(id).oninput = onStyle; $(id).onchange = onStyle;
    });

    // 표시 설정
    const onView = () => {
      state.view.stacked = $('viewMode').value === 'stacked';
      state.view.normHeight = $('viewNormHeight').checked;
      state.view.gap = Math.max(0, +$('viewGap').value || 0);
      state.view.rev = $('viewRev').checked;
      state.view.grid = $('viewGrid').checked;
      state.view.peaksOn = $('viewPeaks').checked;
      state.view.labelsOn = $('viewLabels').checked;
      state.view.fontSize = Math.max(8, +$('viewFont').value || 13);
      state.view.legendOn = $('viewLegendOn').checked;
      state.view.legendPos = $('viewLegendPos').value;
      state.view.legendScale = Math.max(0.6, +$('viewLegendScale').value || 1);
      state.view.labelMinProm = Math.max(0, +$('viewLabelMin').value || 0);
      if ($('viewExportBg')) state.view.exportBg = $('viewExportBg').value;
      if ($('viewExportFmt')) state.view.exportFmt = $('viewExportFmt').value;
      if ($('viewExportWidth')) state.view.exportWidth = parseInt($('viewExportWidth').value, 10) || 180;
      if ($('viewExportDpi')) state.view.exportDpi = parseInt($('viewExportDpi').value, 10) || 300;
      let lo = +$('viewLo').value, hi = +$('viewHi').value;
      if (isFinite(lo) && isFinite(hi) && Math.abs(hi - lo) > 20) { state.view.lo = lo; state.view.hi = hi; }
      renderPlot();
    };
    ['viewMode', 'viewGap', 'viewNormHeight', 'viewRev', 'viewGrid', 'viewPeaks', 'viewLabels',
      'viewFont', 'viewLegendPos', 'viewLegendOn', 'viewLegendScale', 'viewLo', 'viewHi', 'viewLabelMin',
      'viewExportBg', 'viewExportFmt', 'viewExportWidth', 'viewExportDpi'].forEach((id) => {
      $(id).onchange = onView; $(id).oninput = onView;
    });
    const setRange = (lo, hi) => {
      state.view.lo = lo; state.view.hi = hi;
      $('viewLo').value = lo; $('viewHi').value = hi;
      renderPlot();
    };
    $('btnRangeFull').onclick = () => setRange(400, 4000);
    $('btnRangeFingerprint').onclick = () => setRange(700, 1800);
    $('btnRangeCH').onclick = () => setRange(2700, 3100);
    $('btnResetView').onclick = () => {
      state.view.lo = 400; state.view.hi = 4000;
      $('viewLo').value = 400; $('viewHi').value = 4000;
      renderPlot();
    };

    // 전처리
    const onPre = () => {
      state.pre.smooth.on = $('smoothOn').checked;
      state.pre.smooth.win = Math.max(3, +$('smoothWin').value || 9);
      state.pre.smooth.order = Math.min(5, Math.max(1, +$('smoothOrder').value || 2));
      state.pre.baseline.mode = $('baseMode').value;
      state.pre.baseline.deg = Math.max(1, +$('baseDeg').value || 3);
      state.pre.baseline.p1 = +$('baseP1').value || 4000;
      state.pre.baseline.p2 = +$('baseP2').value || 400;
      state.pre.atr.on = $('atrOn').checked;
      state.pre.atr.n1 = +$('atrN1').value || 2.40;
      state.pre.atr.n2 = +$('atrN2').value || 1.52;
      state.pre.norm = $('normMode').value;
      state.pre.normBand = [+$('normB1').value || 1440, +$('normB2').value || 1480];
      state.pre.normTarget = Math.max(0.001, +$('normTarget').value || 1);
      state.pre.normLocalBase = $('normLocalBase').checked;
      reprocess();
      if (state.pre.norm === 'bandpeak') logNormInfo();
    };
    ['smoothOn', 'smoothWin', 'smoothOrder', 'baseMode', 'baseDeg', 'baseP1', 'baseP2',
      'atrOn', 'atrN1', 'atrN2', 'normMode', 'normB1', 'normB2', 'normTarget', 'normLocalBase'].forEach((id) => {
      $(id).onchange = onPre; $(id).oninput = onPre;
    });

    // 비교
    $('btnDiff').onclick = makeDiff;
    $('btnDiffClear').onclick = () => {
      const diffs = state.traces.filter((t) => t.frozen && t.fillDiff);
      if (!diffs.length) { log('제거할 차이 스펙트럼이 없습니다', 'warn'); return; }
      state.traces = state.traces.filter((t) => !diffs.includes(t));
      if (!state.traces.some((t) => t.id === state.selectedId)) state.selectedId = state.traces.length ? state.traces[0].id : null;
      renderAll(); log('차이 스펙트럼 제거');
    };

    // 피크
    $('peakMinProm').oninput = () => { state.peakOpts.minProm = Math.max(0.001, +$('peakMinProm').value || 0.015); };
    $('peakMinSep').oninput = () => { state.peakOpts.minSep = Math.max(1, +$('peakMinSep').value || 8); };
    $('btnPick').onclick = () => {
      const scope = $('peakScope').value;
      const targets = scope === 'all' ? state.traces : [sel()].filter(Boolean);
      if (!targets.length) { log('피크 검출: 시료를 선택하세요', 'warn'); return; }
      targets.forEach((t) => detectPeaks(t, true));
      renderAll();
      log(`피크 검출 완료 (${targets.length}개 시료, minProm ${state.peakOpts.minProm})`, 'ok');
    };
    $('btnPeakCSV').onclick = () => {
      const rows = [['시료', 'wavenumber_cm-1', 'intensity', 'prominence', 'assignment', 'label']];
      for (const t of state.traces) {
        for (const pk of t.peaks.slice().sort((a, b) => b.x - a.x)) {
          const hits = C.assignBand(pk.x);
          rows.push([t.legend || t.name, pk.x.toFixed(1), pk.y.toFixed(5), pk.prom.toFixed(5),
            hits.map((h) => h.label + '(' + h.ko + ')').join(' / '), pk.label || '']);
        }
      }
      download('ftir-peaks.csv', '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv;charset=utf-8');
      log('피크 표 CSV 저장', 'ok');
    };

    // 정성
    $('btnId').onclick = () => runIdentify(getTrace($('idTrace').value));
    $('btnIdCSV').onclick = () => {
      if (!state._idRes) { log('먼저 정성 판정을 실행하세요', 'warn'); return; }
      const rows = [['rank', 'candidate', 'class', 'score_pct', 'got', 'total', 'missing_w>=2', 'note']];
      state._idRes.res.map((r, i) => rows.push([i + 1, r.ko, r.cls, (r.score * 100).toFixed(0), r.got, r.tot,
        r.detail.filter((d) => !d.found && d.w >= 2).map((d) => d.t).join(' / '), r.note || '']));
      download('ftir-identification.csv', '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv;charset=utf-8');
      log('정성 판정 CSV 저장', 'ok');
    };

    // 지수
    $('idxPreset').onchange = () => {
      const p = currentPreset();
      $('idxAtr').checked = !!p.atr;
      $('idxNote').textContent = p.note || '';
    };
    $('btnIndex').onclick = () => {
      const t = getTrace($('idxTrace').value);
      if (!t) { log('지수 계산: 시료를 선택하세요', 'warn'); return; }
      const p = currentPreset();
      const out = [];
      calcRow(t, p, $('idxAtr').checked, out);
      state._idx = out;
      renderIdxTable();
      log(`${p.name} = ${fmt(out[0].value, 4)} (${t.legend || t.name}, ATR ${$('idxAtr').checked ? 'on' : 'off'})`, 'ok');
      switchTab('index');
    };
    $('btnIndexAll').onclick = () => {
      const p = currentPreset();
      const atr = $('idxAtr').checked;
      const out = [];
      for (const t of state.traces) if (!t.frozen) calcRow(t, p, atr, out);
      state._idx = out;
      renderIdxTable();
      log(`전체 시료 ${p.name} 계산 (${out.length}개)`, 'ok');
      switchTab('index');
    };
    $('btnIndexCSV').onclick = () => {
      if (!state._idx || !state._idx.length) { log('먼저 지수를 계산하세요', 'warn'); return; }
      const rows = [['sample', 'preset', 'value', 'value_no_atr', 'numerator_area', 'denominator_area', 'atr']];
      state._idx.forEach((r) => rows.push([r.name, r.preset, r.value, r.valueRaw, r.num, r.den, r.atr ? 'on' : 'off']));
      download('ftir-index.csv', '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv;charset=utf-8');
      log('지수 CSV 저장', 'ok');
    };

    // 라이브러리
    $('btnAddRef').onclick = () => {
      const t = sel();
      if (!t) { log('표준 등록: 시료를 선택하세요', 'warn'); return; }
      const nm = prompt('표준시료 이름 (예: PA6-GF30 기준품)', t.legend || t.name);
      if (!nm) return;
      if (!state.lib) state.lib = [];
      state.lib.push({
        id: 'lib' + Date.now(), name: nm, created: new Date().toISOString().slice(0, 10),
        x: t.x.map((v) => +v.toFixed(2)), y: t.y.map((v) => +v.toFixed(6))
      });
      const ok = C.saveLibrary(state.lib);
      renderLibTable(state._libMatch);
      log(`표준 등록: ${nm}${ok ? '' : ' (저장 실패 — JSON 내보내기로 보관하세요)'}`, ok ? 'ok' : 'warn');
    };
    $('btnLibMatch').onclick = () => {
      const t = getTrace($('libTrace').value);
      if (!t) { log('라이브러리 대조: 시료를 선택하세요', 'warn'); return; }
      if (!state.lib.length) { log('등록된 표준시료가 없습니다', 'warn'); return; }
      const results = state.lib.map((ref) => {
        const rp = C.applyPipeline({ x: ref.x, y: ref.y }, state.pre);
        const m = C.compareToRef(t.p, rp);
        return { id: ref.id, name: ref.name, ...m };
      }).sort((a, b) => b.score - a.score);
      state._libMatch = { results };
      renderLibTable(state._libMatch);
      log(`라이브러리 대조 완료: 최고 ${results[0].name} (${results[0].score}/1000)`, 'ok');
      switchTab('lib');
    };
    $('btnLibExport').onclick = () => {
      download('ftir-library.json', JSON.stringify(state.lib), 'application/json');
      log(`라이브러리 JSON 내보내기 (${state.lib.length}개)`, 'ok');
    };
    $('btnLibImport').onclick = () => $('libFile').click();
    $('libFile').onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const arr = JSON.parse(String(rd.result));
          if (!Array.isArray(arr)) throw new Error('배열이 아님');
          state.lib = state.lib.concat(arr.filter((r) => r && r.x && r.y));
          C.saveLibrary(state.lib);
          renderLibTable(state._libMatch);
          log(`라이브러리 가져오기: 총 ${state.lib.length}개`, 'ok');
        } catch (err) { log('라이브러리 가져오기 실패: ' + err.message, 'err'); }
      };
      rd.readAsText(f);
      e.target.value = '';
    };

    $('btnClearLog').onclick = () => { $('log').innerHTML = ''; };

    // ---- 캔버스 상호작용
    bindCanvas();

    // ---- 아래 패널 높이 조절
    (function () {
      const main = document.querySelector('main');
      const rz = $('vresizer'), bottom = $('bottom');
      let drag = null, raf = null;
      const paint = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = null; renderPlot(); }); };
      rz.addEventListener('mousedown', (e) => {
        drag = { y: e.clientY, h: bottom.getBoundingClientRect().height };
        document.body.style.cursor = 'row-resize';
        e.preventDefault();
      });
      window.addEventListener('mousemove', (e) => {
        if (!drag) return;
        const nh = Math.max(34, Math.min(window.innerHeight - 240, drag.h - (e.clientY - drag.y)));
        main.style.setProperty('--bottomH', nh + 'px');
        paint();
      });
      window.addEventListener('mouseup', () => {
        if (!drag) return;
        drag = null; document.body.style.cursor = '';
        paint();
      });
      rz.addEventListener('dblclick', () => {
        const cur = bottom.getBoundingClientRect().height;
        main.style.setProperty('--bottomH', (cur > 80 ? 36 : 300) + 'px');
        paint();
      });
    })();

    window.addEventListener('resize', debounce(() => renderPlot(), 120));
  }

  function dataURLtoBlob(url) {
    const [head, b64] = url.split(',');
    const mime = /:(.*?);/.exec(head)[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function debounce(fn, ms) {
    let t = null;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function bindCanvas() {
    const canvas = $('plot');
    const tip = $('tooltip');
    let drag = null;

    const selBox = document.createElement('div');
    selBox.style.cssText = 'position:absolute;border:1px solid #4f9dff;background:rgba(79,157,255,.13);display:none;pointer-events:none;z-index:10';
    $('plotWrap').appendChild(selBox);

    const px2wn = (px) => {
      const g = state.geom; if (!g) return null;
      const t = (px - g.m.l) / g.pw;
      const frac = state.view.rev !== false ? (1 - t) : t;
      return g.xLo + frac * (g.xHi - g.xLo);
    };

    canvas.addEventListener('mousedown', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      // 범례 클릭?
      for (const lr of state.legendRects) {
        if (x >= lr.x && x <= lr.x + lr.w && y >= lr.y && y <= lr.y + lr.h) {
          state.selectedId = lr.id; renderAll(); return;
        }
      }
      drag = { x0: x, y0: y, moved: false };
    });

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (drag) {
        if (Math.abs(x - drag.x0) > 4) drag.moved = true;
        if (drag.moved) {
          const l = Math.min(drag.x0, x), w = Math.abs(x - drag.x0);
          selBox.style.display = 'block';
          selBox.style.left = l + 'px'; selBox.style.top = Math.max(0, Math.min(drag.y0, y)) + 'px';
          selBox.style.width = w + 'px'; selBox.style.height = Math.abs(y - drag.y0) + 'px';
          return;
        }
      }
      updateTooltip(x, y);
    });

    canvas.addEventListener('mouseup', (e) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (drag && drag.moved) {
        const a = px2wn(drag.x0), b = px2wn(x);
        if (a !== null && b !== null) {
          state.view.lo = Math.round(Math.min(a, b));
          state.view.hi = Math.round(Math.max(a, b));
          if (state.view.hi - state.view.lo < 20) { state.view.lo = 400; state.view.hi = 4000; }
          $('viewLo').value = state.view.lo; $('viewHi').value = state.view.hi;
          renderPlot();
        }
      }
      drag = null; selBox.style.display = 'none';
    });

    canvas.addEventListener('mouseleave', () => { tip.classList.add('hidden'); drag = null; selBox.style.display = 'none'; });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const wn = px2wn(x); if (wn === null) return;
      const f = e.deltaY > 0 ? 1.18 : 1 / 1.18;
      let lo = wn + (state.view.lo - wn) * f;
      let hi = wn + (state.view.hi - wn) * f;
      lo = Math.max(300, lo); hi = Math.min(4100, hi);
      if (hi - lo < 15) return;
      state.view.lo = lo; state.view.hi = hi;
      $('viewLo').value = Math.round(lo); $('viewHi').value = Math.round(hi);
      renderPlot();
    }, { passive: false });

    canvas.addEventListener('dblclick', () => {
      state.view.lo = 400; state.view.hi = 4000;
      $('viewLo').value = 400; $('viewHi').value = 4000;
      renderPlot();
    });

    function updateTooltip(x, y) {
      const wn = px2wn(x);
      if (wn === null || !state.traces.length) { tip.classList.add('hidden'); return; }
      const vis = state.traces.filter((t) => t.visible && t.p);
      let html = `<div><b>${wn.toFixed(1)} cm⁻¹</b></div>`;
      for (const t of vis.slice(0, 8)) {
        const v = C.interpAt(t.p.x, t.p.y, wn);
        html += `<div class="trow"><span class="d" style="background:${t.color}"></span>
          <span>${esc((t.legend || t.name).slice(0, 22))}</span>
          <span style="margin-left:auto;color:#9fb3c9">${isFinite(v) ? v.toFixed(3) : '—'}</span></div>`;
      }
      const hits = C.assignBand(wn);
      if (hits.length) {
        html += `<div style="margin-top:4px;color:#8fb0d0;font-size:10.5px">${hits.slice(0, 2).map((h) => `${esc(h.label)} <span style="color:#6d8299">(${esc(h.ko.split(' ')[0])})</span>`).join('<br>')}</div>`;
      }
      tip.innerHTML = html;
      tip.classList.remove('hidden');
      const wrapW = $('plotWrap').clientWidth;
      const left = Math.min(wrapW - 220, Math.max(6, x + 16));
      tip.style.left = left + 'px';
      tip.style.top = Math.max(6, y - 10) + 'px';
    }
  }

  /* ---------------------------------------------------------------- 초기화 */
  function init() {
    fillIndexPresets();
    syncControlsFromState();
    state.lib = C.loadLibrary();
    bind();
    renderAll();
    window.APP_TAB = 'ftir';
    log('FT-IR Studio v1.4 — 준비 완료. OPUS 원시 파일(.0/.1) 또는 ASCII(.dpt)를 끌어다 놓으세요. 상단 탭에서 DSC·TGA 분석으로 전환할 수 있습니다.');
    log('OPUS 원시 바이너리(.0/.1)는 그대로 읽고, 내부 MNY/MXY 대조로 값 무결성을 확인합니다.');
  }

  // 테스트/자동화용 훅
  window.FTIR = {
    state, renderAll, addParsed, handleFiles, detectPeaks, runIdentify, makeDiff,
    switchTab, reprocess, log, C, P, BANDS, saveProject, loadProject
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

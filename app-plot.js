/* =========================================================================
 * app-plot.js — 캔버스 스펙트럼 렌더러 (의존성 없음)
 * 스택/오버레이, 개별 선 스타일, 피크 라벨, 편집 가능한 범례, 고DPI 내보내기
 * ========================================================================= */
(function () {
  'use strict';
  const FONT_DEFAULT = '"Malgun Gothic","Segoe UI",system-ui,sans-serif';
  let FONT = FONT_DEFAULT;   // 장비 포맷(저널: serif)에서 o.font 로 교체

  function niceStep(span, target) {
    const raw = span / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const c = raw / p;
    const m = c <= 1 ? 1 : c <= 2 ? 2 : c <= 2.5 ? 2.5 : c <= 5 ? 5 : 10;
    return m * p;
  }

  function dashArr(d) {
    if (d === 'dash') return [7, 5];
    if (d === 'dot') return [2, 4];
    if (d === 'dashdot') return [9, 4, 2, 4];
    return [];
  }

  function scaleFor(canvas, scale) {
    const dpr = (window.devicePixelRatio || 1) * (scale || 1);
    return dpr;
  }

  function render(canvas, state, opts) {
    const o = opts || {};
    FONT = o.font || FONT_DEFAULT;
    const scale = o.scale || 1;
    const cssW = o.width || canvas.clientWidth || canvas.width;
    const cssH = o.height || canvas.clientHeight || canvas.height;
    const dpr = (window.devicePixelRatio || 1) * scale;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (o.width) canvas.style.width = cssW + 'px';
    if (o.height) canvas.style.height = cssH + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // 테마 = 앱 테마 + 내보내기용 오버라이드(o.theme). bg:null 이면 배경을 칠하지 않는다(투명 PNG).
    const theme = Object.assign({}, state.theme || {}, o.theme || {});
    const bg = (theme.bg === null) ? null : (theme.bg || '#0f1319');
    const fg = theme.fg || '#c9d3e0';
    const gridC = theme.grid || 'rgba(140,160,190,0.14)';
    const axisC = theme.axis || '#8fa1b8';
    const mutedC = theme.muted || '#5b6b80';
    const nameBgC = theme.nameBg || 'rgba(15,19,25,0.78)';
    const legendBgC = theme.legendBg || 'rgba(12,18,26,0.72)';
    const legendStrokeC = theme.legendStroke || 'rgba(140,170,210,0.25)';
    const crossC = theme.cross || 'rgba(160,190,230,0.45)';

    if (bg) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cssW, cssH);
    }

    const vis = state.traces.filter((t) => t.visible && t.p && t.p.y.length);
    if (!vis.length) {
      ctx.fillStyle = mutedC;
      ctx.font = `14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('스펙트럼이 없습니다 — 파일을 끌어다 놓거나 “데모 데이터”를 누르세요', cssW / 2, cssH / 2);
      return { geom: null, legendRects: [] };
    }

    const fs = state.view.fontSize || 13;
    const fs0 = fs;
    const fsBig = state.view.legendScale || 1;

    // ---- 범례 배치 계산(바깥 오른쪽/위/아래/왼쪽 · 안쪽 네 모서리)
    const legendOn = state.view.legendOn !== false;
    const sumOn = !!(state.summary && state.summary.panels && state.summary.panels.length);
    let lpos = state.view.legendPos || 'out';
    // 요약 패널이 오른쪽을 차지하면 '바깥 오른쪽'은 안쪽 오른쪽 위로 물러난다
    if (lpos === 'out' && sumOn) lpos = 'tr';
    const OUT_R = legendOn && lpos === 'out';
    const OUT_L = legendOn && lpos === 'left';
    const OUT_T = legendOn && lpos === 'top';
    const OUT_B = legendOn && lpos === 'bottom';
    const outside = OUT_R;
    const legendLineH = Math.round(fs * fsBig * 1.55);
    let legendBoxW = 0, legendH = 0, legendRows = 1;
    if (legendOn) {
      ctx.font = `${Math.round(fs * fsBig)}px ${FONT}`;
      let wmax = 0;
      for (const t of state.traces.filter((z) => z.visible)) {
        wmax = Math.max(wmax, ctx.measureText((t.legend || t.name)).width);
      }
      legendBoxW = Math.min(Math.max(200, cssW * 0.33), Math.max(300, Math.ceil(wmax) + 54));
      // 위/아래 범례의 줄 수는 플롯 폭이 정해진 뒤(요약 패널 반영 후) 다시 센다
    }
    // 여백: 포맷(저널 300 dpi 등)에서는 글자 크기에 맞춰 o.margin 으로 덮어쓴다
    const m = Object.assign({ l: 70, r: 26, t: 22, b: 46 }, o.margin || {});
    // Y축 제목 자리(회전 텍스트 + 눈금 숫자)를 왼쪽 여백에 미리 확보
    if (state.view.yLabel) m.l = Math.max(m.l, Math.round(fs * 6.0));
    if (OUT_R) m.r = Math.max(m.r, legendBoxW + 22);
    if (OUT_L) m.l = m.l + legendBoxW + 20;

    // ---- 우측 요약(사이드) 패널 — 주요 지점만 따로 그리는 작은 그래프들
    const sum = (state.summary && state.summary.panels && state.summary.panels.length) ? state.summary : null;
    let sumRect = null, sw = 0;
    if (sum) {
      sw = Math.max(150, Math.min(cssW * 0.34, Math.max(220, 300 * (fs0 / 13))));
      m.r = sw + Math.max(24, m.l * 0.5);
      m.t = Math.max(m.t, Math.round(fs0 * 2.0));     // 패널 제목 자리
      m.b = Math.max(m.b, Math.round(fs0 * 3.0));     // x축 제목 자리
      sumRect = { x: cssW - sw - 8, y: m.t, w: sw, h: cssH - m.t - m.b };
    }

    // 위/아래 범례: 실제 플롯 폭(요약 패널 제외)으로 줄 수를 세고 여백을 확보한다
    if (OUT_T || OUT_B) {
      const pwGuess = cssW - m.l - m.r;
      legendRows = 1;
      let acc = 0;
      for (const t of state.traces.filter((z) => z.visible)) {
        const iw = 50 + ctx.measureText((t.legend || t.name)).width + 28;
        if (acc > 0 && acc + iw > pwGuess) { legendRows++; acc = 0; }
        acc += iw;
      }
      legendH = legendRows * legendLineH + 10;
      if (OUT_T) m.t = m.t + legendH + 10;
      if (OUT_B) m.b = m.b + legendH + Math.round(fs * 1.9);
      if (sum) sumRect = { x: cssW - sw - 8, y: m.t, w: sw, h: cssH - m.t - m.b };
    }

    // ---- 스택 오프셋 계산
    const stacked = !!state.view.stacked;
    const normH = !!state.view.normHeight;
    const gap = state.view.gap;
    const xLo = Math.min(state.view.lo, state.view.hi);
    const xHi = Math.max(state.view.lo, state.view.hi);

    // 표시 구간 안의 y 범위 — 구간 밖에 포화 피크(예: 9700 cm⁻¹ A=6)가 있어도
    // 보이는 부분이 납작해지지 않도록 정규화 기준을 '보이는 범위'로 한정한다.
    const viewRange = new Map();
    const rangeInView = (t) => {
      if (viewRange.has(t.id)) return viewRange.get(t.id);
      let mn = Infinity, mx = -Infinity;
      const xs = t.p.x, ys = t.p.y;
      for (let i = 0; i < xs.length; i++) {
        if (xs[i] < xLo || xs[i] > xHi) continue;
        if (ys[i] < mn) mn = ys[i];
        if (ys[i] > mx) mx = ys[i];
      }
      if (!isFinite(mn)) { mn = Math.min.apply(null, ys); mx = Math.max.apply(null, ys); }
      const r = { mn: mn, mx: mx };
      viewRange.set(t.id, r);
      return r;
    };

    let yLo, yHi;
    const order = vis.slice();               // traces[0] 이 아래
    if (stacked) {
      const n = order.length;
      if (normH) { yLo = -0.05; yHi = (n - 1) * (1 + gap) + 1.0 + 0.32; }
      else {
        const gmin = Math.min.apply(null, vis.map((t) => rangeInView(t).mn));
        const gmax = Math.max.apply(null, vis.map((t) => rangeInView(t).mx));
        const span = (gmax - gmin) || 1;
        yLo = gmin - span * 0.03;
        yHi = gmax + span * (gap * (n - 1) + 0.05);
      }
    } else {
      const gmin = Math.min.apply(null, vis.map((t) => rangeInView(t).mn));
      const gmax = Math.max.apply(null, vis.map((t) => rangeInView(t).mx));
      const pad = (gmax - gmin) * 0.06 || 0.05;
      yLo = gmin - pad; yHi = gmax + pad;
    }

    const rev = state.view.rev !== false;
    const pw = cssW - m.l - m.r, ph = cssH - m.t - m.b;

    const X = (v) => {
      const t = (v - xLo) / ((xHi - xLo) || 1);
      return m.l + (rev ? (1 - t) : t) * pw;
    };
    const Y = (v) => m.t + ph * (1 - (v - yLo) / ((yHi - yLo) || 1));

    const geom = { X, Y, m, cssW, cssH, pw, ph, xLo, xHi, yLo, yHi, stacked, order };
    canvas._geom = geom;

    // ---- 배경 격자
    const xTicks = [];
    {
      const step = niceStep(xHi - xLo, Math.max(4, Math.round(pw / 90)));
      const start = Math.ceil(xLo / step) * step;
      for (let v = start; v <= xHi + 1e-6; v += step) xTicks.push(v);
    }
    const yTicks = [];
    if (!stacked || !normH) {
      const step = niceStep(yHi - yLo, Math.max(3, Math.round(ph / 70)));
      const start = Math.ceil(yLo / step) * step;
      for (let v = start; v <= yHi + 1e-6; v += step) yTicks.push(v);
    }

    if (state.view.grid !== false) {
      ctx.strokeStyle = gridC; ctx.lineWidth = theme.gridW || 1;
      ctx.beginPath();
      for (const v of xTicks) { const px = Math.round(X(v)) + .5; ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); }
      for (const v of yTicks) { const py = Math.round(Y(v)) + .5; ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); }
      ctx.stroke();
    }

    // ---- 축 (L자)
    ctx.strokeStyle = axisC; ctx.lineWidth = theme.axisW || 1;
    ctx.beginPath();
    ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, m.t + ph); ctx.lineTo(m.l + pw, m.t + ph);
    ctx.stroke();

    // ---- 사방 테두리(선택) — theme.frame 이 있으면 플롯 영역을 닫아 그린다
    if (theme.frame) {
      ctx.strokeStyle = theme.frameColor || axisC; ctx.lineWidth = theme.axisW || 1;
      ctx.beginPath();
      ctx.rect(m.l, m.t, pw, ph);
      ctx.stroke();
    }

    ctx.fillStyle = fg;
    ctx.font = `${fs}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of xTicks) {
      const px = X(v);
      ctx.fillText(String(Math.abs(v) >= 1000 ? v : v), px, m.t + ph + 8);
      ctx.strokeStyle = axisC; ctx.lineWidth = theme.axisW || 1; ctx.beginPath();
      ctx.moveTo(px, m.t + ph); ctx.lineTo(px, m.t + ph + 5); ctx.stroke();
    }
    if (yTicks.length) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      const ys = yTicks.length > 1 ? Math.abs(yTicks[1] - yTicks[0]) : 1;
      const yDec = ys >= 1 ? 0 : ys >= 0.1 ? 1 : ys >= 0.01 ? 2 : 3;
      for (const v of yTicks) {
        const py = Y(v);
        ctx.fillText(v.toFixed(yDec), m.l - 8, py);
        ctx.strokeStyle = axisC; ctx.lineWidth = theme.axisW || 1; ctx.beginPath();
        ctx.moveTo(m.l - 5, py); ctx.lineTo(m.l, py); ctx.stroke();
      }
    }

    // ---- 축 라벨
    ctx.fillStyle = fg;
    ctx.font = `${Math.round(fs * 1.05)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(state.view.xLabel || 'Wavenumber (cm⁻¹)', m.l + pw / 2, cssH - 6);
    // Y축 제목 — 스택(정규화) 모드에서도 항상 왼쪽에 회전해 그린다
    if (state.view.yLabel) {
      ctx.save();
      ctx.translate(Math.round(fs * 1.5), m.t + ph / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(state.view.yLabel, 0, 0);
      ctx.restore();
    }

    // ---- 스펙트럼
    const nTraces = order.length;
    const offsets = new Map();
    order.forEach((t, i) => {
      let off = 0, k = 1;
      if (stacked) {
        const vr = rangeInView(t);
        if (normH) {
          k = 1 / ((vr.mx - vr.mn) || 1);
          off = i * (1 + gap) - vr.mn * k;
        } else {
          const gmin = Math.min.apply(null, vis.map((x) => rangeInView(x).mn));
          const span = (Math.max.apply(null, vis.map((x) => rangeInView(x).mx)) - gmin) || 1;
          off = i * gap * span;
        }
      }
      offsets.set(t.id, { k, off });
    });

    // ---- 플롯 영역 클립(스펙트럼이 축 밖으로 삐져나가지 않게)
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.l, m.t, pw, ph);
    ctx.clip();

    // 선택 표시(배경 밴드)
    order.forEach((t, i) => {
      if (!stacked || !normH) return;
      if (state.selectedId === t.id) {
        ctx.fillStyle = 'rgba(90,150,255,0.07)';
        ctx.fillRect(m.l, Y(i * (1 + gap) + 1.02), pw, Math.max(2, Y(i * (1 + gap)) - Y(i * (1 + gap) + 1.02)));
      }
    });

    // 차이 스펙트럼 채움(양: 적색, 음: 청색)
    for (const t of order) {
      if (!t.fillDiff) continue;
      const { k, off } = offsets.get(t.id);
      const pz = Y(off);
      ctx.save();
      for (let i = 1; i < t.p.x.length; i++) {
        const ya = t.p.y[i - 1], yb = t.p.y[i];
        if (ya === 0 && yb === 0) continue;
        const px0 = X(t.p.x[i - 1]), px1 = X(t.p.x[i]);
        if (Math.abs(px1 - px0) < 0.05) continue;
        ctx.fillStyle = ((ya + yb) / 2 >= 0) ? 'rgba(255,90,90,0.22)' : 'rgba(80,150,255,0.22)';
        ctx.beginPath();
        ctx.moveTo(px0, Y(ya * k + off));
        ctx.lineTo(px1, Y(yb * k + off));
        ctx.lineTo(px1, pz); ctx.lineTo(px0, pz);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }

    // 선
    for (const t of order) {
      const { k, off } = offsets.get(t.id);
      ctx.save();
      ctx.beginPath();
      ctx.lineWidth = t.width || 1.6;
      ctx.strokeStyle = t.color;
      ctx.setLineDash(dashArr(t.dash));
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      const alpha = t.alpha === undefined ? 1 : t.alpha;
      ctx.globalAlpha = alpha;
      let started = false;
      for (let i = 0; i < t.p.x.length; i++) {
        const px = X(t.p.x[i]);
        const py = Y(t.p.y[i] * k + off);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }

    // ---- 피크 마커/라벨
    const unitPx = ph / ((yHi - yLo) || 1);
    const gapPx = (stacked && normH) ? gap * unitPx : 0;
    const maxLevels = (stacked && normH) ? (gapPx > 30 ? 2 : gapPx > 12 ? 1 : 0) : 2;
    const levelStep = Math.min(26, Math.max(10, gapPx * 0.72));
    if (state.view.peaksOn !== false) {
      for (const t of order) {
        if (!t.peaks || !t.peaks.length) continue;
        const { k, off } = offsets.get(t.id);
        const drawLabels = state.view.labelsOn !== false && maxLevels > 0;
        const maxLab = t.maxLabels || 40;
        const _vr = rangeInView(t);
        const spanV = (_vr.mx - _vr.mn) || 1;
        const labThr = (state.view.labelMinProm === undefined ? 0.03 : state.view.labelMinProm) * spanV;
        const levels = [[], []];
        let placed = 0;
        const sorted = t.peaks.slice().sort((a, b) => b.prom - a.prom);
        for (const pk of sorted) {
          const px = X(pk.x);
          const py = Y(pk.y * k + off);
          ctx.save();
          ctx.strokeStyle = t.color; ctx.fillStyle = t.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(px, py - 2); ctx.lineTo(px - 3, py - 8); ctx.lineTo(px + 3, py - 8); ctx.closePath();
          ctx.fill();
          if (drawLabels && placed < maxLab && pk.prom >= labThr) {
            let lv = -1;
            for (let L = 0; L < maxLevels; L++) {
              if (!levels[L].some((v) => Math.abs(v - px) < 11)) { lv = L; break; }
            }
            if (lv >= 0) {
              levels[lv].push(px);
              const label = pk.label || pk.x.toFixed(0);
              ctx.save();
              ctx.translate(px - 3, py - 10 - lv * levelStep);
              ctx.rotate(-Math.PI / 2);
              ctx.font = `${Math.max(8, Math.round(fs * 0.68))}px ${FONT}`;
              ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
              ctx.globalAlpha = 0.95;
              ctx.fillText(label, 0, 0);
              ctx.restore();
              placed++;
            }
          }
          ctx.restore();
        }
      }
    }

    ctx.restore();   // 클립 해제

    // ---- 스택 모드에서 트레이스 이름 라벨(각 밴드 상단 왼쪽)
    if (stacked && normH) {
      ctx.font = `${Math.round(fs * 0.85)}px ${FONT}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      order.forEach((t, i) => {
        let y = Y(i * (1 + gap) + 1.0) - 1;
        if (y - fs * 0.9 < m.t + 1) y = m.t + 1 + fs * 0.9;   // 최상단 밴드는 축 안쪽으로
        const nm = t.legend || t.name;
        const maxCh = o.nameMax || 16;
        let txt = nm.length > maxCh ? nm.slice(0, maxCh - 1) + '…' : nm;
        while (txt.length > 3 && ctx.measureText(txt).width > pw * 0.55) txt = txt.slice(0, -2) + '…';
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = nameBgC;
        ctx.fillRect(m.l + 2, y - fs * 0.92, tw + 6, fs * 0.92);
        ctx.fillStyle = t.color;
        ctx.fillText(txt, m.l + 5, y);
      });
    }

    // ---- 호버 크로스헤어
    if (state.hover && state.hover.px !== null && state.hover.px !== undefined) {
      const px = state.hover.px;
      if (px > m.l && px < m.l + pw) {
        ctx.strokeStyle = crossC;
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ---- 범례 (바깥: 오른쪽 상자 · 위/아래 가로줄 · 왼쪽 상자 / 안쪽: 네 모서리)
    const legendRects = [];
    if (legendOn && order.length) {
      const pad = 10;
      ctx.font = `${Math.round(fs * fsBig)}px ${FONT}`;
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';

      if (OUT_T || OUT_B) {
        // 가로 배치 — 폭이 모자라면 다음 줄로
        const y0 = OUT_T ? (m.t - legendH - Math.round(fs * 0.55)) : (m.t + ph + Math.round(fs * 1.7));
        let cx = m.l, cy = y0 + 4;
        order.forEach((t) => {
          const nm = t.legend || t.name;
          const tw = ctx.measureText(nm).width;
          const iw = 50 + tw + 28;
          if (cx > m.l && cx + iw - 4 > m.l + pw) { cx = m.l; cy += legendLineH; }
          const mid = cy + legendLineH / 2;
          ctx.strokeStyle = t.color; ctx.lineWidth = Math.max(2, t.width || 1.6);
          ctx.setLineDash(dashArr(t.dash));
          ctx.beginPath(); ctx.moveTo(cx + 2, mid); ctx.lineTo(cx + 30, mid); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = t.color;
          ctx.fillText(nm, cx + 36, mid);
          legendRects.push({ id: t.id, x: cx, y: cy, w: iw, h: legendLineH });
          cx += iw;
        });
      } else {
        const boxW = Math.min(legendBoxW, Math.max(120, cssW - m.l - m.r - 8));
        let boxH = order.length * legendLineH + pad * 2;
        const maxH = ph - 20;
        let lh = legendLineH;
        if (boxH > maxH) { lh = Math.max(11, Math.floor((maxH - pad * 2) / order.length)); boxH = order.length * lh + pad * 2; }
        let bx, by;
        if (OUT_R) { bx = m.l + pw + 10; by = m.t; }
        else if (OUT_L) { bx = Math.max(4, m.l - boxW - 14); by = m.t; }
        else {
          bx = (lpos === 'tl' || lpos === 'bl') ? m.l + 10 : m.l + pw - boxW - 10;
          by = (lpos === 'bl' || lpos === 'br') ? m.t + ph - boxH - 10 : m.t + 10;
        }
        ctx.save();
        ctx.fillStyle = OUT_R ? 'rgba(12,18,26,0)' : legendBgC;
        ctx.strokeStyle = legendStrokeC;
        ctx.lineWidth = 1;
        ctx.beginPath();
        const r = 6;
        ctx.moveTo(bx + r, by);
        ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, r);
        ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, r);
        ctx.arcTo(bx, by + boxH, bx, by, r);
        ctx.arcTo(bx, by, bx + boxW, by, r);
        ctx.closePath(); ctx.fill(); ctx.stroke();

        order.forEach((t, i) => {
          const cy = by + pad + i * lh + lh / 2;
          ctx.strokeStyle = t.color; ctx.lineWidth = Math.max(2, t.width || 1.6);
          ctx.setLineDash(dashArr(t.dash));
          ctx.beginPath(); ctx.moveTo(bx + 10, cy); ctx.lineTo(bx + 38, cy); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = t.color;
          let nm = t.legend || t.name;
          const avail = boxW - 48;
          if (ctx.measureText(nm).width > avail) {
            while (nm.length > 2 && ctx.measureText(nm + '…').width > avail) nm = nm.slice(0, -1);
            nm += '…';
          }
          ctx.fillText(nm, bx + 44, cy);
          legendRects.push({ id: t.id, x: bx, y: by + pad + i * lh, w: boxW, h: lh });
        });
        ctx.restore();
      }
    }

    // ---- 우측 요약 패널 그리기
    if (sumRect) drawSummary(ctx, sumRect, sum, { fg: fg, axis: axisC, grid: gridC, muted: mutedC }, fs);

    return { geom, legendRects };
  }

  /* =========================================================================
   * 우측 요약(사이드) 패널 — 주요 지점만 따로 그리는 작은 산점도
   *  summary = { panels: [{
   *    title, yLabel, yUnit, yMin, yMax, yFmt,           // 축
   *    categories: ['AB','BB'],                          // x 위치(범주)
   *    legend: [{name, color, marker}],                  // 패널 상단 범례(선택)
   *    points: [{cat, y, text, color, marker}]           // cat = categories 인덱스
   *  }] }
   * ========================================================================= */
  function drawSummary(ctx, rect, summary, th, fs) {
    const panels = summary.panels;
    const gapY = Math.round(fs * 2.2);
    const ph = (rect.h - gapY * (panels.length - 1)) / panels.length;
    panels.forEach((pn, i) => {
      const y0 = rect.y + i * (ph + gapY);
      drawSummaryPanel(ctx, { x: rect.x, y: y0, w: rect.w, h: ph }, pn, th, fs,
        i === panels.length - 1, ph > 120);
    });
  }

  function marker(ctx, shape, x, y, r) {
    ctx.beginPath();
    if (shape === 'diamond') {
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath();
    } else if (shape === 'square') {
      ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  function drawSummaryPanel(ctx, r, pn, th, fs, last, roomy) {
    const fg = th.fg, axisC = th.axis, gridC = th.grid, mutedC = th.muted;
    const fSmall = Math.max(8, Math.round(fs * 0.72));
    const fTitle = Math.max(9, Math.round(fs * 0.82));

    // 제목
    ctx.fillStyle = fg;
    ctx.font = `${fTitle}px ${FONT}`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(pn.title || '', r.x, r.y - Math.round(fs * 0.2));

    const pl = Math.round(fs * 3.8), pb = Math.round(fs * (last ? 2.0 : 0.9)),
      pt = Math.round(fs * ((pn.legend && roomy) ? 1.7 : 0.6));
    const px0 = r.x + pl, py0 = r.y + pt, pw = r.w - pl - Math.round(fs * 0.4), phh = r.h - pt - pb;
    if (pw < 20 || phh < 20) return;

    // y 범위
    let mn = Infinity, mx = -Infinity;
    for (const p of pn.points) { if (isFinite(p.y)) { if (p.y < mn) mn = p.y; if (p.y > mx) mx = p.y; } }
    if (!isFinite(mn)) { mn = 0; mx = 1; }
    if (pn.yMin !== undefined) mn = Math.min(mn, pn.yMin);
    if (pn.yMax !== undefined) mx = Math.max(mx, pn.yMax);
    let pad = (mx - mn) * 0.18 || Math.abs(mx) * 0.1 || 1;
    mn -= pad; mx += pad;
    const Y = (v) => py0 + phh - ((v - mn) / ((mx - mn) || 1)) * phh;

    // x 범주 위치
    const cats = pn.categories && pn.categories.length ? pn.categories : [];
    const nCat = Math.max(1, cats.length);
    const X = (i) => px0 + (pw / nCat) * (i + 0.5);

    // 축 + 격자
    ctx.strokeStyle = axisC; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px0, py0); ctx.lineTo(px0, py0 + phh); ctx.lineTo(px0 + pw, py0 + phh); ctx.stroke();

    const step = niceStep(mx - mn, 4);
    ctx.font = `${fSmall}px ${FONT}`;
    ctx.fillStyle = mutedC; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(mn / step) * step; v <= mx; v += step) {
      const yy = Y(v);
      ctx.strokeStyle = gridC; ctx.beginPath(); ctx.moveTo(px0, yy); ctx.lineTo(px0 + pw, yy); ctx.stroke();
      ctx.fillStyle = mutedC;
      ctx.fillText(pn.yFmt === 0 ? String(Math.round(v)) : v.toFixed(1), px0 - 6, yy);
    }

    // x 범주 라벨 — 마지막 패널에만(공간 절약)
    if (last) {
      ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      const fCat = Math.max(7, Math.round(fs * 0.66));
      ctx.font = `${fCat}px ${FONT}`;
      cats.forEach((c, i) => {
        let s = String(c);
        while (s.length > 3 && ctx.measureText(s).width > (pw / nCat) - 4) s = s.slice(0, -2) + '…';
        ctx.fillText(s, X(i), py0 + phh + 5);
      });
    }

    // y축 라벨(회전)
    if (pn.yLabel) {
      ctx.save();
      ctx.translate(r.x + Math.round(fs * 0.5), py0 + phh / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = `${fSmall}px ${FONT}`; ctx.fillStyle = fg;
      ctx.fillText(pn.yLabel, 0, 0);
      ctx.restore();
    }

    // 점 + 값 라벨 — 범주가 촘촘하면 값 라벨은 생략(표에서 확인)
    const rad = Math.max(3, Math.round(fs * 0.3));
    const showText = (pw / nCat) >= 52;
    for (const p of pn.points) {
      if (!isFinite(p.y)) continue;
      const xx = X(p.cat || 0), yy = Y(p.y);
      ctx.fillStyle = p.color || fg;
      marker(ctx, p.marker || 'circle', xx, yy, rad);
      const full = p.text !== undefined ? p.text : (pn.yFmt === 0 ? Math.round(p.y) : p.y.toFixed(1)) + (pn.yUnit || '');
      ctx.font = `${fSmall}px ${FONT}`;
      const slot = (pw / nCat) - 4;
      let txt = full;
      if (ctx.measureText(txt).width > slot && p.textShort) txt = p.textShort;
      if (!p.alwaysText && ctx.measureText(txt).width > slot) continue;
      ctx.textAlign = 'center'; ctx.textBaseline = p.below ? 'top' : 'bottom';
      ctx.fillStyle = p.color || fg;
      ctx.fillText(txt, Math.min(Math.max(xx, r.x + ctx.measureText(txt).width / 2), r.x + r.w - ctx.measureText(txt).width / 2),
        p.below ? yy + rad + 2 : yy - rad - 2);
    }

    // 패널 범례(상단 오른쪽)
    if (pn.legend && pn.legend.length && roomy) {
      ctx.font = `${fSmall}px ${FONT}`;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      let lx = px0 + 4;
      const ly = r.y + Math.round(fs * 0.6);
      for (const lg of pn.legend) {
        ctx.fillStyle = lg.color || fg;
        marker(ctx, lg.marker || 'circle', lx + 3, ly, rad * 0.85);
        ctx.fillText(lg.name, lx + 10, ly);
        lx += 10 + ctx.measureText(lg.name).width + 12;
      }
    }
  }

  /* 내보내기 배경 프리셋
   * transparent : 배경 없음 + 어두운 글자(흰 문서·PPT에 붙여도 보이게)
   * white       : 흰 배경 + 어두운 글자
   * dark        : 앱 테마 그대로(어두운 배경 + 밝은 글자)
   */
  const INK_DARK = {
    fg: '#1b2026', grid: 'rgba(0,0,0,0.10)', axis: '#5b6672', muted: '#8b95a1',
    nameBg: 'rgba(255,255,255,0.72)', cross: 'rgba(0,0,0,0.22)',
    legendBg: 'rgba(255,255,255,0.85)', legendStroke: 'rgba(0,0,0,0.18)'
  };
  function exportTheme(mode) {
    if (mode === 'white') return Object.assign({ bg: '#ffffff' }, INK_DARK);
    if (mode === 'dark') return {};
    return Object.assign({ bg: null }, INK_DARK);   // 기본: 투명
  }

  /* PNG 내보내기
   *  o.scale   : 배율(기본 2 = 화면의 2배 해상도)
   *  o.width/h : 출력 픽셀 크기(포맷 프리셋에서 지정). 없으면 화면 크기
   *  o.theme   : 배경/잉크 오버라이드(exportTheme 결과)
   *  o.font / o.margin : 포맷별 서체·여백
   */
  function toPNG(canvas, state, opts) {
    const o = opts || {};
    const scale = o.scale || 2;
    const off = document.createElement('canvas');
    const w = o.width || canvas.clientWidth || canvas.width;
    const h = o.height || canvas.clientHeight || canvas.height;
    const mode = o.bg || 'transparent';
    const th = Object.assign({}, exportTheme(mode), o.theme || {});
    // 화면 전용 요소(선택 밴드 음영·크로스헤어)는 내보내지 않는다
    state = Object.assign({}, state, { selectedId: null, hover: null });
    render(off, state, {
      scale, width: w, height: h, theme: th, font: o.font, margin: o.margin,
      nameMax: o.nameMax, transparent: mode === 'transparent'
    });
    const url = off.toDataURL('image/png');
    window.__lastPNG = url;            // 테스트·검증용 마지막 산출물
    return url;
  }

  /* =========================================================================
   * 내보내기 포맷 프리셋 — 학술지용 / PPT용 / 화면 그대로
   *  · 물리 크기와 글자 크기를 같이 맞춘다: 저널은 mm·dpi 로 픽셀을 계산하고
   *    글자는 7 pt(= dpi 기준 픽셀)로 고정 → 인쇄했을 때 축 눈금이 7 pt 로 나온다.
   *  · journal : 흰 배경·serif·격자 없음·범례 대신 스펙트럼 위 이름·피크 라벨은 큰 것만
   *  · ppt     : 투명 배경·산세리프·굵은 글씨·격자·이름표+범례·피크 라벨
   * ========================================================================= */
  const JOURNAL_FONT = '"Times New Roman",Times,"Liberation Serif",Georgia,serif';
  const PPT_FONT = '"Segoe UI","Malgun Gothic",system-ui,sans-serif';
  /* 사용자가 고른 서체가 있으면 포맷 기본 서체를 덮어쓴다.
     예: 'HDharmony L' (현대하모니 L) — PC에 설치된 이름 그대로 지정
     '#ko:이름' 은 "한글만 사내 서체, 라틴·숫자는 포맷 기본" 모드 —
     라틴 기본 서체 목록 뒤에 사내 서체를 붙이면, 글자별 폴백으로
     라틴은 기본 서체, 한글만 사내 서체가 된다(저널 도판에 유용). */
  const KO_PREFIX = '#ko:';
  /* 한글만 모드 스택 — 라틴은 포맷 기본 서체, 한글은 사내 서체.
     사내 서체를 제네릭 계열(sans-serif/serif) *앞*에 둬야 한글이 사내 서체로 간다.
     (제네릭이 먼저면 OS 기본 한글 서체가 잡혀 버린다) */
  const koStack = (name, serif) => serif
    ? '"Times New Roman",Times,"Liberation Serif","' + name + '",Georgia,serif'
    : '"Segoe UI","' + name + '",system-ui,sans-serif';
  const fontOverride = (o, base) => {
    const fam = o && o.fontFamily;
    if (!fam) return base;
    if (fam.indexOf(KO_PREFIX) === 0) {
      // 'sans-serif' 가 'Serif' 로 오인되지 않도록 구체적 패밀리 이름으로 판정
      return koStack(fam.slice(KO_PREFIX.length), /Times New Roman|Liberation Serif|Georgia/.test(base));
    }
    return '"' + fam + '",' + base;
  };

  function formatPreset(fmt, opts) {
    const o = opts || {};
    const dpi = o.dpi || 300;
    if (fmt === 'journal') {
      const wmm = o.wmm || 180;                       // 180 mm = double column, 88 mm = single
      const width = Math.round((wmm / 25.4) * dpi);
      const height = Math.round(width * (wmm > 120 ? 0.52 : 0.66));
      const fs = Math.round((7 * dpi) / 72);          // 7 pt
      const k = fs / 27;
      return {
        width, height, scale: 1, bg: 'white', font: fontOverride(o, JOURNAL_FONT), nameMax: 26,
        margin: {
          l: Math.round(fs * 2.3), t: Math.round(fs * 1.5),
          b: Math.round(fs * 3.0 + 6), r: Math.round(26 * k)
        },
        view: {
          grid: false, legendOn: false, fontSize: fs,
          peaksOn: true, labelsOn: true,
          labelMinProm: o.labelMinProm || 0.03
        },
        // 2.2 px @300 dpi ≈ 0.53 pt(인쇄 최소선) · 피크 라벨은 시료당 5개까지만
        trace: { minW: 2.2, alpha: 1, maxLabels: 5, nameMax: 26 },
        label: '학술지 ' + (wmm > 120 ? 'double' : 'single') + ' ' + wmm + ' mm · ' + dpi + ' dpi'
      };
    }
    if (fmt === 'ppt') {
      /* PPT 도판 잉크 — 축·눈금·제목을 검정으로, 내부 격자를 보이게.
         (기본 INK_DARK 는 축 #5b6672 · 격자 alpha 0.10 이라 흰 슬라이드에서 흐릿했다) */
      const pptTheme = {
        bg: null,
        fg: '#111111', axis: '#111111', muted: '#3d444c',
        grid: 'rgba(0,0,0,0.28)', gridW: 1.6, axisW: 2.0,
        nameBg: 'rgba(255,255,255,0.90)', legendBg: 'rgba(255,255,255,0.92)',
        legendStroke: 'rgba(0,0,0,0.30)'
      };
      if (o.frame) { pptTheme.frame = true; pptTheme.frameColor = '#111111'; }
      return {
        width: o.width || 1600, height: o.height || 900, scale: 1, bg: 'transparent',
        font: fontOverride(o, PPT_FONT), theme: pptTheme,
        margin: { l: Math.round(26 * 2.5), t: Math.round(26 * 1.5), b: Math.round(26 * 2.9) }, nameMax: 26,
        view: {
          grid: true, legendOn: o.legendOn !== false, fontSize: 26,
          peaksOn: true, labelsOn: true,
          labelMinProm: o.labelMinProm || 0.03
        },
        trace: { minW: 3.6, alpha: 1, maxLabels: 8 },
        label: 'PPT 16:9 ' + (o.width || 1600) + '×' + (o.height || 900) + ' px · 투명 배경'
      };
    }
    return null;
  }

  // 포맷에 맞춰 view 를 덮어쓴 state 사본
  function stateForFormat(state, fmt, opts) {
    const o = Object.assign({ labelMinProm: state && state.view ? state.view.labelMinProm : 0.03 }, opts || {});
    const p = formatPreset(fmt, o);
    if (!p) return state;
    const s = Object.assign({}, state);
    s.view = Object.assign({}, state.view, p.view);
    if (p.trace) {
      const C = window.FTIRC;
      s.traces = state.traces.map((t) => {
        if (!t.visible) return t;
        const c = Object.assign({}, t, {
          lineW: Math.max(t.lineW || t.width || 1.6, p.trace.minW),
          alpha: p.trace.alpha === undefined ? t.alpha : p.trace.alpha,
          maxLabels: p.trace.maxLabels || t.maxLabels
        });
        // 아직 피크를 검출하지 않은 시료도 도판에서는 라벨이 보이도록 여기서 검출
        if ((!c.peaks || !c.peaks.length) && C && C.findPeaks && c.p && c.p.x) {
          c.peaks = C.findPeaks(c.p.x, c.p.y, { minProm: 0.015, minSep: 8, maxPeaks: 200 });
        }
        return c;
      });
    }
    return s;
  }

  /* 사내 서체 등 @font-face 로 넣은 글꼴을 내보내기 전에 확실히 로드한다.
     (내보내기가 동기라, 로드 전에 그리면 대체 서체로 굳어 버린다) */
  async function ensureFont(family) {
    if (!family) return true;
    family = String(family).replace(/^#ko:/, '');
    try {
      await document.fonts.load('32px "' + family + '"');
      // 실제로 적용됐는지 확인: 기준 서체와 폭이 다르면 적용된 것
      const cv = document.createElement('canvas').getContext('2d');
      const s = '현대하모니 Test 123';
      cv.font = '40px "' + family + '"'; const a = cv.measureText(s).width;
      cv.font = '40px "__no_such_font__"'; const b = cv.measureText(s).width;
      return Math.abs(a - b) > 0.5;
    } catch (e) { return false; }
  }

  window.FTIRPlot = { render, toPNG, exportTheme, formatPreset, stateForFormat, JOURNAL_FONT, PPT_FONT, dashArr, niceStep, ensureFont };
})();

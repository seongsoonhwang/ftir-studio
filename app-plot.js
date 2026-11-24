/* =========================================================================
 * app-plot.js — 캔버스 스펙트럼 렌더러 (의존성 없음)
 * 스택/오버레이, 개별 선 스타일, 피크 라벨, 편집 가능한 범례, 고DPI 내보내기
 * ========================================================================= */
(function () {
  'use strict';
  const FONT = '"Malgun Gothic","Segoe UI",system-ui,sans-serif';

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

    const theme = state.theme || {};
    const bg = theme.bg || '#0f1319';
    const fg = theme.fg || '#c9d3e0';
    const gridC = theme.grid || 'rgba(140,160,190,0.14)';
    const axisC = theme.axis || '#8fa1b8';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const vis = state.traces.filter((t) => t.visible && t.p && t.p.y.length);
    if (!vis.length) {
      ctx.fillStyle = '#5b6b80';
      ctx.font = `14px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('스펙트럼이 없습니다 — 파일을 끌어다 놓거나 “데모 데이터”를 누르세요', cssW / 2, cssH / 2);
      return { geom: null, legendRects: [] };
    }

    const fs = state.view.fontSize || 13;
    const fsBig = state.view.legendScale || 1;

    // ---- 범례 폭 측정(바깥 배치 시 오른쪽 여백 확보)
    const legendOn = state.view.legendOn !== false;
    let legendBoxW = 0;
    if (legendOn) {
      ctx.font = `${Math.round(fs * fsBig)}px ${FONT}`;
      let wmax = 0;
      for (const t of state.traces.filter((z) => z.visible)) {
        wmax = Math.max(wmax, ctx.measureText((t.legend || t.name)).width);
      }
      legendBoxW = Math.min(Math.max(200, cssW * 0.33), Math.max(300, Math.ceil(wmax) + 54));
    }
    const outside = legendOn && state.view.legendPos === 'out';
    const m = { l: 70, r: outside ? legendBoxW + 22 : 26, t: 22, b: 46 };

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
      ctx.strokeStyle = gridC; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const v of xTicks) { const px = Math.round(X(v)) + .5; ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); }
      for (const v of yTicks) { const py = Math.round(Y(v)) + .5; ctx.moveTo(m.l, py); ctx.lineTo(m.l + pw, py); }
      ctx.stroke();
    }

    // ---- 축
    ctx.strokeStyle = axisC; ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(m.l, m.t); ctx.lineTo(m.l, m.t + ph); ctx.lineTo(m.l + pw, m.t + ph);
    ctx.stroke();

    ctx.fillStyle = fg;
    ctx.font = `${fs}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (const v of xTicks) {
      const px = X(v);
      ctx.fillText(String(Math.abs(v) >= 1000 ? v : v), px, m.t + ph + 8);
      ctx.strokeStyle = axisC; ctx.beginPath();
      ctx.moveTo(px, m.t + ph); ctx.lineTo(px, m.t + ph + 5); ctx.stroke();
    }
    if (yTicks.length) {
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (const v of yTicks) {
        const py = Y(v);
        ctx.fillText(v.toFixed(Math.abs(v) < 1 ? 3 : 2), m.l - 8, py);
        ctx.strokeStyle = axisC; ctx.beginPath();
        ctx.moveTo(m.l - 5, py); ctx.lineTo(m.l, py); ctx.stroke();
      }
    }

    // ---- 축 라벨
    ctx.fillStyle = fg;
    ctx.font = `${Math.round(fs * 1.05)}px ${FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText('Wavenumber (cm⁻¹)', m.l + pw / 2, cssH - 6);
    if (!stacked || !normH) {
      ctx.save();
      ctx.translate(14, m.t + ph / 2); ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(state.view.yLabel || 'Absorbance (a.u.)', 0, 0);
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
        const txt = nm.length > 16 ? nm.slice(0, 15) + '…' : nm;
        const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(15,19,25,0.78)';
        ctx.fillRect(m.l + 2, y - fs * 0.92, tw + 6, fs * 0.92);
        ctx.fillStyle = t.color;
        ctx.fillText(txt, m.l + 5, y);
      });
    }

    // ---- 호버 크로스헤어
    if (state.hover && state.hover.px !== null && state.hover.px !== undefined) {
      const px = state.hover.px;
      if (px > m.l && px < m.l + pw) {
        ctx.strokeStyle = 'rgba(160,190,230,0.45)';
        ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(px, m.t); ctx.lineTo(px, m.t + ph); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // ---- 범례
    const legendRects = [];
    if (legendOn) {
      ctx.font = `${Math.round(fs * fsBig)}px ${FONT}`;
      const lineH = Math.round(fs * fsBig * 1.55);
      const pad = 10;
      const boxW = outside ? Math.min(legendBoxW, cssW - m.l - m.r + 8) : Math.min(pw - 20, legendBoxW);
      let boxH = order.length * lineH + pad * 2;
      const maxH = outside ? ph : ph - 20;
      let lh = lineH;
      if (boxH > maxH) { lh = Math.max(11, Math.floor((maxH - pad * 2) / order.length)); boxH = order.length * lh + pad * 2; }
      const pos = state.view.legendPos || 'out';
      let bx, by;
      if (outside) { bx = m.l + pw + 10; by = m.t; }
      else {
        bx = pos === 'tl' ? m.l + 10 : (pos === 'bl' ? m.l + 10 : m.l + pw - boxW - 10);
        by = (pos === 'bl' || pos === 'br') ? m.t + ph - boxH - 10 : m.t + 10;
      }
      ctx.save();
      ctx.fillStyle = outside ? 'rgba(12,18,26,0.0)' : 'rgba(12,18,26,0.72)';
      ctx.strokeStyle = 'rgba(140,170,210,0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const r = 6;
      ctx.moveTo(bx + r, by);
      ctx.arcTo(bx + boxW, by, bx + boxW, by + boxH, r);
      ctx.arcTo(bx + boxW, by + boxH, bx, by + boxH, r);
      ctx.arcTo(bx, by + boxH, bx, by, r);
      ctx.arcTo(bx, by, bx + boxW, by, r);
      ctx.closePath(); ctx.fill(); ctx.stroke();

      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(fs * fsBig)}px ${FONT}`;
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

    return { geom, legendRects };
  }

  /* PNG 내보내기 (2배 고해상도) */
  function toPNG(canvas, state, opts) {
    const o = opts || {};
    const scale = o.scale || 2;
    const off = document.createElement('canvas');
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;
    render(off, state, { scale, width: w, height: h });
    return off.toDataURL(o.transparent ? 'image/png' : 'image/png');
  }

  window.FTIRPlot = { render, toPNG, dashArr, niceStep };
})();

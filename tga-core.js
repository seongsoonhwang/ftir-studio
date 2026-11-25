/* =========================================================================
 * tga-core.js — TGA(열중량) 분석 엔진
 *  · ASCII 파싱(온도·중량 2~5열, 탭/쉼표/세미콜론/공백, 소수점 쉼표)
 *  · T5%·T10%·T50% (규정 중량 감소 온도), 잔량(residue)
 *  · 외삽 분해개시온도(Td,onset), DTG 최대점(Tmax)
 *  · 중량 감소 단계(step) 분해 — 단계별 손실량
 *  · 합성 데모(실측 아님 — 알고리즘 검증용)
 * 의존성 없음. window.TGAC 로 노출.
 * ========================================================================= */
(function () {
  'use strict';

  const NUMRE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

  const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
  const stdev = (a) => {
    if (a.length < 2) return 0;
    const m = mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function mode(arr) {
    const m = new Map();
    let best = arr[0], bn = -1;
    for (const v of arr) { const c = (m.get(v) || 0) + 1; m.set(v, c); if (c > bn) { bn = c; best = v; } }
    return best;
  }

  function smooth(y, win) {
    const w = Math.max(1, win | 0);
    if (w <= 1 || y.length < 3) return y.slice();
    const h = w >> 1, out = new Array(y.length);
    for (let i = 0; i < y.length; i++) {
      let s = 0, c = 0;
      for (let k = i - h; k <= i + h; k++) { if (k < 0 || k >= y.length) continue; s += y[k]; c++; }
      out[i] = s / c;
    }
    return out;
  }

  /* 2차차분 요철도 — 축(시간·온도)은 매끄럽고 신호는 요철이 크다 */
  function roughness(col) {
    const n = col.length;
    if (n < 5) return 0;
    const mn = Math.min.apply(null, col), mx = Math.max.apply(null, col);
    const span = (mx - mn) || 1;
    let s = 0, c = 0;
    for (let i = 1; i < n - 1; i++) { s += Math.abs(col[i + 1] - 2 * col[i] + col[i - 1]); c++; }
    return (s / (c || 1)) / span;
  }

  /* ------------------------------------------------------------- 파싱 */
  function parseText(text, name, opts) {
    const O = opts || {};
    const raw = String(text || '').replace(/^\uFEFF/, '');
    const lines = raw.split(/\r?\n/);
    const warnings = [];

    // 구분자 추정 — 후보별로 '숫자 2개 이상으로 파싱되는 줄' 수를 세어 가장 많은 것을 고른다.
    //  Netzsch export 처럼 헤더 35줄 + 데이터 600줄 구조에서, 전체 글자수 비율로 세면
    //  세미콜론이 헤더에 없어 문턱(줄 수의 50 %)을 못 넘고 공백 구분으로 잘못 떨어진다.
    const probe = lines.slice(0, 300);
    const clean = (t) => t.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
    const isNum = (t, dc) => { const s = clean(t); return !!s && (NUMRE.test(s) || (dc && /^[+-]?\d+,\d+$/.test(s))); };
    const scoreDelim = (dl) => {
      let n = 0;
      const dc = dl !== ',';
      for (const l of probe) {
        if (!l.trim()) continue;
        const toks = dl ? l.split(dl) : l.trim().split(/\s+/);
        let k = 0;
        for (const t of toks) if (isNum(t, dc)) k++;
        if (k >= 2) n++;
      }
      return n;
    };
    let delim = null, bestDelimScore = 0;
    for (const cand of ['\t', ';', ',']) {          // 동점이면 탭 → 세미콜론 → 쉼표 순
      const sc = scoreDelim(cand);
      if (sc > bestDelimScore) { bestDelimScore = sc; delim = cand; }
    }
    if (bestDelimScore === 0) delim = null;          // 공백 구분

    let decComma = false;
    if (delim !== ',') {
      let hit = 0, tot = 0;
      for (const l of probe) {
        const toks = delim ? l.split(delim) : l.trim().split(/\s+/);
        for (const t of toks) {
          const s = t.trim().replace(/^["']|["']$/g, '');
          if (/^[+-]?\d+,\d+$/.test(s)) hit++;
          if (s) tot++;
        }
      }
      decComma = tot > 0 && hit / tot > 0.25;
    }

    const rows = [];
    let header = null;
    for (const line of lines) {
      if (!line.trim()) continue;
      const toks = delim ? line.split(delim) : line.trim().split(/\s+/);
      const nums = [];
      for (let t of toks) {
        t = t.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
        if (!t) continue;
        if (decComma && t.indexOf(',') > 0) t = t.replace(',', '.');
        if (NUMRE.test(t)) nums.push(Number(t));
      }
      if (nums.length >= 2) rows.push(nums);
      else if (!header && nums.length === 0) header = line.trim();
      if (rows.length >= 200000) { warnings.push('행이 너무 많아 20만 행에서 자릅니다'); break; }
    }
    if (rows.length < 5) return { ok: false, reason: '숫자 2열 이상인 데이터 행을 찾지 못했습니다 (TGA ASCII 2~5열을 기대)' };

    const width = mode(rows.map((r) => r.length));
    const numRows = rows.filter((r) => r.length >= width).map((r) => r.slice(0, width));

    // 온도 열 — 단조 증가, 범위 20~1200, 0에서 시작하면 감점(시간축)
    let tempCol = 0, best = -1;
    for (let c = 0; c < width; c++) {
      const col = numRows.map((r) => r[c]);
      const mn = Math.min.apply(null, col), mx = Math.max.apply(null, col);
      const range = mx - mn;
      if (range < 5 || mn < -300 || mx > 1500) continue;
      let mono = 0;
      for (let i = 1; i < col.length; i++) if (col[i] >= col[i - 1]) mono++;
      let score = (mono / (col.length - 1)) * 2.2 + Math.min(1, range / 300);
      if (mn >= -0.6 && mn <= 0.6) score -= 1.2;
      if (score > best) { best = score; tempCol = c; }
    }

    // 중량 열 — 전체적으로 감소하고(초기 ≈100에 가까움), 값 범위가 -5~120
    let wtCol = -1, bestW = -1;
    for (let c = 0; c < width; c++) {
      if (c === tempCol) continue;
      const col = numRows.map((r) => r[c]);
      const mn = Math.min.apply(null, col), mx = Math.max.apply(null, col);
      if (mx > 200 || mn < -50) continue;
      const drop = col[0] - col[col.length - 1];
      let score = 0;
      if (drop > 3) score += 2;
      if (mx > 60) score += 1.5;                        // 초기 100 % 근처
      if (mn >= -2 && mn <= 105) score += 1;
      score += Math.min(1, Math.abs(drop) / 20);
      if (score > bestW) { bestW = score; wtCol = c; }
    }
    if (wtCol < 0) return { ok: false, reason: '중량(%) 열을 찾지 못했습니다' };

    // 보조 열(3열 이상이면 DTG 또는 시간) — 요철이 가장 큰 열
    let auxCol = -1, bestR = -1;
    for (let c = 0; c < width; c++) {
      if (c === tempCol || c === wtCol) continue;
      const rg = roughness(numRows.map((r) => r[c]));
      if (rg > bestR) { bestR = rg; auxCol = c; }
    }

    if (O.tempCol !== undefined && O.tempCol !== null) tempCol = O.tempCol | 0;
    if (O.wtCol !== undefined && O.wtCol !== null) wtCol = O.wtCol | 0;

    const x = numRows.map((r) => r[tempCol]);
    const y = numRows.map((r) => r[wtCol]);
    // 온도 오름차순 정렬
    const idx = x.map((v, i) => i).sort((a, b) => x[a] - x[b]);
    const xs = idx.map((i) => x[i]), ys = idx.map((i) => y[i]);
    if (stdev(xs.slice(1).map((v, i) => v - xs[i])) < 0) warnings.push('온도축이 단조 증가가 아닙니다');

    const unit = (String(header || '').toLowerCase().indexOf('mg') >= 0) ? 'mg' : '%';
    return {
      ok: true, name: name || 'TGA', x: xs, y: ys, cols: width, tempCol, wtCol, auxCol,
      delim: delim || '공백', header: header || '', unit, warnings
    };
  }

  /* --------------------------------------------------------- 분석 */
  function normalize(y) {
    const k = Math.max(3, Math.round(y.length * 0.02));
    const w0 = mean(y.slice(0, k));
    const base = isFinite(w0) && Math.abs(w0) > 1e-6 ? w0 : 1;
    return y.map((v) => (v / base) * 100);
  }

  /* 규정 감소율에 도달하는 온도 (선형 보간) */
  function tAtLoss(x, w, pct) {
    const target = 100 - pct;
    for (let i = 1; i < w.length; i++) {
      if (w[i] <= target && w[i - 1] > target) {
        const d = (w[i - 1] - w[i]) || 1;
        return x[i - 1] + (w[i - 1] - target) / d * (x[i] - x[i - 1]);
      }
    }
    return (w[0] <= target) ? x[0] : null;
  }

  /* 잔량 — 마지막 2 % 구간 평균 */
  function residue(x, w) {
    const k = Math.max(3, Math.round(w.length * 0.02));
    return mean(w.slice(w.length - k));
  }

  function derivate(x, w) {
    const n = w.length;
    const d = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      d[i] = (w[b] - w[a]) / ((x[b] - x[a]) || 1);
    }
    return d;
  }

  /* DTG 최대점(가장 빠른 감소) — 온도 */
  function dtgPeak(x, w) {
    const d = smooth(derivate(x, w), 9);
    let i = 0, mn = Infinity;
    for (let k = 0; k < d.length; k++) if (d[k] < mn) { mn = d[k]; i = k; }
    if (!isFinite(mn) || mn >= 0) return null;
    return { t: x[i], rate: mn };
  }

  /* 외삽 분해개시온도 — 최대 기울기 구간의 접선과 초기 수평선의 교점 */
  function onsetExtrap(x, w) {
    const d = smooth(derivate(x, w), 9);
    const n = d.length;
    let mi = 0, mn = Infinity;
    for (let i = 0; i < n; i++) if (d[i] < mn) { mn = d[i]; mi = i; }
    if (!isFinite(mn) || mn >= -1e-6) return null;
    const thr = mn * 0.3;                        // 최대 기울기의 30 % 이상인 구간
    let a = mi, b = mi;
    while (a > 0 && d[a - 1] < thr) a--;
    while (b < n - 1 && d[b + 1] < thr) b++;
    if (b - a < 2) { a = Math.max(0, mi - 2); b = Math.min(n - 1, mi + 2); }
    // 그 구간에 직선 적합
    let sx = 0, sy = 0, sxx = 0, sxy = 0, c = 0;
    for (let i = a; i <= b; i++) { sx += x[i]; sy += w[i]; sxx += x[i] * x[i]; sxy += x[i] * w[i]; c++; }
    const den = c * sxx - sx * sx;
    if (!c || Math.abs(den) < 1e-9) return null;
    const slope = (c * sxy - sx * sy) / den;
    const inter = (sy - slope * sx) / c;
    const k = Math.max(3, Math.round(w.length * 0.01));
    const level = mean(w.slice(0, k));           // 초기 수평선
    const t = (level - inter) / (slope || 1);
    if (!isFinite(t) || t < x[0] || t > x[x.length - 1]) return null;
    return { t: t, slope: slope, level: level, x0: x[a], x1: x[b] };
  }

  /* 중량 감소 단계 — 평탄 구간(plateau) 사이의 손실 */
  function steps(x, w, opt) {
    const O = Object.assign({ thr: 0.06, minRun: 4 }, opt || {});
    const d = smooth(derivate(x, w), 9);
    const n = d.length;
    let maxAbs = 0;
    for (const v of d) maxAbs = Math.max(maxAbs, Math.abs(v));
    const thr = Math.max(O.thr, maxAbs * 0.12);
    const flat = d.map((v) => Math.abs(v) < thr);
    const runs = [];
    let i = 0;
    while (i < n) {
      if (!flat[i]) { i++; continue; }
      let j = i;
      while (j < n - 1 && flat[j + 1]) j++;
      if (j - i + 1 >= O.minRun) runs.push({ a: i, b: j });
      i = j + 1;
    }
    // 연속 구간 중 인접한 것은 병합
    const merged = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && x[r.a] - x[last.b] < (x[n - 1] - x[0]) * 0.02) last.b = r.b;
      else merged.push({ a: r.a, b: r.b });
    }
    const out = [];
    for (let k = 1; k < merged.length; k++) {
      const p0 = stripped(merged[k - 1], x, w), p1 = stripped(merged[k], x, w);
      const loss = p0 - p1;
      if (loss < 0.5) continue;
      out.push({
        t0: x[merged[k - 1].b], t1: x[merged[k].a],
        from: p0, to: p1, loss: loss
      });
    }
    return out;

    function stripped(r, xs, ws) {
      let s = 0, c = 0;
      for (let i = r.a; i <= r.b; i++) { s += ws[i]; c++; }
      return c ? s / c : NaN;
    }
  }

  function analyze(x, w, opt) {
    const O = Object.assign({ smoothWin: 5 }, opt || {});
    const ww = smooth(normalize(w), O.smoothWin | 0 || 1);
    const res = residue(x, ww);
    const dd = dtgPeak(x, ww);
    const on = onsetExtrap(x, ww);
    return {
      x: x, w: ww,
      t5: tAtLoss(x, ww, 5),
      t10: tAtLoss(x, ww, 10),
      t50: tAtLoss(x, ww, 50),
      residue: res,
      totalLoss: 100 - res,
      td: on ? on.t : null,
      onsetSlope: on ? on.slope : null,
      tmax: dd ? dd.t : null,
      rateMax: dd ? dd.rate : null,
      steps: steps(x, ww)
    };
  }

  /* --------------------------------------------------------- 데모 */
  function build(steps_, opt) {
    const O = Object.assign({ lo: 30, hi: 800, n: 620, noise: 0.06, seed: 7, hold: 25 }, opt || {});
    let s = O.seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const x = [], y = [];
    for (let i = 0; i < O.n; i++) {
      const T = O.lo + (O.hi - O.lo) * i / (O.n - 1);
      let w = 100;
      for (const st of steps_) w -= st.A / (1 + Math.exp(-(T - st.T) / st.s));
      // 초기 수분 손실(약간) + 잡음
      w -= 0.35 / (1 + Math.exp(-(T - O.lo - 12) / 6));
      w += (rnd() - 0.5) * O.noise;
      x.push(T); y.push(Math.max(-1, w));
    }
    return { x: x, y: y };
  }

  function synthDemo() {
    const out = [];
    const push = (name, spec, meta) => out.push(Object.assign({ name: name, data: build(spec) }, meta || {}));

    // PA6-GF30: 주분해 420–500 (수지 68 %), 잔량 ≈ 30 % (유리섬유)
    push('PA6-GF30 신품 (합성)', [
      { A: 67, T: 455, s: 14 }, { A: 2.5, T: 640, s: 18 }
    ], { note: '잔량 ≈ 30.5 %' });

    // 열노화: 개시가 앞당겨지고 저분자 성분이 먼저 날아감 (T5 하강)
    push('PA6-GF30 열노화 168h (합성)', [
      { A: 4.5, T: 330, s: 22 }, { A: 64, T: 443, s: 16 }, { A: 2.5, T: 640, s: 18 }
    ], { note: 'T5 하강' });

    // PA6 neat: 단일 분해, 잔량 ≈ 1.5 %
    push('PA6 순수 (합성)', [
      { A: 96, T: 440, s: 13 }, { A: 2, T: 620, s: 16 }
    ], { note: '잔량 ≈ 2 %' });

    // PBT: 잔량 ≈ 1.5 %
    push('PBT (합성)', [
      { A: 62, T: 395, s: 11 }, { A: 36, T: 445, s: 12 }
    ], { note: '2단 분해' });

    // PPS-GF40: 고온 분해, 잔량 ≈ 42 %
    push('PPS-GF40 (합성)', [
      { A: 55, T: 545, s: 12 }, { A: 3, T: 690, s: 20 }
    ], { note: '잔량 ≈ 42 %' });

    // 에폭시 경화체: 잔량 ≈ 9 %
    push('에폭시 경화체 (합성)', [
      { A: 55, T: 370, s: 16 }, { A: 34, T: 520, s: 20 }
    ], { note: '2단 분해, 잔량 ≈ 9 %' });

    return out;
  }

  window.TGAC = {
    parseText, smooth, mean, stdev, mode, normalize, tAtLoss, residue, derivate,
    dtgPeak, onsetExtrap, steps, analyze, synthDemo, clamp
  };
})();

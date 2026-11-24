/* =========================================================================
 * app-core.js — 파싱 · 전처리 · 피크 · 지수 · 정성판정 · 라이브러리
 * 의존성 없음(순수 JS). window.FTIRC 로 노출.
 * ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- utils */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const median = (arr) => { const s = arr.slice().sort((a, b) => a - b); return s[s.length >> 1]; };

  function interpAt(x, y, xi) {            // x: 오름차순
    if (!x.length) return NaN;
    if (xi <= x[0]) return y[0];
    if (xi >= x[x.length - 1]) return y[y.length - 1];
    let lo = 0, hi = x.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= xi) lo = mid; else hi = mid;
    }
    const dx = x[hi] - x[lo];
    if (dx === 0) return y[lo];
    const t = (xi - x[lo]) / dx;
    return y[lo] + t * (y[hi] - y[lo]);
  }

  function areaTrap(x, y, lo, hi) {        // lo<hi 가정, 범위 내 적분
    let s = 0;
    for (let i = 0; i < x.length - 1; i++) {
      const x0 = x[i], x1 = x[i + 1];
      if (x1 < lo || x0 > hi) continue;
      const a = Math.max(x0, lo), b = Math.min(x1, hi);
      if (b <= a) continue;
      const t0 = (a - x0) / (x1 - x0), t1 = (b - x0) / (x1 - x0);
      const y0 = y[i] + t0 * (y[i + 1] - y[i]);
      const y1 = y[i] + t1 * (y[i + 1] - y[i]);
      s += 0.5 * (y0 + y1) * (b - a);
    }
    return s;
  }

  /* 선형 베이스라인 위 밴드 면적 (앵커 두 점 사이 직선) */
  function bandArea(x, y, lo, hi, b1, b2) {
    const lo1 = Math.min(b1, b2), hi1 = Math.max(b1, b2);
    const y1 = interpAt(x, y, lo1), y2 = interpAt(x, y, hi1);
    const slope = (y2 - y1) / (hi1 - lo1 || 1);
    const base = (xi) => y1 + slope * (xi - lo1);
    let s = 0;
    for (let i = 0; i < x.length - 1; i++) {
      const x0 = x[i], x1 = x[i + 1];
      if (x1 < lo || x0 > hi) continue;
      const a = Math.max(x0, lo), b = Math.min(x1, hi);
      if (b <= a) continue;
      const f = (xi) => interpAt(x, y, xi) - base(xi);
      s += 0.5 * (f(a) + f(b)) * (b - a);
    }
    return s;
  }

  /* --- Savitzky–Golay --- */
  function sgCoeffs(win, order) {
    if (win % 2 === 0) win += 1;
    const half = (win - 1) / 2;
    const A = [], b = [];
    for (let i = 0; i < win; i++) { A.push([]); b.push(0); }
    for (let i = 0; i < win; i++) {
      const xx = i - half;
      for (let j = 0; j < order + 1; j++) {
        for (let k = 0; k < order + 1; k++) A[j][k] = (A[j][k] || 0) + Math.pow(xx, j + k);
        b[j] = (b[j] || 0) + Math.pow(xx, j);
      }
    }
    // 가우스 소거 (order+1 x order+1)
    const n = order + 1, M = [];
    for (let i = 0; i < n; i++) { M.push(A[i].slice(0, n).concat([b[i]])); }
    for (let c = 0; c < n; c++) {
      let p = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const piv = M[c][c] || 1e-12;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / piv;
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const c0 = M.map((row, i) => row[n] / (M[i][i] || 1e-12));  // 0차 계수 = 스무딩 커널
    return c0;
  }
  function sgSmooth(y, win, order) {
    if (win < 3 || y.length < win) return y.slice();
    const k = sgCoeffs(win, Math.min(order, 5));
    const half = (k.length - 1) / 2;
    const out = y.slice();
    for (let i = half; i < y.length - half; i++) {
      let s = 0;
      for (let j = 0; j < k.length; j++) s += k[j] * y[i - half + j];
      out[i] = s;
    }
    return out;
  }

  /* --- 다항식 베이스라인 --- */
  function polyFit(x, y, deg) {
    const n = deg + 1, A = [], b = new Array(n).fill(0);
    for (let i = 0; i < n; i++) A.push(new Array(n).fill(0));
    for (let p = 0; p < x.length; p++) {
      const xp = [1];
      for (let j = 1; j < 2 * n; j++) xp.push(xp[j - 1] * x[p]);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) A[i][j] += xp[i + j];
        b[i] += xp[i] * y[p];
      }
    }
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      if (Math.abs(A[c][c]) < 1e-14) continue;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = A[r][c] / A[c][c];
        for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    return b.map((v, i) => (Math.abs(A[i][i]) < 1e-14 ? 0 : v / A[i][i]));
  }
  const polyVal = (c, x) => c.reduce((s, v, i) => s + v * Math.pow(x, i), 0);

  /* --- 러버밴드(볼록 껍질 아래 포락선) --- */
  function rubberband(x, y) {
    const n = x.length;
    if (n < 3) return new Array(n).fill(0);
    // 흡광도 기준: 아래쪽 볼록 껍질 = 최소 포락선
    const hull = [];
    for (let i = 0; i < n; i++) {
      while (hull.length >= 2) {
        const a = hull[hull.length - 2], b = hull[hull.length - 1];
        const cross = (x[b] - x[a]) * (y[i] - y[a]) - (y[b] - y[a]) * (x[i] - x[a]);
        if (cross <= 0) hull.pop(); else break;
      }
      hull.push(i);
    }
    const base = new Array(n).fill(0);
    let h = 0;
    for (let i = 0; i < n; i++) {
      while (h < hull.length - 1 && x[hull[h + 1]] < x[i]) h++;
      if (h >= hull.length - 1) { base[i] = y[hull[hull.length - 1]]; continue; }
      const a = hull[h], b = hull[h + 1];
      const t = (x[i] - x[a]) / ((x[b] - x[a]) || 1);
      base[i] = y[a] + t * (y[b] - y[a]);
    }
    return base;
  }

  /* ------------------------------------------------------------- parsing */
  function splitNums(line) {
    const parts = line.trim().split(/[\s,;]+/).filter((s) => s.length);
    const nums = [];
    for (const p of parts) {
      const v = Number(p.replace(/^\+/, ''));
      if (!isFinite(v)) { if (nums.length >= 2) break; return []; }
      nums.push(v);
    }
    return nums;
  }

  function parseText(text, name) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const warnings = [];
    let headerHasTrans = false, headerHasAbs = false, headerLines = 0;
    const rows = [];
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      if (/^[#;%]|^[A-Za-z]/.test(line)) {
        headerLines++;
        if (/%\s*T|transmission|투과율/i.test(line)) headerHasTrans = true;
        if (/absorbance|흡광도/i.test(line)) headerHasAbs = true;
        continue;
      }
      const nums = splitNums(line);
      if (nums.length >= 2) rows.push(nums);
    }
    if (!rows.length) return { error: '숫자 2열을 찾지 못했습니다. OPUS에서 ASCII(.dpt/.txt)로 내보낸 파일인지 확인하세요.' };

    const maxCols = Math.max(...rows.map((r) => r.length));
    let ci = 0, yi = 1;
    if (maxCols >= 3) {
      // 첫 열이 1,2,3… 순번이면 건너뛴다
      let seq = true;
      for (let i = 0; i < Math.min(rows.length, 50); i++) {
        if (Math.abs(rows[i][0] - (i + 1)) > 1e-6) { seq = false; break; }
      }
      if (seq) { ci = 1; yi = 2; warnings.push('3열 형식: 1열(순번) 무시, 2–3열 사용'); }
    }

    const pts = [];
    let skipped = 0;
    for (const r of rows) {
      const x = r[ci], y = r[yi];
      if (!isFinite(x) || !isFinite(y)) { skipped++; continue; }
      pts.push([x, y]);
    }
    if (skipped) warnings.push(`${skipped}행 무시(비수치)`);
    if (pts.length < 10) return { error: '데이터 점이 너무 적습니다(' + pts.length + '점).' };

    pts.sort((a, b) => a[0] - b[0]);
    const xs = [], ys = [];
    for (const p of pts) {
      if (xs.length && Math.abs(p[0] - xs[xs.length - 1]) < 1e-9) { ys[ys.length - 1] = p[1]; continue; }
      xs.push(p[0]); ys.push(p[1]);
    }

    const yMed = median(ys), yMax = Math.max(...ys), yMin = Math.min(...ys);
    let unit = 'abs';
    if (headerHasTrans) unit = 'trans';
    else if (headerHasAbs) unit = 'abs';
    else if (yMax > 1.6 || (yMin > 0.5 && yMax <= 110 && yMax - yMin > 3)) unit = 'trans';
    if (unit === 'trans') warnings.push('투과율(%T)로 판단 → 흡광도로 변환합니다');

    const xRangeOk = xs[0] > 100 && xs[xs.length - 1] < 5000;
    if (!xRangeOk) warnings.push(`X 범위 확인 필요: ${xs[0]}–${xs[xs.length - 1]}`);

    return { name: name || 'spectrum', x: xs, y: ys, unit, warnings, headerLines, n: xs.length };
  }

  /* ------------------------------------------------------------ spectrum */
  function spectrumFromParsed(p) {
    let y = p.y.slice();
    if (p.unit === 'trans') y = y.map((v) => -Math.log10(clamp(v / 100, 1e-6, 1.5)));
    // 흡광도 페데스탈(음수 오프셋) 제거는 하지 않는다 — 사용자가 베이스라인으로 처리
    const x = p.x;
    // ATR 보정 후 음수가 될 수 있으므로 최소값 유지
    return { x, y };
  }

  function atrCorrect(x, y, n1, n2) {
    // 단순 ATR 보정: 침투깊이 ∝ 1/ν → A_corr = A · ν/1000
    return y.map((v, i) => v * (x[i] / 1000));
  }

  function applyPipeline(spec, pre) {
    let x = spec.x, y = spec.y.slice();
    if (pre.atr && pre.atr.on) y = atrCorrect(x, y, pre.atr.n1 || 2.40, pre.atr.n2 || 1.52);
    if (pre.smooth && pre.smooth.on) y = sgSmooth(y, pre.smooth.win | 0 || 9, pre.smooth.order | 0);
    const bm = pre.baseline ? pre.baseline.mode : 'none';
    if (bm === 'linear') {
      const p1 = pre.baseline.p1, p2 = pre.baseline.p2;
      const y1 = interpAt(x, y, p1), y2 = interpAt(x, y, p2);
      const sl = (y2 - y1) / ((p2 - p1) || 1);
      y = y.map((v, i) => v - (y1 + sl * (x[i] - p1)));
    } else if (bm === 'poly') {
      const c = polyFit(x, y, pre.baseline.deg | 0 || 3);
      y = y.map((v, i) => v - polyVal(c, x[i]));
    } else if (bm === 'rubber') {
      const base = rubberband(x, y);
      y = y.map((v, i) => v - base[i]);
    }
    const nm = pre.norm || 'none';
    if (nm !== 'none') {
      let ref = 1;
      if (nm === 'max') ref = Math.max(...y.map(Math.abs)) || 1;
      else if (nm === 'minmax') {
        const mn = Math.min(...y), mx = Math.max(...y);
        ref = (mx - mn) || 1;
        y = y.map((v) => (v - mn) / ref); ref = 1;
      } else if (nm === 'vector') {
        ref = Math.sqrt(y.reduce((s, v) => s + v * v, 0)) || 1;
      } else if (nm === 'band') {
        const b = pre.normBand || [1440, 1480];
        ref = Math.abs(bandArea(x, y, Math.min(...b), Math.max(...b), Math.min(...b), Math.max(...b))) || 1;
      }
      if (nm !== 'minmax') y = y.map((v) => v / ref);
    }
    return { x, y };
  }

  /* --------------------------------------------------------------- peaks */
  function findPeaks(x, y, opts) {
    const o = Object.assign({ minProm: 0.02, minSep: 6, maxPeaks: 300 }, opts || {});
    const n = y.length;
    if (n < 5) return [];
    const ymin = Math.min(...y), ymax = Math.max(...y);
    const span = (ymax - ymin) || 1;
    const prom = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      if (!(y[i] > y[i - 1] && y[i] >= y[i + 1])) continue;
      let l = i, r = i;
      while (l > 0 && y[l - 1] <= y[i]) l--;
      while (r < n - 1 && y[r + 1] <= y[i]) r++;
      let minL = y[i], minR = y[i];
      for (let k = l; k < i; k++) minL = Math.min(minL, y[k]);
      for (let k = i + 1; k <= r; k++) minR = Math.min(minR, y[k]);
      prom[i] = y[i] - Math.max(minL, minR);
    }
    const cand = [];
    for (let i = 1; i < n - 1; i++) {
      if (prom[i] <= 0) continue;
      if (prom[i] / span < o.minProm) continue;
      // 포물선 보간으로 x 정밀화
      const y0 = y[i - 1], y1 = y[i], y2 = y[i + 1];
      const den = (y0 - 2 * y1 + y2);
      const d = den !== 0 ? 0.5 * (y0 - y2) / den : 0;
      const xp = x[i] + d * (x[i + 1] - x[i]);
      const yp = y1 - 0.25 * (y0 - y2) * d;
      cand.push({ x: xp, y: yp, prom: prom[i], i });
    }
    cand.sort((a, b) => b.prom - a.prom);
    const kept = [];
    for (const c of cand) {
      if (kept.length >= o.maxPeaks) break;
      if (kept.some((k) => Math.abs(k.x - c.x) < o.minSep)) continue;
      kept.push(c);
    }
    kept.sort((a, b) => b.x - a.x);
    return kept;
  }

  /* ------------------------------------------------------------ indices */
  function prepForIndex(spec, atrOn) {
    let x = spec.x, y = spec.y.slice();
    if (atrOn) y = atrCorrect(x, y, 2.40, 1.52);
    return { x, y };
  }

  function calcIndex(spec, preset, opts) {
    const o = opts || {};
    const atrOn = o.atr !== undefined ? o.atr : !!preset.atr;
    const s = prepForIndex(spec, atrOn);
    const sRaw = prepForIndex(spec, false);
    if (preset.type === 'point') {
      const a = interpAt(s.x, s.y, preset.a), b = interpAt(s.x, s.y, preset.b);
      return { value: b ? a / b : NaN, num: a, den: b, atr: atrOn, unit: preset.unit };
    }
    const nLo = Math.min(...preset.num), nHi = Math.max(...preset.num);
    const dLo = Math.min(...preset.den), dHi = Math.max(...preset.den);
    const num = bandArea(s.x, s.y, nLo, nHi, preset.numBase[0], preset.numBase[1]);
    const den = bandArea(s.x, s.y, dLo, dHi, preset.denBase[0], preset.denBase[1]);
    const numR = bandArea(sRaw.x, sRaw.y, nLo, nHi, preset.numBase[0], preset.numBase[1]);
    const denR = bandArea(sRaw.x, sRaw.y, dLo, dHi, preset.denBase[0], preset.denBase[1]);
    return {
      value: den ? num / den : NaN, valueRaw: denR ? numR / denR : NaN,
      num, den, numRaw: numR, denRaw: denR, atr: atrOn, unit: preset.unit,
      numZero: !(num > 0), denWeak: !(Math.abs(den) > 1e-9)
    };
  }

  /* --------------------------------------------------------- identification */
  function bestPeakInRange(x, y, lo, hi) {
    let bi = -1, bv = -Infinity;
    for (let i = 0; i < x.length; i++) {
      if (x[i] < lo || x[i] > hi) continue;
      if (y[i] > bv) { bv = y[i]; bi = i; }
    }
    if (bi < 0) return null;
    // 국소 최대 여부 확인(양옆보다 높거나 같음)
    const isMax = (bi === 0 || y[bi] >= y[bi - 1]) && (bi === y.length - 1 || y[bi] >= y[bi + 1]);
    return { x: x[bi], y: y[bi], isMax, idx: bi };
  }

  function scoreMaterials(spec, peaks, bandsLib) {
    const mats = bandsLib.materials.filter((m) => !['무기충전제', '첨가제', '열화'].includes(m.cls) && m.markers.length);
    const ymin = Math.min(...spec.y), ymax = Math.max(...spec.y);
    const span = (ymax - ymin) || 1;
    // 검출 피크를 기준으로 마커 매칭(전역 ymin 비교는 기울기·페데스탈에 오염됨)
    const cand = (peaks && peaks.length ? peaks : findPeaks(spec.x, spec.y, { minProm: 0.008, minSep: 4 }))
      .filter((p) => p.prom / span >= 0.008);
    const major = (peaks && peaks.length ? peaks.slice() : cand.slice())
      .sort((a, b) => b.prom - a.prom).slice(0, 12);
    const out = [];
    for (const m of mats) {
      let got = 0, tot = 0, distSum = 0, distN = 0;
      const detail = [];
      for (const mk of m.markers) {
        const [lo, hi] = mk.r;
        const hits = cand.filter((p) => p.x >= lo - 4 && p.x <= hi + 4);
        const best = hits.sort((a, b) => b.prom - a.prom)[0];
        const found = !!best;
        if (found) {
          const px = best.x;
          const d = px < lo ? lo - px : (px > hi ? px - hi : Math.abs(px - (lo + hi) / 2));
          distSum += d; distN++;
        }
        detail.push({ r: mk.r, t: mk.t, w: mk.w, found, x: best ? best.x : null, prom: best ? best.prom : 0 });
        tot += mk.w;
        if (found) got += mk.w;
      }
      const scoreBand = tot ? got / tot : 0;
      // 설명률: 스펙트럼 주요 피크 중 후보 밴드로 설명되는 비율(특이성 확보)
      let explained = 0;
      for (const pk of major) {
        if (m.markers.some((mk) => pk.x >= mk.r[0] - 6 && pk.x <= mk.r[1] + 6)) explained++;
      }
      const explain = major.length ? explained / major.length : 0;
      const score = 0.65 * scoreBand + 0.35 * explain;
      out.push({ id: m.id, ko: m.ko, en: m.en, cls: m.cls, score, scoreBand, explain, got, tot,
        meanDist: distN ? distSum / distN : 99, detail, note: m.note });
    }
    out.sort((a, b) => b.score - a.score || a.meanDist - b.meanDist);
    return out;
  }

  function assignBand(wn, tol) {
    const t = tol === undefined ? 6 : tol;
    const hits = [];
    for (const m of window.FTIR_BANDS.materials) {
      for (const mk of m.markers) {
        const [lo, hi] = mk.r;
        if (wn >= lo - t && wn <= hi + t) {
          const d = wn < lo ? lo - wn : (wn > hi ? wn - hi : 0);
          hits.push({ id: m.id, ko: m.ko, cls: m.cls, label: mk.t, w: mk.w, dist: d });
        }
      }
    }
    hits.sort((a, b) => b.w - a.w || a.dist - b.dist);
    return hits.slice(0, 3);
  }

  /* ------------------------------------------------------------ library */
  const LIB_KEY = 'ftir.library.v1';
  function loadLibrary() {
    try {
      const s = localStorage.getItem(LIB_KEY);
      return s ? JSON.parse(s) : [];
    } catch (e) { return []; }
  }
  function saveLibrary(lib) {
    try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); return true; }
    catch (e) { return false; }
  }

  function resample(x, y, step, lo, hi) {
    const g = [];
    for (let v = hi; v >= lo; v -= step) g.push(v);
    return { x: g, y: g.map((v) => interpAt(x, y, v)) };
  }

  function pearson(a, b) {
    const n = Math.min(a.length, b.length);
    let ma = 0, mb = 0;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sa = 0, sb = 0, sab = 0;
    for (let i = 0; i < n; i++) {
      const da = a[i] - ma, db = b[i] - mb;
      sa += da * da; sb += db * db; sab += da * db;
    }
    return sab / (Math.sqrt(sa * sb) || 1);
  }

  /* 라이브러리 대조: 원 스펙트럼 상관 + 1차 미분 상관 */
  function compareToRef(spec, ref) {
    const A = resample(spec.x, spec.y, 4, 400, 4000);
    const B = resample(ref.x, ref.y, 4, 400, 4000);
    const r = pearson(A.y, B.y);
    const dA = [], dB = [];
    for (let i = 1; i < A.y.length; i++) { dA.push(A.y[i] - A.y[i - 1]); dB.push(B.y[i] - B.y[i - 1]); }
    const r2 = pearson(dA, dB);
    return { r, r2, score: Math.round(1000 * (r * 0.6 + r2 * 0.4)) };
  }

  window.FTIRC = {
    interpAt, areaTrap, bandArea, sgSmooth, sgCoeffs, polyFit, polyVal, rubberband,
    parseText, spectrumFromParsed, applyPipeline, atrCorrect,
    findPeaks, calcIndex, scoreMaterials, assignBand, bestPeakInRange,
    loadLibrary, saveLibrary, compareToRef, resample, pearson, median
  };
})();

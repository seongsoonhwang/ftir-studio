/* =========================================================================
 * dsc-core.js — DSC(시차주사열량계) 데이터 파싱·분석 엔진 (의존성 없음)
 *
 * 지원: ASCII 텍스트(.txt/.csv/.tsv/.dpt) 2~5열. 온도·열유량 열 자동 인식.
 * 분석: 피크(융해·결정화·경화) 구간 적분 → ΔH, onset/peak/endset(외삽),
 *       유리전이(Tg) 스텝 → onset/mid/end + ΔCp, 결정화도, 경화도.
 *
 * 규약
 *  - 내부 계산은 온도 오름차순 x, 열유량 y 를 쓴다(입력이 내림차순이면 뒤집고 dir 로 기록).
 *  - ΔH[J/g] = ∫(mW/mg)dT / (β/60)  … β 는 °C/min. 절대단위(mW)면 시료질량으로 나눠 환산.
 *  - 흡열/발열 부호는 계측기마다 달라 자동 판정(구간 내 최대 편차 방향)한다.
 * ========================================================================= */
(function () {
  'use strict';

  const NUMRE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

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

    // 소수점 쉼표(유럽식) 판정 — 구분자가 쉼표가 아닐 때만
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
    const headerLines = [];
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
      else headerLines.push(line);
      if (rows.length >= 200000) { warnings.push('행이 너무 많아 20만 행에서 자릅니다'); break; }
    }
    if (rows.length < 5) {
      return { ok: false, reason: '숫자 2열 이상인 데이터 행을 찾지 못했습니다 (DSC ASCII 2~5열을 기대)' };
    }

    // 열 수 통일(최빈값)
    const width = mode(rows.map((r) => r.length));
    const numRows = rows.filter((r) => r.length >= width).map((r) => r.slice(0, width));

    // 온도 열 찾기: 범위가 온도답고(-250~1200) 단조성이 높은 열
    let tempCol = 0, bestScore = -1;
    for (let c = 0; c < width; c++) {
      const col = numRows.map((r) => r[c]);
      const mn = Math.min.apply(null, col), mx = Math.max.apply(null, col);
      const range = mx - mn;
      if (range < 1 || mn < -300 || mx > 1500) continue;
      let mono = 0;
      for (let i = 1; i < col.length; i++) if ((col[i] - col[i - 1]) * (col[1] - col[0]) >= 0) mono++;
      let score = (mono / (col.length - 1)) * 2 + Math.min(1, range / 200);
      // 0 에서 시작하는 열은 시간축일 가능성이 높다 → 감점 (온도 스캔은 대개 20~25 °C 시작)
      if (mn >= -0.6 && mn <= 0.6) score -= 1.2;
      if (mx > 900) score -= 1.0;
      if (score > bestScore) { bestScore = score; tempCol = c; }
    }

    // 열유량 열: 시간·온도축은 매끄러운 직선(2차차분≈0), 열유량은 요철이 있다 → 요철도 최대 열
    let hfCol = -1, bestRough = -1;
    for (let c = 0; c < width; c++) {
      if (c === tempCol) continue;
      const col = numRows.map((r) => r[c]);
      const rg = roughness(col);
      if (rg > bestRough) { bestRough = rg; hfCol = c; }
    }
    if (hfCol < 0) return { ok: false, reason: '열유량 열을 찾지 못했습니다' };

    // 컬럼 이름표가 있으면(##Temp./°C;Time/min;DSC/(mW/mg);Sensit./(uV/mW)) 이름으로 먼저 배정한다.
    //  요철도만 보면 감도(Sensitivity) 열이나 시간 열이 열유량으로 뽑히는 경우가 있어,
    //  계측기가 남긴 열 이름을 우선한다.
    let nameMap = null;
    for (let k = headerLines.length - 1; k >= 0 && !nameMap; k--) {
      const hl = headerLines[k];
      if (!/temp|dsc|heat|sens|zeit|time/i.test(hl)) continue;
      const body = hl.replace(/^#+\s*/, '');
      const toks = delim ? body.split(delim) : body.trim().split(/\s+/);
      if (toks.length < 2 || toks.length > width + 1) continue;
      const map = { temp: -1, hf: -1 };
      toks.forEach((t, i) => {
        const s = t.trim().toLowerCase();
        if (map.temp < 0 && /temp/.test(s)) map.temp = i;
        if (map.hf < 0 && /(dsc|heat)/.test(s) && !/sens/.test(s)) map.hf = i;
      });
      if (map.temp >= 0 && map.hf >= 0 && map.temp < width && map.hf < width && map.temp !== map.hf) nameMap = map;
    }
    if (nameMap) { tempCol = nameMap.temp; hfCol = nameMap.hf; }

    // 사용자가 지정한 열(오검출 교정)
    if (Number.isInteger(O.tempCol) && O.tempCol >= 0 && O.tempCol < width) tempCol = O.tempCol;
    if (Number.isInteger(O.hfCol) && O.hfCol >= 0 && O.hfCol < width && O.hfCol !== tempCol) hfCol = O.hfCol;

    let xs = numRows.map((r) => r[tempCol]);
    let ys = numRows.map((r) => r[hfCol]);
    const dir = (xs[xs.length - 1] >= xs[0]) ? 'heat' : 'cool';

    // 온도 오름차순 정렬
    const order = xs.map((v, i) => i).sort((a, b) => xs[a] - xs[b]);
    const x = order.map((i) => xs[i]);
    const y = order.map((i) => ys[i]);

    // 단위 추정
    const head = headerLines.join(' ');
    let unit = '';
    if (/mW\s*\/\s*mg/i.test(head)) unit = 'mW/mg';
    else if (/W\s*\/\s*g\b/i.test(head)) unit = 'W/g';
    else if (/µW|uW|μW/.test(head)) unit = 'uW';
    else if (/mW/.test(head)) unit = 'mW';
    else if (/µV|uV|μV/.test(head)) unit = 'uV';
    else if (/mV/.test(head)) unit = 'mV';
    else { unit = 'mW'; warnings.push('열유량 단위를 헤더에서 찾지 못해 mW 로 가정했습니다 — 분석 설정에서 확인하세요'); }

    if (dir === 'cool') warnings.push('온도가 내림차순인 파일입니다(냉각 곡선 가능) — 내부에서 오름차순으로 정렬해 계산했습니다');

    /* --- 계측기 헤더 메타 (Netzsch Proteus .ngb-sdf, TA 등) ---
       #SAMPLE MASS /mg:6.66  #EXO:-1  #SEG. 2:50°C/20.0(K/min)/350°C  #RANGE:50°C...350°C/-20.0...20.0K/min */
    const mtext = headerLines.join('\n');
    const pick = (re) => { const m = mtext.match(re); return m ? parseFloat(String(m[1]).replace(',', '.')) : null; };
    const mass = pick(/#\s*SAMPLE\s*MASS\s*\/\s*mg\s*:\s*([-\d.,]+)/i);
    const exoRaw = mtext.match(/#\s*EXO\s*:\s*(-?1)/i);
    const betaSeg = pick(/#\s*SEG\.?\s*\d+\s*:[^\n]*?([-\d.,]+)\s*\(\s*K\s*\/\s*min\s*\)/i)
                  || pick(/#\s*RANGE\s*:[^\n]*?([-\d.,]+)\s*\(?\s*K\s*\/\s*min/i);
    const inst = (mtext.match(/#\s*INSTRUMENT\s*:\s*([^\n]*)/i) || [])[1] || '';
    const sampleId = (mtext.match(/#\s*SAMPLE\s*:\s*([^\n]*)/i) || [])[1] || '';
    const meta2 = { mass: mass, exo: exoRaw ? parseInt(exoRaw[1], 10) : null, beta: betaSeg,
                    instrument: inst.trim(), sampleId: sampleId.trim() };
    if (mass) warnings.push('헤더의 시료 질량 ' + mass + ' mg 을 분석 설정에 적용했습니다');

    return {
      ok: true, x: x, y: y, unit: unit, dir: dir, warnings: warnings,
      meta: { rows: x.length, cols: width, tempCol: tempCol, hfCol: hfCol,
              delim: delim || '공백', decComma: decComma,
              mass: meta2.mass, exo: meta2.exo, beta: meta2.beta,
              instrument: meta2.instrument, sampleId: meta2.sampleId }
    };
  }

  /* -------------------------------------------------------- 작은 도구들 */
  function mode(arr) {
    const m = new Map();
    for (const v of arr) m.set(v, (m.get(v) || 0) + 1);
    let bv = arr[0], bc = 0;
    for (const [k, c] of m) if (c > bc) { bc = c; bv = k; }
    return bv;
  }
  function stdev(a) {
    const n = a.length; if (n < 2) return 0;
    let s = 0, s2 = 0;
    for (const v of a) { s += v; s2 += v * v; }
    return Math.sqrt(Math.max(0, s2 / n - (s / n) * (s / n)));
  }
  function mean(a) { let s = 0; for (const v of a) s += v; return a.length ? s / a.length : 0; }
  /* 요철도: |2차차분| 평균 ÷ 값 범위 — 직선 램프(시간·온도)는 ≈0, 신호는 큼 */
  function roughness(col) {
    const n = col.length;
    if (n < 4) return 0;
    let mn = Infinity, mx = -Infinity;
    for (const v of col) { if (v < mn) mn = v; if (v > mx) mx = v; }
    let s = 0, c = 0;
    for (let i = 2; i < n; i++) { s += Math.abs(col[i] - 2 * col[i - 1] + col[i - 2]); c++; }
    return (s / c) / Math.max(1e-12, mx - mn);
  }

  /* 이동평균 스무딩(짝수 창은 +1) */
  function smooth(y, win) {
    const w = Math.max(1, Math.floor(win || 1) | 1);
    if (w <= 1) return y.slice();
    const h = (w - 1) >> 1, n = y.length, out = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = i - h; k <= i + h; k++) {
        if (k < 0 || k >= n) continue;
        s += y[k]; c++;
      }
      out[i] = s / c;
    }
    return out;
  }

  /* 최소자승 직선 */
  function linfit(xs, ys) {
    const n = xs.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    const den = n * sxx - sx * sx;
    const a = den ? (n * sxy - sx * sy) / den : 0;
    const b = (sy - a * sx) / n;
    return { a: a, b: b, at: (v) => a * v + b };
  }

  /* 선형 보간 */
  function interpAt(x, y, xq) {
    const n = x.length;
    if (!n) return NaN;
    if (xq <= x[0]) return y[0];
    if (xq >= x[n - 1]) return y[n - 1];
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] <= xq) lo = mid; else hi = mid;
    }
    const t = (xq - x[lo]) / ((x[hi] - x[lo]) || 1);
    return y[lo] + (y[hi] - y[lo]) * t;
  }

  /* 구간 인덱스 */
  function rangeIdx(x, x1, x2) {
    const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
    const idx = [];
    for (let i = 0; i < x.length; i++) if (x[i] >= lo && x[i] <= hi) idx.push(i);
    return idx;
  }

  /* 두 직선 교점 x */
  function lineX(m1, b1, m2, b2) {
    if (Math.abs(m1 - m2) < 1e-12) return null;
    return (b2 - b1) / (m1 - m2);
  }

  /* ------------------------------------------------------- 피크 적분 */
  /**
   * @param {object} o {x,y,x1,x2,beta,unit,mass,endofix}
   * endofix: 'auto' | 'up' | 'down'
   */
  function analyzePeak(o) {
    const x = o.x, y = o.y;
    const idx = rangeIdx(x, o.x1, o.x2);
    if (idx.length < 8) return { ok: false, reason: '구간 데이터가 너무 적습니다 (8점 미만)' };

    const i0 = idx[0], i1 = idx[idx.length - 1];
    const nb = Math.max(1, Math.min(8, Math.floor(idx.length * 0.03)));

    // 베이스라인
    //  - o.baseFit 이 주어지면 그 직선을 쓴다(자동 구간: 피크 밖 영역으로 적합한 직선 → 표준 관행)
    //  - 없으면 구간 양끝 근처 평균을 잇는 현(chord)
    let bx0, by0, bx1, by1, mB;
    if (o.baseFit && isFinite(o.baseFit.m)) {
      mB = o.baseFit.m;
      bx0 = x[i0]; by0 = mB * bx0 + o.baseFit.b;
      bx1 = x[i1]; by1 = mB * bx1 + o.baseFit.b;
    } else {
      bx0 = mean(x.slice(i0, i0 + nb)); by0 = mean(y.slice(i0, i0 + nb));
      bx1 = mean(x.slice(i1 - nb + 1, i1 + 1)); by1 = mean(y.slice(i1 - nb + 1, i1 + 1));
      mB = (by1 - by0) / ((bx1 - bx0) || 1);
    }
    const base = (v) => by0 + mB * (v - bx0);

    // 편차 배열 + 극점
    const dev = new Map();
    let kPeak = i0, dMax = 0;
    for (const i of idx) {
      const d = y[i] - base(x[i]);
      dev.set(i, d);
      if (Math.abs(d) > Math.abs(dMax)) { dMax = d; kPeak = i; }
    }
    let sign = dMax >= 0 ? 1 : -1;
    if (o.endofix === 'up') sign = 1;
    if (o.endofix === 'down') sign = -1;

    // 면적(부호 정렬)
    let area = 0;
    for (let k = 1; k < idx.length; k++) {
      const a = idx[k - 1], b = idx[k];
      area += ((dev.get(a) + dev.get(b)) / 2) * (x[b] - x[a]);
    }
    area = Math.abs(area * sign);             // 피크 방향으로 부호 정렬 후 절대값

    // 기울기(중심차분)
    const slope = new Map();
    for (const i of idx) {
      const im = Math.max(0, i - 1), ip = Math.min(x.length - 1, i + 1);
      slope.set(i, (y[ip] - y[im]) / ((x[ip] - x[im]) || 1));
    }

    // 외삽 onset: 상승부 최대기울기 접선 ∩ 베이스라인
    let onset = null, onsetPt = null;
    {
      let best = -Infinity, bi = -1;
      for (const i of idx) {
        if (i >= kPeak) break;
        const s = sign * slope.get(i);
        if (s > best) { best = s; bi = i; }
      }
      if (bi >= 0 && isFinite(best) && best > 0) {
        const s = slope.get(bi), xb = x[bi], yb = y[bi];
        const xc = lineX(s, yb - s * xb, mB, by0 - mB * bx0);
        if (xc !== null && xc > x[i0] - (x[i1] - x[i0]) * 0.3 && xc < x[kPeak]) {
          onset = xc; onsetPt = { x: xc, y: base(xc) };
        }
      }
    }
    // 외삽 endset: 하강부
    let endset = null, endsetPt = null;
    {
      let best = -Infinity, bi = -1;
      for (const i of idx) {
        if (i <= kPeak) continue;
        const s = -sign * slope.get(i);
        if (s > best) { best = s; bi = i; }
      }
      if (bi >= 0 && isFinite(best) && best > 0) {
        const s = slope.get(bi), xb = x[bi], yb = y[bi];
        const xc = lineX(s, yb - s * xb, mB, by0 - mB * bx0);
        if (xc !== null && xc < x[i1] + (x[i1] - x[i0]) * 0.3 && xc > x[kPeak]) {
          endset = xc; endsetPt = { x: xc, y: base(xc) };
        }
      }
    }

    // ΔH 환산
    const conv = unitConv(o.unit, o.mass);
    let dH = null, dHnote = '';
    if (conv.perMass) {
      const beta = Math.max(0.1, +o.beta || 10);
      dH = (area * conv.f * 60) / beta;        // J/g  (conv.f: 입력단위 → mW/mg)
    } else {
      dHnote = '단위가 절대값(' + (o.unit || 'mW') + ')이고 시료 질량이 없어 ΔH 를 계산할 수 없습니다';
    }

    return {
      ok: true, area: area, dH: dH, dHnote: dHnote, sign: sign,
      peakX: x[kPeak], peakY: y[kPeak], height: Math.abs(dMax),
      onset: onset, endset: endset, onsetPt: onsetPt, endsetPt: endsetPt,
      base: { x0: bx0, y0: by0, x1: bx1, y1: by1, m: mB, at: base },
      x1: o.x1, x2: o.x2, n: idx.length
    };
  }

  /* -------------------------------------------------- 유리전이(Tg) 스텝 */
  /**
   * ISO 11357-2 방식: 전이 전·후 베이스라인과 변곡 접선의 교점을 onset/end,
   * 스텝 중앙(반높이)을 Tg(중간)로 본다.
   */
  function analyzeTg(o) {
    const x = o.x, y = o.y;
    const idx = rangeIdx(x, o.x1, o.x2);
    if (idx.length < 20) return { ok: false, reason: 'Tg 구간 데이터가 너무 적습니다 (20점 미만)' };

    const n = idx.length, k = Math.max(4, Math.floor(n * 0.25));
    const pre = idx.slice(0, k), post = idx.slice(n - k);
    const fPre = linfit(pre.map((i) => x[i]), pre.map((i) => y[i]));
    const fPost = linfit(post.map((i) => x[i]), post.map((i) => y[i]));

    const xm = (x[idx[0]] + x[idx[n - 1]]) / 2;
    const yb = fPre.at(xm), ya = fPost.at(xm);
    const step = ya - yb;
    const lvl = (ya + yb) / 2;

    // 반높이 교차점 → Tg(중간)
    let mid = null;
    for (let c = 1; c < n; c++) {
      const a = idx[c - 1], b = idx[c];
      const va = y[a] - lvl, vb = y[b] - lvl;
      if (va === 0 || (va < 0) !== (vb < 0)) {
        const t = Math.abs(va) / (Math.abs(va) + Math.abs(vb) || 1);
        mid = x[a] + (x[b] - x[a]) * t;
        break;
      }
    }

    // 변곡점(최대 기울기) 접선
    let bi = -1, bs = 0;
    for (let c = 1; c < n - 1; c++) {
      const i = idx[c];
      const s = Math.abs((y[idx[c + 1]] - y[idx[c - 1]]) / ((x[idx[c + 1]] - x[idx[c - 1]]) || 1));
      if (s > bs) { bs = s; bi = c; }
    }
    let tOn = null, tEnd = null;
    if (bi > 0) {
      const i = idx[bi];
      const s = (y[idx[bi + 1]] - y[idx[bi - 1]]) / ((x[idx[bi + 1]] - x[idx[bi - 1]]) || 1);
      const b = y[i] - s * x[i];
      const x1 = lineX(s, b, fPre.a, fPre.b);
      const x2 = lineX(s, b, fPost.a, fPost.b);
      if (x1 !== null && x1 > x[idx[0]] - 20 && x1 < (mid === null ? xm : mid)) tOn = x1;
      if (x2 !== null && x2 < x[idx[n - 1]] + 20 && x2 > (mid === null ? xm : mid)) tEnd = x2;
    }

    const conv = unitConv(o.unit, o.mass);
    const beta = Math.max(0.1, +o.beta || 10);
    const dCp = conv.perMass ? (step * conv.f * 60) / beta : null;    // J/(g·K)

    return {
      ok: true, step: step, dCp: dCp, tgMid: mid, tgOnset: tOn, tgEnd: tEnd,
      pre: { a: fPre.a, b: fPre.b }, post: { a: fPost.a, b: fPost.b },
      x1: o.x1, x2: o.x2, n: n
    };
  }

  /* ------------------------------------------------ 단위 → mW/mg 환산 계수 */
  function unitConv(unit, mass) {
    const m = +mass || 0;
    switch (unit) {
      case 'mW/mg': return { f: 1, perMass: true, label: 'mW/mg' };
      case 'W/g': return { f: 1, perMass: true, label: 'W/g (=mW/mg)' };
      case 'mW': return m > 0 ? { f: 1 / m, perMass: true, label: 'mW / 시료 ' + m + ' mg' } : { f: 1, perMass: false, label: 'mW' };
      case 'uW': return m > 0 ? { f: 0.001 / m, perMass: true, label: 'µW / 시료 ' + m + ' mg' } : { f: 0.001, perMass: false, label: 'µW' };
      case 'uV': case 'mV': return { f: 1, perMass: false, label: unit + '(전압 — 보정 필요)' };
      default: return m > 0 ? { f: 1 / m, perMass: true, label: 'mW / 시료 ' + m + ' mg' } : { f: 1, perMass: false, label: 'mW' };
    }
  }

  /* ------------------------------------------------- 결정화도 참고값 */
  // 문헌 관용값(J/g, 100 % 결정). 출처·grade 에 따라 10 % 이상 차이가 나므로
  // 반드시 자체 문헌/데이터시트 값으로 확인하고 UI 에서 수정해 쓰십시오.
  const REFS = [
    { k: '해당 없음 (열경화성·비결정성)', v: 0, note: '결정화도를 계산하지 않습니다' },
    { k: 'PE (HDPE)', v: 293, note: 'Wunderlich 관용값' },
    { k: 'PP (등방성)', v: 207, note: '관용값' },
    { k: 'PA6', v: 190, note: 'α형 기준. 문헌 190–240' },
    { k: 'PA66', v: 190, note: '문헌 190–255 로 갈림 — 확인 필요' },
    { k: 'PBT', v: 140, note: '관용값' },
    { k: 'PET', v: 140, note: '관용값' },
    { k: 'PPS', v: 150, note: '문헌 150 내외' },
    { k: 'PEEK', v: 130, note: '관용값' },
    { k: 'PLA', v: 93, note: 'PLLA 관용값' }
  ];
  function crystallinity(dHm, ref) {
    if (dHm === null || dHm === undefined || !isFinite(dHm)) return null;
    const r = +ref;
    if (!r || r <= 0) return null;
    return (Math.abs(dHm) / r) * 100;
  }

  /* -------------------------------------------------- 합성 데모 데이터 */
  /* 실측이 아님 — 알고리즘 검증/화면 확인용. endo=위(+), 단위 mW/mg, β=20 °C/min */
  function synthDemo() {
    const BETA = 20;
    const mk = (o) => {
      const dt = o.dt || 0.5;
      const xs = [], ys = [];
      for (let T = o.x1; T <= o.x2 + 1e-9; T += dt) xs.push(+T.toFixed(3));
      const areaToAmp = (dH, sig) => (Math.abs(dH) * BETA / 60) / (sig * Math.sqrt(2 * Math.PI));
      let seed = o.seed || 1;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
      for (const T of xs) {
        let v = (o.drift || 0.004) * (T - o.x1) / (o.x2 - o.x1);
        if (o.tg !== undefined) v += (o.tgStep || 0.02) * 0.5 * (1 + Math.tanh((T - o.tg) / 3.2));
        for (const pk of (o.peaks || [])) {
          const sig = (T < pk.mu) ? pk.sig * 0.78 : pk.sig * 1.25;   // 비대칭(꼬리)
          const amp = areaToAmp(pk.dH, pk.sig);
          v += (pk.dir === 'exo' ? -1 : 1) * amp * Math.exp(-0.5 * ((T - pk.mu) / sig) * ((T - pk.mu) / sig));
        }
        v += (o.noise === undefined ? 0.0015 : o.noise) * rnd();
        ys.push(v);
      }
      return { x: xs, y: ys };
    };
    return [
      { name: 'PA6 미처리 (합성)', color: '#4f9dff', data: mk({ x1: 20, x2: 300, tg: 55, tgStep: 0.030, peaks: [{ mu: 220, sig: 6.0, dH: 62 }], seed: 7 }) },
      { name: 'PA6 열노화 168 h (합성)', color: '#ff7a59', data: mk({ x1: 20, x2: 300, tg: 63, tgStep: 0.024, peaks: [{ mu: 217.5, sig: 8.0, dH: 48 }], seed: 11 }) },
      { name: 'PA6-GF30 정상 (합성)', color: '#3ddc97', data: mk({ x1: 20, x2: 300, tg: 57, tgStep: 0.020, peaks: [{ mu: 221, sig: 5.5, dH: 43 }], seed: 13 }) },
      { name: 'PA6-GF30 문제품 (합성)', color: '#ffd166', data: mk({ x1: 20, x2: 300, tg: 66, tgStep: 0.017, peaks: [{ mu: 219, sig: 7.2, dH: 33 }], seed: 17 }) },
      { name: 'PPS-GF40 (합성)', color: '#c792ea', data: mk({ x1: 20, x2: 340, tg: 90, tgStep: 0.012, peaks: [{ mu: 281, sig: 6.0, dH: 19 }], seed: 23 }) },
      { name: 'PBT (합성)', color: '#67e8f9', data: mk({ x1: 20, x2: 280, tg: 45, tgStep: 0.015, peaks: [{ mu: 225, sig: 5.0, dH: 41 }], seed: 29 }) },
      { name: '에폭시 미경화 (합성)', color: '#f472b6', data: mk({ x1: 20, x2: 300, tg: 60, tgStep: 0.010, peaks: [{ mu: 165, sig: 18.0, dH: 180, dir: 'exo' }], seed: 31 }) },
      { name: '에폭시 경화완료 (합성)', color: '#a3e635', data: mk({ x1: 20, x2: 300, tg: 105, tgStep: 0.006, peaks: [], seed: 37 }) }
    ];
  }

  window.DSCC = {
    parseText, smooth, linfit, interpAt, rangeIdx, mean, stdev,
    analyzePeak, analyzeTg, unitConv, crystallinity, REFS, synthDemo
  };
})();

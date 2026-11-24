/* FTIR Studio — Bruker OPUS 원시 바이너리(.0/.1/.2 …) 리더 v1.0
 *
 * 출처(공개 스펙·오픈소스 구현 대조):
 *   - brukeropus (MIT) 저수준 파서  https://joshduran.github.io/brukeropus/brukeropus/file/parse.html
 *   - openreadout OPUS 포맷 노트      https://openreadout.github.io/openreadout/formats/bruker-opus.html
 *
 * 파일 구조
 *   [0..4)   0A 0A FE FE
 *   [4..12)  f64 포맷 버전
 *   [12..16) i32 디렉터리 시작 오프셋
 *   [16..20) i32 디렉터리 슬롯 수
 *   [20..24) i32 사용 블록 수
 *   디렉터리: 블록당 12바이트 (type u32, size(4바이트 워드) u32, start u32), start<=0 이면 끝
 *
 * type 워드 비트: part 0-1 · role 2-3 · params 4-9 · data 10-16 · deriv 17-18 · ext 19-21
 *   params 0 = 데이터 블록, 1 = 데이터 스테이터스(파라미터), 2~11 = 기기/광학/획득/시료 파라미터
 *   data   1 single channel · 2 interferogram · 3 phase · 4 absorbance · 5 transmittance · 16 ATR …
 *   role   1 sample · 2 reference · 3 result
 *
 * 파라미터 블록: 레코드 = 3자 이름 + (1바이트 패딩) + i16 dtype + i16 크기(2바이트 워드) + 값, 'END'까지
 *   dtype 0=i32, 1=f64, 2~4=문자열
 * 데이터 블록: float32(DPF=1) 또는 int32(DPF=2) 원시값, y = 저장값 × CSF, x = linspace(FXV, LXV, NPT)
 */
(function (root) {
  'use strict';

  var KIND = {
    1: ['single channel', '단일채널'], 2: ['interferogram', '인터페로그램'], 3: ['phase', '위상'],
    4: ['absorbance', '흡광도'], 5: ['transmittance', '투과율'], 6: ['Kubelka-Munk', 'K-M'],
    7: ['trace', '트레이스'], 8: ['GC interferogram', 'GC 간섭'], 9: ['GC spectrum', 'GC 스펙트럼'],
    10: ['Raman', '라만'], 11: ['emission', '발광'], 12: ['reflectance', '반사율'], 14: ['power', '파워'],
    15: ['log reflectance', 'log 반사'], 16: ['ATR', 'ATR'], 17: ['photoacoustic', '광음향'],
    18: ['result', '연산결과'], 19: ['result', '연산결과'], 22: ['match', '매치']
  };
  var ROLE = { 1: 'sample', 2: 'reference', 3: 'result' };
  var PGROUP = {
    1: 'data_status', 2: 'instrument', 3: 'acquisition', 4: 'fourier', 5: 'display',
    6: 'optics', 7: 'gc', 8: 'library', 9: 'comm', 10: 'sample', 11: 'lab'
  };

  function isOpus(u8) {
    return !!u8 && u8.length > 32 &&
      u8[0] === 0x0A && u8[1] === 0x0A && u8[2] === 0xFE && u8[3] === 0xFE;
  }

  function decodeType(t) {
    t = t >>> 0;
    return {
      part: t & 3, role: (t >>> 2) & 3, params: (t >>> 4) & 0x3F,
      data: (t >>> 10) & 0x7F, deriv: (t >>> 17) & 3, ext: (t >>> 19) & 7
    };
  }

  var maskParams = function (t) { return ((t & ~(0x3F << 4)) >>> 0); };

  function bytesToStr(u8, from, len) {
    var out = '', high = false;
    for (var i = 0; i < len; i++) {
      var c = u8[from + i];
      if (c === 0) break;
      if (c > 0x7F) high = true;
      out += String.fromCharCode(c);
    }
    if (!high) return out;
    var slice = u8.subarray(from, from + len);
    if (typeof TextDecoder !== 'undefined') {
      var encs = ['utf-8', 'euc-kr'];
      for (var e = 0; e < encs.length; e++) {
        try { return new TextDecoder(encs[e], { fatal: true }).decode(slice).replace(/\u0000.*$/, ''); } catch (err) { /* next */ }
      }
    }
    return out;
  }

  function parseParams(u8) {
    var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    var p = {}, loc = 0, guard = 0;
    while (loc + 8 <= u8.length && guard++ < 5000) {
      var key = '';
      for (var k = 0; k < 3; k++) {
        var c = u8[loc + k];
        if (c === 0) break;
        key += String.fromCharCode(c);
      }
      if (!key || key === 'END') break;
      var dt = dv.getInt16(loc + 4, true);
      var size = dv.getInt16(loc + 6, true) * 2;
      if (size < 0 || loc + 8 + size > u8.length) break;
      var val;
      if (dt === 0) val = dv.getInt32(loc + 8, true);
      else if (dt === 1) val = dv.getFloat64(loc + 8, true);
      else val = bytesToStr(u8, loc + 8, size);
      p[key] = val;
      loc += 8 + size;
    }
    return p;
  }

  function pickScore(b) {
    var kind = b.d.data, role = b.d.role;
    if (kind === 2 || kind === 3) return 1;            // 간섭도·위상은 스펙트럼이 아님
    if (role === 3) return kind === 4 ? 100 : kind === 16 ? 95 : kind === 5 ? 90 : 70;
    if (role === 1) return kind === 4 ? 60 : kind === 16 ? 58 : kind === 5 ? 56 : kind === 1 ? 40 : 10;
    if (role === 2) return 5;
    return 3;
  }

  /**
   * OPUS 파일을 읽는다.
   * @param {ArrayBuffer} buffer
   * @param {{name?:string, blockIndex?:number}} [opts]
   * @returns {object} parseText()와 동일한 형태 + info/blocks
   */
  function parse(buffer, opts) {
    opts = opts || {};
    var u8 = new Uint8Array(buffer);
    if (!isOpus(u8)) return { error: 'OPUS 시그니처(0A 0A FE FE)가 아닙니다 — ASCII(.dpt) 또는 실제 OPUS 파일인지 확인하세요.' };
    var dv = new DataView(buffer);
    var version = dv.getFloat64(4, true);
    var dirStart = dv.getInt32(12, true);
    var maxBlocks = dv.getInt32(16, true);
    var numBlocks = dv.getInt32(20, true);
    var warnings = [];
    if (!(dirStart >= 24 && dirStart < u8.length)) return { error: '디렉터리 오프셋이 비정상입니다 (' + dirStart + ')' };
    var n = Math.min(numBlocks, maxBlocks, 4096);
    if (!(n > 0)) return { error: '블록 수가 0입니다.' };

    var blocks = [], i, rec, type, sizeWords, start, bytes;
    for (i = 0; i < n; i++) {
      rec = dirStart + i * 12;
      if (rec + 12 > u8.length) break;
      type = dv.getInt32(rec, true);
      sizeWords = dv.getInt32(rec + 4, true);
      start = dv.getInt32(rec + 8, true);
      if (start <= 0) break;
      if (start === dirStart) continue;                    // 디렉터리 블록 자신
      bytes = sizeWords * 4;
      if (bytes <= 0 || start + bytes > u8.length) { warnings.push('블록 ' + i + ' 범위 초과 — 건너뜀'); continue; }
      blocks.push({ i: i, type: type >>> 0, d: decodeType(type), size: bytes, start: start });
    }
    if (!blocks.length) return { error: '블록을 하나도 읽지 못했습니다.' };

    var dataBlocks = [], info = {}, sampleName = '';
    for (i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var sub = new Uint8Array(buffer, b.start, b.size);
      if (b.d.params === 0 && b.d.data > 0 && b.d.ext !== 5) {
        dataBlocks.push(b);
      } else if (b.d.params > 0) {
        b.p = parseParams(sub);
        var g = PGROUP[b.d.params];
        if (g === 'sample' && b.p.SNM) sampleName = String(b.p.SNM);
        if (g === 'instrument') { info.instrument = b.p.INS; info.serial = b.p.SRN; }
        if (g === 'acquisition') {
          if (b.p.RES != null) info.resolution = b.p.RES;
          if (b.p.NSS != null) info.scans = b.p.NSS;          // 시료측 스캔 수 우선
          else if (b.p.NSR != null && info.scans == null) info.scans = b.p.NSR;
          if (b.p.PLF != null) info.result = b.p.PLF;
        }
        if (g === 'optics') { info.accessory = b.p.ACC; info.beamsplitter = b.p.BMS; info.source = b.p.SRC; info.detector = b.p.DTC; info.aperture = b.p.APT; }
      }
    }

    var statusOf = function (b) {
      var want = maskParams(b.type);
      for (var j = 0; j < blocks.length; j++) {
        if (blocks[j].d.params === 1 && maskParams(blocks[j].type) === want) return blocks[j];
      }
      return null;
    };

    var t = new DataView(buffer), tol;
    var decoded = [];
    for (i = 0; i < dataBlocks.length; i++) {
      b = dataBlocks[i];
      var st = statusOf(b);
      var p = st ? st.p : null;
      var label = (KIND[b.d.data] ? KIND[b.d.data][1] : 'kind' + b.d.data) + ' / ' + (ROLE[b.d.role] || 'role' + b.d.role);
      if (!p || typeof p.NPT !== 'number') { warnings.push(label + ': 스테이터스 블록 없음 — 건너뜀'); continue; }
      var npt = p.NPT | 0;
      if (!(npt > 1)) { warnings.push(label + ': NPT 비정상 — 건너뜀'); continue; }
      var csf = (typeof p.CSF === 'number' && isFinite(p.CSF)) ? p.CSF : 1;
      var dpf = (p.DPF | 0) || 1;
      var total = Math.floor(b.size / 4);
      var off = (b.d.ext === 4) ? Math.max(0, total - npt) : 0;   // compact 블록은 뒤쪽 NPT개
      if (off + npt > total) { warnings.push(label + ': 데이터 길이 부족(' + total + ' < ' + npt + ') — 건너뜀'); continue; }

      var xs = new Float64Array(npt), ys = new Float64Array(npt), base = b.start;
      var mn = Infinity, mx = -Infinity;
      for (var k2 = 0; k2 < npt; k2++) {
        var o = base + (off + k2) * 4;
        var v = (dpf === 2) ? t.getInt32(o, true) : t.getFloat32(o, true);
        v *= csf;
        ys[k2] = v;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      var fxv = p.FXV, lxv = p.LXV;
      if (typeof fxv !== 'number' || typeof lxv !== 'number') { warnings.push(label + ': 축 범위(FXV/LXV) 없음 — 건너뜀'); continue; }
      var step = (lxv - fxv) / (npt - 1);
      var dxu = String(p.DXU || '').toUpperCase();
      for (k2 = 0; k2 < npt; k2++) {
        var xv = fxv + step * k2;
        if (dxu === 'MI') xv = 10000 / xv;          // µm → cm⁻¹
        else if (dxu === 'NM') xv = 1e7 / xv;       // nm → cm⁻¹
        xs[k2] = xv;
      }

      // 무결성 검증: 파일 내부 MNY/MXY와 실제 최소·최대 대조
      var verify = 'none';
      if (typeof p.MNY === 'number' && typeof p.MXY === 'number') {
        var span = Math.abs(p.MXY - p.MNY) || 1;
        tol = Math.max(1e-6, 0.01 * span);
        verify = (Math.abs(mn - p.MNY) <= tol && Math.abs(mx - p.MXY) <= tol) ? 'ok' : 'fail';
        if (verify === 'fail') {
          warnings.push(label + ': 무결성 검사 실패 (계산 ' + mn.toFixed(5) + '–' + mx.toFixed(5) +
            ' vs 파일 ' + p.MNY.toFixed(5) + '–' + p.MXY.toFixed(5) + ') — 값 신뢰 불가, 불러오지 않음');
          continue;
        }
      }

      var unit = 'abs';
      if (b.d.data === 5) {
        // OPUS 투과율은 %(0~100) 또는 0~1 두 가지 — 값 범위로 판정해 %로 통일
        if (mx <= 1.5) { for (k2 = 0; k2 < npt; k2++) ys[k2] *= 100; }
        unit = 'trans';
      }
      decoded.push({
        label: label, kind: b.d.data, role: b.d.role, ext: b.d.ext,
        unit: unit, npt: npt, x: xs, y: ys, dxu: dxu, verify: verify,
        date: p.DAT, time: p.TIM, score: pickScore(b)
      });
    }

    if (!decoded.length) {
      return { error: '사용 가능한 스펙트럼 블록이 없습니다. ' + (warnings.length ? warnings[warnings.length - 1] : '') };
    }

    var chosen = null;
    if (typeof opts.blockIndex === 'number' && decoded[opts.blockIndex]) chosen = decoded[opts.blockIndex];
    if (!chosen) {
      chosen = decoded[0];
      for (i = 1; i < decoded.length; i++) if (decoded[i].score > chosen.score) chosen = decoded[i];
    }
    if (chosen.unit === 'abs' && chosen.kind === 1) {
      warnings.push('단일채널(Single Channel) 원시 스펙트럼입니다 — 흡광도가 아니므로 CI 등 지수 계산에 쓰지 마세요.');
    }
    if (chosen.dxu && chosen.dxu !== 'WN' && chosen.dxu !== 'MI' && chosen.dxu !== 'NM') {
      warnings.push('X축 단위 코드가 ' + chosen.dxu + ' 입니다 — 파수(cm⁻¹)가 아닐 수 있습니다.');
    }
    if (chosen.verify === 'none') warnings.push('내부 무결성 검사값(MNY/MXY)이 없어 값 검증을 못 했습니다.');

    // x 오름차순 정렬 (앱 내부 규약)
    var order = new Array(chosen.npt);
    for (i = 0; i < chosen.npt; i++) order[i] = i;
    if (chosen.x[0] > chosen.x[chosen.npt - 1]) order.reverse();
    var X = new Array(chosen.npt), Y = new Array(chosen.npt);
    for (i = 0; i < chosen.npt; i++) { X[i] = chosen.x[order[i]]; Y[i] = chosen.y[order[i]]; }

    var baseName = (opts.name || '').replace(/\.[^.]+$/, '');
    var name = sampleName || baseName || 'OPUS';
    if (sampleName && baseName && sampleName !== baseName) name = sampleName;

    var others = decoded.filter(function (d) { return d !== chosen; })
      .map(function (d) { return d.label + '(' + d.npt + 'pt)'; });

    return {
      name: name,
      x: X, y: Y, unit: chosen.unit, n: chosen.npt,
      warnings: warnings,
      source: 'opus',
      info: {
        version: version, blocks: blocks.length, spectrum: chosen.label,
        kind: chosen.kind, verify: chosen.verify, others: others,
        instrument: info.instrument, serial: info.serial,
        resolution: info.resolution, scans: info.scans,
        accessory: info.accessory, beamsplitter: info.beamsplitter,
        source_: info.source, detector: info.detector,
        date: chosen.date, time: chosen.time, sampleName: sampleName
      }
    };
  }

  root.FTIROpus = { isOpus: isOpus, parse: parse, decodeType: decodeType, parseParams: parseParams };
})(typeof window !== 'undefined' ? window : globalThis);

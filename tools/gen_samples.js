/* 샘플 .dpt 생성기 (데모 스펙트럼 → ASCII 파일) — node gen_samples.js */
global.window = {};
require('../demo.js');
const fs = require('fs');
const path = require('path');
const out = path.join(__dirname, '..', 'samples');
const map = {
  'PA6 초기': 'PA6_neat',
  'PA6 열노화 168h': 'PA6_aged168h',
  'PA6-GF30 정상품': 'PA6-GF30_ok',
  'PA6-GF30 문제품': 'PA6-GF30_ng',
  'PPS-GF40': 'PPS-GF40',
  'PBT': 'PBT',
  '에폭시 미경화': 'Epoxy_uncured',
  '에폭시 경화': 'Epoxy_cured',
  'NR 열노화': 'NR_aged',
  'NBR': 'NBR'
};
const data = global.window.FTIR_DEMO();
for (const s of data) {
  const base = map[s.name];
  if (!base) continue;
  const lines = ['# Bruker OPUS ASCII export (synthetic demo)', '# Wavenumber(cm-1)\tAbsorbance'];
  for (let i = 0; i < s.x.length; i++) lines.push(s.x[i].toFixed(2) + '\t' + s.y[i].toFixed(6));
  fs.writeFileSync(path.join(out, base + '.dpt'), lines.join('\n') + '\n', 'utf8');
  console.log('wrote', base + '.dpt', s.x.length, 'pts');
}

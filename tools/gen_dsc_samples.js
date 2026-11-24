// DSC ASCII 샘플 생성 (합성 데이터). tools/bundle.py 와 무관, 1회성 유틸.
// 사용: node tools/gen_dsc_samples.js  → samples/dsc/*.txt
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'dsc-core.js'), 'utf8'))();
const D = global.window.DSCC;

const outDir = path.join(__dirname, '..', 'samples', 'dsc');
fs.mkdirSync(outDir, { recursive: true });

const demo = D.synthDemo();
const BETA = 20;
let n = 0;
for (const d of demo) {
  // 파일명은 ASCII 로 (한글 파일명 인코딩 이슈 회피)
  const slug = d.name
    .replace('PA6 미처리 (합성)', 'PA6_virgin')
    .replace('PA6 열노화 168 h (합성)', 'PA6_aged168h')
    .replace('PA6-GF30 정상 (합성)', 'PA6-GF30_ok')
    .replace('PA6-GF30 문제품 (합성)', 'PA6-GF30_ng')
    .replace('PPS-GF40 (합성)', 'PPS-GF40')
    .replace('PBT (합성)', 'PBT')
    .replace('에폭시 미경화 (합성)', 'Epoxy_uncured')
    .replace('에폭시 경화완료 (합성)', 'Epoxy_cured')
    .replace(/[^\w.\-]/g, '_');

  const lines = [];
  lines.push('## DSC 합성 데모 (실측값 아님 — 알고리즘 검증용)');
  lines.push('## sample: ' + d.name);
  lines.push('## heating rate: ' + BETA + ' C/min');
  lines.push('Temp/C\tHF/mW/mg');
  for (let i = 0; i < d.data.x.length; i++) {
    lines.push(d.data.x[i].toFixed(2) + '\t' + d.data.y[i].toFixed(6));
  }
  const p = path.join(outDir, slug + '.txt');
  fs.writeFileSync(p, lines.join('\r\n'), 'utf8');
  n++;
  console.log(slug + '.txt  ' + d.data.x.length + ' rows');
}
console.log('written', n, 'files →', outDir);

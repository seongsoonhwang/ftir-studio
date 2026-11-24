/* samples/tga/*.txt 생성 — 합성 TGA(알고리즘 검증용, 실측 아님)
 * 사용: node tools/gen_tga_samples.js   (저장소 루트 기준)
 * 헤더: Temp/C  Weight/%  (탭 구분, 2열)
 */
const fs = require('fs');
const path = require('path');
global.window = {};
new Function(fs.readFileSync(path.join(__dirname, '..', 'tga-core.js'), 'utf8'))();

const outDir = path.join(__dirname, '..', 'samples', 'tga');
fs.mkdirSync(outDir, { recursive: true });

const slug = (s) => s
  .replace(/\(합성\)/, '')
  .trim()
  .replace(/\s+/g, '_')
  .replace(/[^\w가-힣.\-]/g, '');

const demo = window.TGAC.synthDemo();
for (const d of demo) {
  const lines = ['# FTIR Studio — 합성 TGA 데이터 (실측 아님, 알고리즘 검증용)', '# Temp/C\tWeight/%'];
  for (let i = 0; i < d.data.x.length; i++) {
    lines.push(d.data.x[i].toFixed(2) + '\t' + d.data.y[i].toFixed(4));
  }
  const f = path.join(outDir, slug(d.name) + '.txt');
  fs.writeFileSync(f, lines.join('\r\n') + '\r\n', 'utf8');
  console.log(path.relative(process.cwd(), f), (fs.statSync(f).size / 1024).toFixed(1) + ' KB');
}
console.log('완료:', demo.length, '개');

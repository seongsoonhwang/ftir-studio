"""ftir-studio.html + css/js 를 단일 파일로 인라인 (배포/이동용)
사용: python3 tools/bundle.py  →  ftir-studio-single.html
"""
import re, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'ftir-studio.html').read_text(encoding='utf-8')

# CSS 인라인
def css_inline(m):
    href = m.group(1)
    css = (root / href).read_text(encoding='utf-8')
    return '<style>\n' + css + '\n</style>'
html = re.sub(r'<link rel="stylesheet" href="([^"]+)">', css_inline, html)

# JS 인라인
def js_inline(m):
    src = m.group(1)
    code = (root / src).read_text(encoding='utf-8')
    assert '</script>' not in code, src + ' 안에 </script> 문자열이 있습니다'
    return '<script>\n/* ==== ' + src + ' ==== */\n' + code + '\n</script>'
html = re.sub(r'<script src="([^"]+)"></script>', js_inline, html)

out = root / 'ftir-studio-single.html'
out.write_text(html, encoding='utf-8')
print(f'{out}  {out.stat().st_size/1024:.1f} KB')

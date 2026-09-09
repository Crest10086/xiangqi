import os
os.chdir(r'C:/Users/35165/xiangqi')
html = open('index.html', encoding='utf-8').read()
eng = open('engine.js', encoding='utf-8').read()
assert '<script src="engine.js"></script>' in html, 'anchor missing'
html = html.replace('<script src="engine.js"></script>', '<script>\n' + eng + '\n</script>')
open('xiangqi.html', 'w', encoding='utf-8').write(html)
print('single file:', len(html.encode('utf-8')), 'bytes')
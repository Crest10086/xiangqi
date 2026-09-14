# -*- coding: utf-8 -*-
import os, base64, json
os.chdir(r'C:/Users/35165/xiangqi')

def rd(p):
    with open(p, 'r', encoding='utf-8') as f: return f.read()
def rb(p):
    with open(p, 'rb') as f: return f.read()

html = rd('index.html')
engine = rd('engine.js')
bridge = rd('js/pikafish_bridge.js')
pf_js = rd('js/engines/pikafish/pikafish.js')
pf_wasm_b64 = base64.b64encode(rb('js/engines/pikafish/pikafish.wasm')).decode('ascii')
pf_data_b64 = base64.b64encode(rb('js/engines/pikafish/pikafish.data')).decode('ascii')

# 内嵌引擎载荷（供 blob worker 使用）
payload = (
    "<script>\n"
    "// ==== 内嵌 Pikafish WASM 引擎载荷（高手/大师档，file:// 单文件用）====\n"
    "window.PF_ENGINE_JS = " + json.dumps(pf_js) + ";\n"
    "window.PF_WASM_B64 = " + json.dumps(pf_wasm_b64) + ";\n"
    "window.PF_DATA_B64 = " + json.dumps(pf_data_b64) + ";\n"
    "</script>"
)

# 替换外部引用为内联
assert '<script src="engine.js"></script>' in html
assert '<script src="js/pikafish_bridge.js"></script>' in html
html = html.replace('<script src="engine.js"></script>', '<script>\n' + engine + '\n</script>')
html = html.replace('<script src="js/pikafish_bridge.js"></script>', payload + '\n<script>\n' + bridge + '\n</script>')

with open('xiangqi.html', 'w', encoding='utf-8') as f:
    f.write(html)

sz = len(html.encode('utf-8'))
print('single file:', sz, 'bytes =', round(sz/1024/1024, 2), 'MB')
print('embedded: wasm=%.1fKB data=%.1fKB js=%.1fKB' % (len(pf_wasm_b64)/1024, len(pf_data_b64)/1024, len(pf_js)/1024))
print('has PF_WASM_B64:', 'PF_WASM_B64' in html)
print('has pikafish_bridge:', 'PF.isHeavyLevel' in html)
print('has engine:', 'initialBoard' in html)
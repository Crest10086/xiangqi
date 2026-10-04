# -*- coding: utf-8 -*-
# 单文件版（file:// 直接双击打开）：内嵌旧小网络引擎（js/engines/pikafish/legacy/）。
# 完整强度引擎的 pikafish.nnue 是 50.7MB，base64 内嵌会把单文件推到 ~70MB，所以单文件版保留
# 旧引擎与定案前的旧参数（见 js/pikafish_bridge.js 的 B 路径说明）。
import os, base64, json
os.chdir(r'C:/Users/35165/xiangqi')

def rd(p):
    with open(p, 'r', encoding='utf-8') as f: return f.read()
def rb(p):
    with open(p, 'rb') as f: return f.read()

html = rd('index.html')
engine = rd('engine.js')
bridge = rd('js/pikafish_bridge.js')
book_js = rd('js/book.js')
xqbook_js = rd('js/xqbook.js')
tier_rules = rd('js/tier_rules.js')
tier_config = rd('js/tier_config.js')
pf_js = rd('js/engines/pikafish/legacy/pikafish.js')
pf_wasm_b64 = base64.b64encode(rb('js/engines/pikafish/legacy/pikafish.wasm')).decode('ascii')
pf_data_b64 = base64.b64encode(rb('js/engines/pikafish/legacy/pikafish.data')).decode('ascii')

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
assert '<script src="js/book.js"></script>' in html
assert '<script src="js/xqbook.js"></script>' in html
assert '<script src="js/tier_rules.js"></script>' in html
assert '<script src="js/tier_config.js"></script>' in html
assert '<script src="js/pikafish_bridge.js"></script>' in html
html = html.replace('<script src="engine.js"></script>', '<script>\n' + engine + '\n</script>')
html = html.replace('<script src="js/book.js"></script>', '<script>\n' + book_js + '\n</script>')
html = html.replace('<script src="js/xqbook.js"></script>', '<script>\n' + xqbook_js + '\n</script>')
html = html.replace('<script src="js/tier_rules.js"></script>', '<script>\n' + tier_rules + '\n</script>')
html = html.replace('<script src="js/tier_config.js"></script>', '<script>\n' + tier_config + '\n</script>')
html = html.replace('<script src="js/pikafish_bridge.js"></script>', payload + '\n<script>\n' + bridge + '\n</script>')

with open('xiangqi.html', 'w', encoding='utf-8') as f:
    f.write(html)

sz = len(html.encode('utf-8'))
print('single file:', sz, 'bytes =', round(sz/1024/1024, 2), 'MB')
print('embedded: wasm=%.1fKB data=%.1fKB js=%.1fKB' % (len(pf_wasm_b64)/1024, len(pf_data_b64)/1024, len(pf_js)/1024))
print('has PF_WASM_B64:', 'PF_WASM_B64' in html)
print('has pikafish_bridge:', 'PF.isHeavyLevel' in html)
print('has engine:', 'initialBoard' in html)
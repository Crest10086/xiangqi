# -*- coding: utf-8 -*-
import os, base64, json
os.chdir(r'C:/Users/35165/xiangqi')
def rd(p):
    with open(p,'r',encoding='utf-8') as f: return f.read()
def rb(p):
    with open(p,'rb') as f: return f.read()
engine=rd('engine.js'); bridge=rd('js/pikafish_bridge.js')
pj=rd('js/engines/pikafish/pikafish.js')
wb=base64.b64encode(rb('js/engines/pikafish/pikafish.wasm')).decode()
db=base64.b64encode(rb('js/engines/pikafish/pikafish.data')).decode()
html = """<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><div id="log">start</div>
<script>window.PF_ENGINE_JS=""" + json.dumps(pj) + """;window.PF_WASM_B64=""" + json.dumps(wb) + """;window.PF_DATA_B64=""" + json.dumps(db) + """;</script>
<script>""" + engine + """</script>
<script>""" + bridge + """</script>
<script>
window.PF_FORCE_BLOB=true;
const el=document.getElementById('log'); const add=(m)=>{el.textContent+='\\n'+m; console.log(m);};
window.__result=null;
(async ()=>{
  const g=new XQ.Game('none',-1);
  for(let i=0;i<6;i++){ g.aiMove(3,1,3000,0); }
  const fen=PF.boardToFen(g.board,g.side);
  add('FEN='+fen);
  const ok=await PF.whenReady();
  add('whenReady='+ok);
  if(!ok){window.__result='NOT_READY';return;}
  const t0=Date.now();
  const mvStr=await PF.search(fen,1200);
  add('move='+mvStr+' ('+(Date.now()-t0)+'ms)');
  const mv=PF.parseMove(mvStr);
  const legal=g.legalMoves().some(m=>m.f===mv.f&&m.t===mv.t);
  add('legal='+legal);
  window.__result=(legal?'OK':'ILLEGAL')+' '+mvStr;
})().catch(e=>{add('ERR '+e);window.__result='ERR:'+e;});
setTimeout(()=>{if(!window.__result)add('TIMEOUT');},15000);
</script></body></html>"""
with open('test_blob.html','w',encoding='utf-8') as f: f.write(html)
print('test_blob.html written', len(html.encode()), 'bytes')
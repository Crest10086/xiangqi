/* check_alt_driver.js — TEST-ONLY syntax check: extract the inline script from alt_driver.html
 * and run node --check on it, so a typo is caught before spending 20 minutes of engine time. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const h = fs.readFileSync(path.join(__dirname, 'alt_driver.html'), 'utf8');
const blocks = h.match(/<script>([\s\S]*?)<\/script>/g) || [];
if (!blocks.length) { console.log('NO INLINE SCRIPT FOUND'); process.exit(1); }
const body = blocks.map(b => b.replace(/^<script>/, '').replace(/<\/script>$/, '')).join('\n');
const out = path.join(process.env.TMPDIR || os.tmpdir(), 'alt_driver_inline.js');
fs.writeFileSync(out, 'var AltRules={pick:0,strHash:0};var self=global;var location={search:""};var sessionStorage={getItem:()=>null,setItem:()=>{}};var navigator={};var fetch=()=>Promise.resolve();var document={title:""};\n' + body);
console.log('wrote ' + out + ' bytes=' + body.length);

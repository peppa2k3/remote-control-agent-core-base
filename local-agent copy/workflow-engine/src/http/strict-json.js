// JSON.parse cannot detect duplicate keys. Scan the grammar before decoding.
function parseStrictJson(text) {
  let i = 0;
  const bad = () => { throw Object.assign(new Error('INVALID_JSON'), {status:400}); };
  const space = () => { while (/\s/.test(text[i] || '') && i < text.length) i++; };
  function string() {
    const start = i++; let escaped = false;
    while (i < text.length) { const c = text[i++]; if (!escaped && c === '"') return JSON.parse(text.slice(start,i)); if (!escaped && c === '\\') escaped = true; else escaped = false; }
    bad();
  }
  function value(depth=0) {
    if(depth>64)bad();space();
    if(text[i]==='"'){string();return;}
    if(text[i]==='{'){
      i++;space();const keys=new Set();if(text[i]==='}'){i++;return;}
      while(i<text.length){space();if(text[i]!=='"')bad();const key=string();if(keys.has(key)||['__proto__','prototype','constructor'].includes(key))bad();keys.add(key);space();if(text[i++]!==':')bad();value(depth+1);space();const c=text[i++];if(c==='}')return;if(c!==',')bad();}bad();
    }
    if(text[i]==='['){i++;space();if(text[i]===']'){i++;return;}while(i<text.length){value(depth+1);space();const c=text[i++];if(c===']')return;if(c!==',')bad();}bad();}
    const match=/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));if(!match)bad();i+=match[0].length;
  }
  value();space();if(i!==text.length)bad();const result=JSON.parse(text);
  function finite(v){if(typeof v==='number'&&!Number.isFinite(v))bad();if(v&&typeof v==='object')Object.values(v).forEach(finite);}finite(result);return result;
}
module.exports={parseStrictJson};

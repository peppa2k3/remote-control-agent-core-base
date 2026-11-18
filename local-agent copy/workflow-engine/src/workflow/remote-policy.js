const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {parseStrictJson}=require('../http/strict-json');
const {resolveVariables,overrideVariables}=require('./variables');
const fail=(code='POLICY_DENIED',status=403)=>{throw Object.assign(new Error(code),{status,code});};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const exact=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k));
const name=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v);
const profile=v=>typeof v==='string'&&/^(Default|Profile \d+)$/.test(v);
function createRemotePolicy({file,scenariosDir,scenarios}){
  let digest='',policy=null;
  function load(){
    try{
      if(fs.statSync(file).size>65536)fail();const bytes=fs.readFileSync(file);if(bytes.length>65536)fail();
      const current=createHash('sha256').update(bytes).digest('hex');
      if(current===digest&&policy)return policy;
      const p=parseStrictJson(bytes.toString('utf8'));
      if(!exact(p,['schemaVersion','revision','profiles','scenarios','fileRoots','urlOrigins'])||p.schemaVersion!==1||!Number.isSafeInteger(p.revision)||p.revision<1||!Array.isArray(p.profiles)||p.profiles.length>100||!Array.isArray(p.scenarios)||p.scenarios.length>200)fail();
      const unique=list=>new Set(list).size===list.length;
      if(!unique(p.profiles.map(v=>v.id))||!unique(p.scenarios.map(v=>v.id)))fail();
      for(const v of p.profiles)if(!exact(v,['id','allowOpen'])||!profile(v.id)||typeof v.allowOpen!=='boolean')fail();
      for(const s of p.scenarios){
        if(!exact(s,['id','sha256','profiles','variables','publicDefaults'])||!name(s.id)||!/^[a-f0-9]{64}$/.test(s.sha256)||!Array.isArray(s.profiles)||!s.profiles.length||!unique(s.profiles)||s.profiles.some(v=>!p.profiles.some(q=>q.id===v))||!object(s.variables)||Object.keys(s.variables).length>100||!Array.isArray(s.publicDefaults)||s.publicDefaults.some(k=>!Object.hasOwn(s.variables,k)))fail();
        for(const [k,v]of Object.entries(s.variables)){
          if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)||k.startsWith('download_')||['prototype','constructor','__proto__'].includes(k)||!exact(v,['type','enum','maxLength','minimum','maximum'])||!['string','number','integer','boolean'].includes(v.type))fail();
          if(v.enum!==undefined&&(!Array.isArray(v.enum)||!v.enum.length||v.enum.length>100))fail();
          if(v.type==='string'&&(!Number.isInteger(v.maxLength)||v.maxLength<1||v.maxLength>4096))fail();
          if(['number','integer'].includes(v.type)&&(!Number.isFinite(v.minimum)||!Number.isFinite(v.maximum)||v.minimum>v.maximum))fail();
          if(v.enum)v.enum.forEach(value=>validate(value,v));
        }
      }
      for(const field of ['fileRoots','urlOrigins'])if(p[field]!==undefined&&(!Array.isArray(p[field])||p[field].length>100||p[field].some(v=>typeof v!=='string')))fail();
      for(const root of p.fileRoots||[])if(!path.isAbsolute(root))fail();
      for(const origin of p.urlOrigins||[]){const u=new URL(origin);if(u.protocol!=='https:'||u.origin!==origin||u.username||u.password||u.hostname==='localhost'||/^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|169\.254\.|\[)/.test(u.hostname))fail();}
      policy=p;digest=current;return p;
    }catch{policy=null;digest='';fail();}
  }
  function validate(value,schema){
    if(schema.type==='string'){if(typeof value!=='string'||value.length>schema.maxLength||value.includes('\0')||value.includes('{{'))fail();}
    else if(schema.type==='boolean'){if(typeof value!=='boolean')fail();}
    else if(!Number.isFinite(value)||(schema.type==='integer'&&!Number.isSafeInteger(value))||value<schema.minimum||value>schema.maximum)fail();
    if(schema.enum&&!schema.enum.includes(value))fail();
  }
  function scenario(id,selectedProfile){
    const p=load(),rule=p.scenarios.find(s=>s.id===id);if(!rule||selectedProfile&&!rule.profiles.includes(selectedProfile))fail();
    const root=fs.realpathSync(scenariosDir),source=fs.realpathSync(path.join(scenariosDir,id+'.json'));
    if(path.dirname(source)!==root)fail();
    const bytes=fs.readFileSync(source);if(createHash('sha256').update(bytes).digest('hex')!==rule.sha256)fail();
    return {rule,source:parseStrictJson(bytes.toString('utf8')),revision:p.revision,digest};
  }
  function prepare(id,selectedProfile,variables={}){
    if(!object(variables))fail();const checked=scenario(id,selectedProfile);
    for(const [key,value]of Object.entries(variables)){if(!Object.hasOwn(checked.rule.variables,key))fail();validate(value,checked.rule.variables[key]);}
    const baseline=resolveVariables(checked.source),updated=resolveVariables(overrideVariables(checked.source,variables));
    // Remote overrides may change text/time/numeric input only, never destinations,
    // paths, selectors, actions or nested completion instructions, including aliases.
    const mutable=new Set(['text','value','ms','timeoutMs','waitAfterMs','clear','pixels','times','intervalMs']);
    function protectedFields(s){return s.steps.map(step=>Object.fromEntries(Object.entries(step).filter(([k])=>!mutable.has(k))));}
    if(JSON.stringify(protectedFields(baseline))!==JSON.stringify(protectedFields(updated)))fail();
    const prepared=scenarios.prepare(updated);for(const step of prepared.steps)checkStep(step);
    return {...checked,prepared};
  }
  function checkStep(step){
    const p=load();if(step.action==='openFolder')fail();
    for(const key of ['url','pageUrl'])if(step[key]&&!String(step[key]).includes('{{')){const u=new URL(step[key]);if(u.protocol!=='https:'||u.username||u.password||!(p.urlOrigins||[]).includes(u.origin))fail();}
    for(const key of ['path','filePath','directory','folder'])if(step[key]&&!String(step[key]).includes('{{')){
      if(!path.isAbsolute(step[key]))fail();const resolved=fs.realpathSync(step[key]);
      if(!(p.fileRoots||[]).some(root=>{const rel=path.relative(fs.realpathSync(root),resolved);return !path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep);}))fail();
    }
  }
  function catalog(){const p=load();return p.scenarios.filter(s=>{try{scenario(s.id);return true;}catch{return false;}}).map(s=>s.id);}
  return {load,scenario,prepare,checkStep,catalog,stamp(){load();return digest;},fail};
}
module.exports={createRemotePolicy,fail,exact,object};

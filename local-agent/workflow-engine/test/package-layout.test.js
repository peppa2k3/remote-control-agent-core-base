const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { exportStandalone } = require('../scripts/package-standalone');
const { temporary, removeTemporary } = require('./helpers/engine');
const root = path.resolve(__dirname,'..');

test('paths retain standalone/legacy locations and isolate the core runner parent', t=>{
  const directory=temporary('workflow-paths-');t.after(()=>removeTemporary(directory));
  const app=path.join(directory,'engine');fs.mkdirSync(path.join(app,'src'),{recursive:true});
  fs.copyFileSync(path.join(root,'src/paths.js'),path.join(app,'src/paths.js'));
  function read(){const result=spawnSync(process.execPath,['-e',`console.log(JSON.stringify(require(process.argv[1])))`,path.join(app,'src/paths.js')],{cwd:directory,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
  // Dummy parent runner config is never selected by ordinary core workspace layout.
  fs.writeFileSync(path.join(directory,'.env'),'DUMMY_PARENT_CONFIG=not-engine');
  fs.mkdirSync(path.join(directory,'data/agent'),{recursive:true});
  assert.equal(read().envFile,path.join(app,'.env'));
  assert.equal(read().dataDir,path.join(app,'data'));
  fs.writeFileSync(path.join(directory,'local-agent.js'),'// dummy legacy launcher');
  assert.equal(read().envFile,path.join(directory,'.env'));
  assert.equal(read().dataDir,path.join(directory,'data/agent'));
  fs.writeFileSync(path.join(app,'.env'),'DUMMY_LOCAL_CONFIG=engine');
  assert.equal(read().envFile,path.join(app,'.env'),'local env takes precedence without changing legacy data identity');
  fs.mkdirSync(path.join(directory,'scenarios'));assert.equal(read().scenariosDir,path.join(directory,'scenarios'));
});

test('standalone export is allowlisted, runtime-only locked, independent of ref, and refuses overwrites', t=>{
  const directory=temporary('workflow-package-');t.after(()=>removeTemporary(directory));
  const output=path.join(directory,'engine');exportStandalone(output);
  const lock=JSON.parse(fs.readFileSync(path.join(output,'package-lock.json')));
  const pkg=JSON.parse(fs.readFileSync(path.join(output,'package.json')));
  assert.equal(pkg.type,'commonjs');assert.equal(pkg.dependencies.mongodb,'7.7.0');assert.equal(pkg.devDependencies,undefined);
  assert.equal(lock.packages['node_modules/mongodb'].version,'7.7.0');
  assert(!Object.keys(lock.packages).some(k=>k.includes('playwright')));
  for(const forbidden of ['.env','data','tools','node_modules','test'])assert(!fs.existsSync(path.join(output,forbidden)));
  assert(fs.existsSync(path.join(output,'.env.example')));
  assert.throws(()=>exportStandalone(output),/never overwritten/);
  for(const file of JSON.parse(fs.readFileSync(path.join(root,'package-files.json'))).filter(f=>f.endsWith('.js'))){
    const content=fs.readFileSync(path.join(output,file),'utf8');
    assert(!/require\(['"][^'"]*\bref\//.test(content),file+' must not import ref');
  }
  // Export remains possible from a standalone artifact using its own runtime lock.
  exportStandalone(path.join(directory,'second'),{source:output});
});

test('export preflight rejects secret paths and traversal before creating output',t=>{
  const directory=temporary('workflow-package-reject-');t.after(()=>removeTemporary(directory));
  const source=path.join(directory,'source');fs.mkdirSync(source);
  const output=path.join(directory,'output');
  fs.writeFileSync(path.join(source,'package-files.json'),JSON.stringify(['.env']));
  assert.throws(()=>exportStandalone(output,{source}),/Forbidden package entry/);assert(!fs.existsSync(output));
  fs.writeFileSync(path.join(source,'package-files.json'),JSON.stringify(['../escape']));
  assert.throws(()=>exportStandalone(output,{source}),/Invalid package entry/);assert(!fs.existsSync(output));
});

test('extension ZIP includes only five runtime files, never incidental secrets', {skip:process.platform!=='win32'},t=>{
  const directory=temporary('workflow-extension-');t.after(()=>removeTemporary(directory));
  const extension=path.resolve(root,'../chrome-reels-extension');
  // An incidental dummy file in the output folder must not be swept into the ZIP.
  fs.writeFileSync(path.join(directory,'secret.pem'),'dummy fixture, not a key');
  const result=spawnSync('powershell.exe',['-NoProfile','-File',path.join(extension,'package.ps1'),'-OutputDirectory',directory],{encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
  const archive=fs.readdirSync(directory).find(f=>f.endsWith('.zip'));assert(archive);
  const list=spawnSync('powershell.exe',['-NoProfile','-Command','Add-Type -AssemblyName System.IO.Compression.FileSystem; $taskArchive=[IO.Compression.ZipFile]::OpenRead($env:WORKFLOW_FIXTURE_ARCHIVE); try { $taskArchive.Entries.FullName | ConvertTo-Json -Compress } finally { $taskArchive.Dispose() }'],{encoding:'utf8',env:{...process.env,WORKFLOW_FIXTURE_ARCHIVE:path.join(directory,archive)},windowsHide:true});
  assert.equal(list.status,0,list.stderr);
  assert.deepEqual(JSON.parse(list.stdout).sort(),['background.js','content.js','manifest.json','options.html','options.js']);
});

test('explicit legacy migration refuses a running engine/collisions and preserves fixture machine identity', {skip:process.platform!=='win32'},async t=>{
  const directory=temporary('workflow-migration-');t.after(()=>removeTemporary(directory));
  const app=path.join(directory,'engine');fs.mkdirSync(path.join(app,'scripts'),{recursive:true});
  const script=path.join(app,'scripts/migrate-legacy.ps1');fs.copyFileSync(path.join(root,'scripts/migrate-legacy.ps1'),script);
  fs.writeFileSync(path.join(directory,'local-agent.js'),'// dummy legacy launcher');
  fs.mkdirSync(path.join(directory,'data/agent'),{recursive:true});fs.writeFileSync(path.join(directory,'data/agent/machine_id.txt'),'fixture-machine-id');
  fs.mkdirSync(path.join(directory,'scenarios'));fs.writeFileSync(path.join(directory,'scenarios/custom.json'),'{}');
  const server=require('node:http').createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  fs.writeFileSync(path.join(directory,'.env'),'LOCAL_AGENT_PORT='+port+'\nDUMMY_SETTING=fixture\n');
  function migrate(){return spawnSync('powershell.exe',['-NoProfile','-File',script],{encoding:'utf8',windowsHide:true,env:{...process.env,LOCAL_AGENT_PORT:String(port)}});}
  try { const busy=migrate();assert.notEqual(busy.status,0);assert.match(busy.stderr,/Stop the local agent/); }
  finally { await new Promise(resolve=>server.close(resolve)); }
  fs.mkdirSync(path.join(app,'data'));
  const collision=migrate();assert.notEqual(collision.status,0);assert.match(collision.stderr,/destination exists/);
  assert(fs.existsSync(path.join(directory,'.env')),'preflight failure must not perform the first move');
  assert(!fs.existsSync(path.join(app,'.env')));
  fs.rmdirSync(path.join(app,'data')); // Empty directory inside the verified temp fixture only.
  const migrated=migrate();assert.equal(migrated.status,0,migrated.stderr);
  assert.equal(fs.readFileSync(path.join(app,'data/machine_id.txt'),'utf8'),'fixture-machine-id');
  assert(fs.existsSync(path.join(app,'scenarios/custom.json')));
  assert(!fs.existsSync(path.join(directory,'.env')));
});

const fs = require('node:fs');
const path = require('node:path');

const engineRoot = path.resolve(__dirname, '..');

function standaloneLock(pkg, workspaceLock) {
  const packages = { '': { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies, engines: pkg.engines } };
  function include(name, parent = '') {
    let current = parent, key;
    while (true) {
      const candidate = (current ? current + '/' : '') + 'node_modules/' + name;
      if (workspaceLock.packages[candidate]) { key = candidate; break; }
      if (!current) throw new Error('Runtime dependency absent from root lock: ' + name);
      current = path.posix.dirname(current);
      if (current === '.') current = '';
    }
    if (packages[key]) return;
    const { dev, devOptional, ...entry } = workspaceLock.packages[key];
    packages[key] = entry;
    for (const dependency of Object.keys(entry.dependencies || {})) include(dependency, key);
    for (const dependency of Object.keys(entry.optionalDependencies || {})) {
      // Optional dependencies present in this lock are copied; none are resolved online.
      try { include(dependency, key); } catch (error) {
        if (!error.message.startsWith('Runtime dependency absent')) throw error;
      }
    }
  }
  for (const name of Object.keys(pkg.dependencies || {})) include(name);
  return { name: pkg.name, version: pkg.version, lockfileVersion: 3, requires: true, packages };
}

function exportStandalone(output, { source = engineRoot, lockFile = fs.existsSync(path.join(source, 'package-lock.json')) ? path.join(source, 'package-lock.json') : path.resolve(source, '../../package-lock.json') } = {}) {
  const destination = path.resolve(output);
  if (fs.existsSync(destination)) throw new Error('Output must be a new directory; existing installations are never overwritten');
  const files = JSON.parse(fs.readFileSync(path.join(source, 'package-files.json'), 'utf8'));
  const prepared = files.map(file => {
    if (typeof file !== 'string' || file.includes('\\') || file.split('/').some(part => !part || part === '..' || part === '.')) throw new Error('Invalid package entry');
    if (file !== '.env.example' && /(^|\/)(\.env[^/]*|data|tools|node_modules|test|dist|credentials[^/]*|.*\.(pem|key|crx|sqlite[^/]*))($|\/)/i.test(file)) throw new Error('Forbidden package entry: ' + file);
    const input = path.join(source, file);
    let checked = source;
    for (const part of file.split('/')) { checked = path.join(checked, part); if (fs.lstatSync(checked).isSymbolicLink()) throw new Error('Linked package entry'); }
    if (!fs.statSync(input).isFile()) throw new Error('Package entry must be a file');
    return { file, bytes: fs.readFileSync(input) };
  });
  const pkg = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  delete pkg.devDependencies;
  delete pkg.scripts.test;
  delete pkg.scripts['test:browser'];
  const lock = standaloneLock(pkg, JSON.parse(fs.readFileSync(lockFile, 'utf8')));
  fs.mkdirSync(destination, { recursive: true });
  for (const {file, bytes} of prepared) { const target = path.join(destination, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  fs.writeFileSync(path.join(destination, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
  return destination;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 2 || args[0] !== '--output') throw new Error('Usage: npm run package:workflow -- --output ABSOLUTE_NEW_DIRECTORY');
    console.log('Standalone engine: ' + exportStandalone(args[1]));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { exportStandalone, standaloneLock };

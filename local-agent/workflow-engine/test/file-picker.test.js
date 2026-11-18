const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const { chooseFile } = require('../src/integrations/chrome/file-picker');

function fakeLaunch(output, code = 0) {
  return (command, args, options) => {
    assert.equal(command, 'powershell.exe');
    assert(args.includes('-STA'));
    assert.equal(options.windowsHide, true, 'hide PowerShell console while keeping the file dialog');
    assert.equal(args.at(-1), 'C:\\Uploads');
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdout.setEncoding = () => {};
    child.stderr.setEncoding = () => {};
    queueMicrotask(() => {
      child.stdout.emit('data', output);
      child.emit('close', code);
    });
    return child;
  };
}

test('file picker rejects unsupported platforms without launching a native dialog', {
  skip: process.platform === 'win32',
}, async () => {
  let launched = false;
  await assert.rejects(chooseFile('C:\\Uploads', () => { launched = true; }), /File picker requires Windows/);
  assert.equal(launched, false);
});

test('Windows file picker returns selection or cancellation', {skip: process.platform !== 'win32'}, async () => {
  assert.equal(await chooseFile('C:\\Uploads', fakeLaunch('C:\\Uploads\\ảnh.jpg\n')), 'C:\\Uploads\\ảnh.jpg');
  assert.equal(await chooseFile('C:\\Uploads', fakeLaunch('')), null);
});

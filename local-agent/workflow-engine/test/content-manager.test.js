const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');

const { createActivityStore } = require('../src/storage/activity-store');
const { createMongoSync } = require('../src/integrations/mongo/mongo-sync');
const { createContentApi } = require('../src/http/content-api');
const { createWorkflows } = require('../src/workflow/workflows');
const { createScenarioStore } = require('../src/workflow/scenario-store');
const { createMemoryMongo } = require('./helpers/memory-mongo');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(test) { for (let i = 0; i < 100 && !test(); i++) await tick(); assert(test()); }

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'content-manager-'));
  let mongo, server, browser;
  try {
    const memory = createMemoryMongo(), activity = createActivityStore(path.join(temp, 'activity'));
    const filePath = path.join(temp, 'clip.mp4'); fs.writeFileSync(filePath, 'fixture bytes');
    const pageId = randomUUID(), page = { _id: pageId, name: 'Shared Page', name_key: 'shared page', platform: 'Facebook', platform_key: 'facebook', url: 'https://example.test/shared', active: true, updated_at: new Date('2026-10-22T03:00:00Z'), external_field: 'preserve' };
    memory.db.collection('pages').seed(page);
    const workflows = createWorkflows({ scenarios: createScenarioStore(temp), defaultProfile: 'A', profiles: () => [{ directory: 'A' }], activity });
    const session = workflows.connect({ profile: 'A', clientId: 'fixture' });
    const run = workflows.start('A', { name: 'offline-upload', steps: [
      { action: 'upload', filePath, selector: '#upload', pageName: page.name, pageUrl: page.url, platform: 'Facebook', publicationDesc: 'Original description' },
      { action: 'wait', ms: 5000 }
    ] });
    await until(() => !session.localPending);
    const job = workflows.next(session); workflows.result(session, { runId: run.runId, id: job.step.id, ok: true, actionUrl: 'https://example.test/composer' });
    const oldPageId = session.steps[0].upload.page_id;
    assert.notEqual(oldPageId, pageId);
    const file = await activity.registerFile(filePath);
    activity.rememberDownload('https://example.test/video', { title: 'Clip.* literal', id: 'video', filePath, name: 'clip.mp4', verified: true, duration: 3 }, file);
    mongo = createMongoSync(activity, { client: memory.client });
    await mongo.flush();
    assert.equal(mongo.status().connected, true);
    assert.deepEqual([...memory.databases], ['team_content']);
    assert.equal(memory.db.collection('pages').all().length, 1, 'existing shared page must not be duplicated');
    assert.equal(session.steps[0].upload.page_id, pageId, 'live run must follow canonical shared UUID');
    workflows.stop('A');
    assert.equal(activity.readRun(run.runId).steps[0].upload.page_id, pageId);
    assert.equal(activity.data.pages[oldPageId], undefined);
    assert.equal(memory.db.collection('publications').all()[0].page_id, pageId);
    assert.equal(memory.db.collection('upload_events').all()[0].page_id, pageId);
    assert.equal(memory.db.collection('downloads').all()[0].source_url, 'https://example.test/video');
    assert(memory.db.collection('downloads').all()[0].downloaded_at instanceof Date);
    await mongo.flush(); // persist the cancellation after the remapped live run

    async function readBody(request) { let body = ''; for await (const chunk of request) body += chunk; return JSON.parse(body); }
    const content = createContentApi({ mongo, activity, readBody });
    const step = { pageId, pageName: 'Old name', platform: 'Old platform' };
    await content.prepareUpload(step); assert.equal(step.pageName, page.name); assert.equal(step.pageUrl, page.url);
    await memory.db.collection('pages').updateOne({ _id: pageId }, { $set: { active: false } });
    await assert.rejects(content.prepareUpload({ pageId }), /ngừng hoạt động/);
    await memory.db.collection('pages').updateOne({ _id: pageId }, { $set: { active: true } });
    memory.setOffline(true);
    await assert.rejects(content.prepareUpload({ pageId }), failure => failure.status === 503 && !failure.message.includes('credentials'));
    const gated = createWorkflows({ scenarios: createScenarioStore(temp), defaultProfile: 'B', profiles: () => [{ directory: 'B' }], activity, prepareUpload: content.prepareUpload });
    const gatedSession = gated.connect({ profile: 'B', clientId: 'gated' });
    const gatedRun = gated.start('B', { steps: [{ action: 'upload', selector: '#upload', filePath, pageId }] });
    await until(() => !gatedSession.running);
    assert.equal(gated.next(gatedSession).step, null, 'Mongo preflight failure must not send a browser upload');
    assert.equal(gated.getRun(gatedRun.runId).steps[0].state, 'failed');
    memory.setOffline(false); await mongo.ping();
    server = http.createServer(async (request, response) => {
      const json = (status, data) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
      if (request.url === '/content') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(fs.readFileSync(path.join(__dirname, '../dashboard/content.html'), 'utf8').replaceAll('__LOCAL_AGENT_DASHBOARD_TOKEN__', 'fixture-session')); return; }
      try { await content.handle(request, new URL(request.url, 'http://localhost'), json); }
      catch (failure) { json(failure.status || 400, { error: failure.message }); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    async function api(route, body, method = body ? 'POST' : 'GET', expected = 200) {
      const response = await fetch(base + '/api/content' + route, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data)); return data;
    }
    assert.equal((await api('/status')).database, 'team_content');
    assert.equal((await api('/summary')).counts.pages, 1);
    assert.equal((await api('/catalog/publications')).rows[0].page.name, 'Shared Page');
    assert.equal((await api('/catalog/pages')).rows[0].external_field, undefined, 'return only the documented catalog fields');
    assert.equal((await api('/catalog/downloads?q=' + encodeURIComponent('.*'))).total, 1);
    assert.equal((await api('/catalog/downloads?q=' + encodeURIComponent('[bad'))).total, 0, 'escape regex syntax in search');
    await api('/catalog/users', undefined, 'GET', 404);
    await api('/catalog/pages?limit=51', undefined, 'GET', 400);
    await api('/catalog/pages?offset=-1', undefined, 'GET', 400);
    await api('/catalog/pages?active=bad', undefined, 'GET', 400);
    await api('/pages', { name: { $ne: '' }, platform: 'Facebook' }, 'POST', 400);
    await api('/pages', { name: page.name, platform: page.platform }, 'POST', 409);
    const created = await api('/pages', { name: ' Straße ', platform: ' Facebook ', url: 'https://example.test/new' }, 'POST', 201);
    assert.equal(created.name_key, 'strasse'); assert.equal(created.platform_key, 'facebook');
    const updated = await api('/pages/' + pageId, { name: 'Shared Page', url: page.url, platform: 'Facebook', active: true, expectedUpdatedAt: page.updated_at.toISOString() }, 'PATCH');
    assert.equal(updated.external_field, undefined, 'mutation response returns only contract fields');
    assert.equal(memory.db.collection('pages').all()[0].external_field, 'preserve', 'editing known fields preserves other service fields');
    await api('/pages/' + pageId, { active: false, expectedUpdatedAt: page.updated_at.toISOString() }, 'PATCH', 409);
    const publication = memory.db.collection('publications').all()[0];
    await api('/publications/' + publication._id, { published_at: '2026-10-22' }, 'PATCH', 400);
    const dateWithPrecision = '2026-10-22T03:00:12.345Z';
    await api('/publications/' + publication._id, { desc: 'External description', published_at: dateWithPrecision, post_url: 'https://example.test/post' }, 'PATCH');
    const storedPublication = memory.db.collection('publications').all()[0];
    assert.equal(storedPublication._id, publication._id); assert(storedPublication.published_at instanceof Date);
    // A retry of the local original import must preserve the external publication edits.
    activity.recordUpload({ pageId, pageName: page.name, platform: 'Facebook', pageUrl: page.url, publicationDesc: 'Should not overwrite' }, file, { runId: randomUUID(), index: 0 });
    await mongo.flush(); assert.equal(memory.db.collection('publications').all()[0].desc, 'External description');
    for (let i = 0; i < 28; i++) memory.db.collection('downloads').seed({ _id: randomUUID(), title: 'Fixture ' + i, source_url: 'https://example.test/' + i, downloaded_at: new Date(1700000000000 + i) });
    memory.db.collection('downloads').seed({ _id: randomUUID(), title: '<img src=x onerror="window.attacked=true">', downloaded_at: new Date('2026-10-22T04:00:00Z') });

    console.log('Content catalog, page reconciliation, conflicts, BSON dates and pagination: OK');
  } finally {

    if (server) await new Promise(resolve => server.close(resolve));
    await mongo?.close();
    if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir())) throw new Error('Unexpected fixture directory');
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(failure => { console.error(failure); process.exitCode = 1; });

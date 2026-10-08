import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../static/js/library.js', import.meta.url), 'utf8');
function code(name) {
    const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?\\n  \\}`));
    assert.ok(match, `Missing function ${name}`);
    return match[0];
}
function context(href, values = {}) {
    return vm.createContext({URL, URLSearchParams, window: {location: {href,
        pathname: '/library/', origin: 'https://jmonkeyengine.org'}}, ...values});
}

test('module links use latest by default and preserve explicitly pinned snapshots', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(code('moduleDetailUrl'), ctx);
    assert.equal(vm.runInContext('moduleDetailUrl(42)', ctx), 'https://jmonkeyengine.org/library/?module=42&snapshot=latest');
    assert.equal(vm.runInContext('moduleDetailUrl(42, 1927)', ctx), 'https://jmonkeyengine.org/library/?module=42&snapshot=1927');
});

for (const snapshot of ['latest', '1927', null]) {
    test(`reload opens the requested module and snapshot (${snapshot ?? 'unspecified'}) independently of the catalog page`, async () => {
        const href = `https://jmonkeyengine.org/library/?module=216200609${snapshot ? `&snapshot=${snapshot}` : ''}`;
        const paths = [], opened = [];
        const ctx = context(href, {
            state: {adminSession: false, items: [{githubRepositoryId: 216200609, snapshotId: 1}]},
            fetchJson: async (path) => { paths.push(path); return {githubRepositoryId: 216200609, snapshotId: 1927}; },
            openDetail: async (...args) => opened.push(args), showStatus: () => assert.fail('Unexpected error')
        });
        vm.runInContext(`${code('moduleApiPath')}\n${code('openRequestedModule')}`, ctx);
        await vm.runInContext('openRequestedModule(false)', ctx);
        assert.deepEqual(paths, [snapshot === '1927' ? '/api/extensions/216200609/snapshots/1927' : '/api/extensions/216200609']);
        assert.equal(opened.length, 1);
        assert.equal(opened[0][0].snapshotId, 1927);
        assert.equal(opened[0][3], snapshot || 'latest');
    });
}

test('restoring an admin session never removes the current module, snapshot or catalog page', async () => {
    const href = 'https://jmonkeyengine.org/library/?module=216200609&snapshot=1927&page=2';
    const state = {adminSession: false, page: 1};
    const ctx = context(href, {state, moderationResult: null,
        fetchJson: async () => ({authenticated: true, login: 'member', csrfToken: 'csrf'}),
        updateAdminUi() {}, showAdminFeedback() {},
        syncCatalogUrl: () => assert.fail('Admin restoration must not rewrite the URL'),
        loadModules: () => assert.fail('Startup controls catalog loading')});
    vm.runInContext(code('restoreAdminSession'), ctx);
    await vm.runInContext('restoreAdminSession()', ctx);
    assert.equal(state.adminSession, true);
    assert.equal(state.page, 1);
    assert.equal(ctx.window.location.href, href);
});

test('admin module detail requests use authenticated routes, not the public catalog', () => {
    const ctx = context('https://jmonkeyengine.org/library/', {state: {adminSession: true}});
    vm.runInContext(code('moduleApiPath'), ctx);
    assert.equal(vm.runInContext('moduleApiPath(42)', ctx), '/admin/extensions/42');
    assert.equal(vm.runInContext('moduleApiPath(42, 1927)', ctx), '/admin/extensions/42/snapshots/1927');
});

test('module card titles are real links and confidence effects have no repeated prefix', () => {
    assert.match(code('renderCard'), /node\("a", "library-card-open"/);
    assert.match(code('renderCard'), /event\.button !== 0/);
    assert.match(code('renderCard'), /addEventListener\("auxclick"/);
    assert.doesNotMatch(code('openScoreDialog'), /`confidence \$\{/);
    assert.match(code('openScoreDialog'), /heading\.append\(title, effects\)/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const build = process.env.LIBRARY_BROWSER_BUILD;
const playwrightModule = process.env.PLAYWRIGHT_MODULE;

test('Library browser navigation, moderation, score layout and independent scrolling', {
    skip: !build || !playwrightModule ? 'Set LIBRARY_BROWSER_BUILD and PLAYWRIGHT_MODULE for the browser regression suite' : false,
    timeout: 90000
}, async () => {
    const {chromium} = await import(pathToFileURL(playwrightModule).href);
    const root = resolve(build);
    const server = createServer((request, response) => {
        const path = resolve(root, `.${new URL(request.url, 'http://localhost').pathname}`);
        const file = path.endsWith(sep) || !extname(path) ? resolve(path, 'index.html') : path;
        if (!file.startsWith(root + sep) || !existsSync(file)) { response.writeHead(404).end(); return; }
        const types = {'.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'};
        response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
        response.end(readFileSync(file));
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({headless: true});
    const errors = [];
    const fixture = {
        githubRepositoryId: 216200609, snapshotId: 1927, name: 'Blocks', displayName: 'Blocks',
        owner: 'rvandoosselaer', repositoryUrl: 'https://github.com/rvandoosselaer/Blocks',
        description: 'A community module.', readmeIncluded: true, readmeMarkdown: '# Blocks\n\nExample documentation.',
        stars: 20, likes: 1, processingStatus: 'COMPLETED', moderationState: 'AUTO', visibilityDecision: 'NEEDS_REVIEW',
        topics: [], platforms: [], pendingChecks: [], images: [], artifacts: [], funding: [],
        rootArtifact: {groupId: 'org.example', artifactId: 'blocks', version: '1.0', registry: 'MAVEN_CENTRAL'},
        score: {score: 0, confidence: 70, decision: 'NEEDS_REVIEW', hardGateFailures: [], warnings: [],
            breakdown: [
                {name: 'github-author-trust', scope: 'root', status: 'PASS', scoreDelta: 26, confidenceDelta: -30, message: 'Author trust'},
                {name: 'artifact-baseline', scope: 'root', status: 'PASS', scoreDelta: 0, confidenceDelta: 0, message: 'Artifact baseline'}
            ]}
    };
    async function createContext(admin) {
        const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
        const posts = [];
        let moderation = 'AUTO';
        const item = (snapshot = 1927) => ({...structuredClone(fixture), snapshotId: snapshot, moderationState: moderation,
            visibilityDecision: moderation === 'LISTED' ? 'LISTED' : 'NEEDS_REVIEW'});
        await context.route('https://bknd01.jmonkeyengine.org/**', async route => {
            const request = route.request(), url = new URL(request.url());
            const headers = {'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Credentials': 'true',
                'Access-Control-Allow-Headers': 'Content-Type,X-CSRF-Token,Accept', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'};
            const send = (body, status = 200) => route.fulfill({status, headers, contentType: 'application/json', body: JSON.stringify(body)});
            if (request.method() === 'OPTIONS') return route.fulfill({status: 204, headers});
            if (url.pathname === '/admin/session') return send(admin
                ? {authenticated: true, login: 'member', csrfToken: 'test-csrf'} : {message: 'Login required'}, admin ? 200 : 401);
            if (url.pathname.endsWith('/moderation')) {
                assert.equal(request.headers()['x-csrf-token'], 'test-csrf');
                const body = request.postDataJSON(); posts.push(body); moderation = body.state; return send(item());
            }
            if (url.pathname.endsWith('/snapshots')) return send({items: [
                {snapshotId: 2000, version: 'Pending', processingStatus: 'PENDING', published: false},
                {snapshotId: 1927, version: '1.0', processingStatus: 'COMPLETED', decision: 'NEEDS_REVIEW', published: true},
                {snapshotId: 1808, version: '0.9', processingStatus: 'COMPLETED', decision: 'LISTED', published: true}
            ]});
            if (/\/extensions\/216200609(?:\/snapshots\/\d+)?$/.test(url.pathname)) {
                const specific = url.pathname.match(/\/snapshots\/(\d+)$/); return send(item(specific ? Number(specific[1]) : 1927));
            }
            if (url.pathname.endsWith('/tags')) return send({items: []});
            if (url.pathname.endsWith('/stats')) return send({modules: 1, developers: 1});
            const items = url.searchParams.get('q') === 'no-matches' ? [] : [item()];
            return send({items, page: 0, totalPages: items.length, totalItems: items.length});
        });
        context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
        return {context, posts};
    }
    try {
        const {context} = await createContext(false);
        const page = await context.newPage();
        await page.goto(`${base}/library/?module=216200609&snapshot=1927`);
        await page.locator('.library-detail-header h1').waitFor();
        assert.match(page.url(), /snapshot=1927/);
        await page.reload();
        await page.locator('.library-detail-header h1').waitFor();
        assert.match(page.url(), /module=216200609&snapshot=1927/);
        await page.locator('.library-snapshot-select').selectOption('1808');
        await page.waitForURL(/snapshot=1808/);
        await page.locator('.library-snapshot-select').selectOption('latest');
        await page.waitForURL(/snapshot=latest/);
        await page.locator('.library-back').click();
        await page.locator('.library-card-open').waitFor();
        const newTabPromise = context.waitForEvent('page');
        await page.locator('.library-card-open').click({button: 'middle'});
        const newTab = await newTabPromise;
        await newTab.locator('.library-detail-header h1').waitFor();
        assert.match(newTab.url(), /module=216200609&snapshot=latest/);
        await newTab.close();

        await page.locator('#library-search').fill('no-matches');
        await page.locator('.library-empty').waitFor();
        const empty = await page.locator('.library-empty').evaluate(element => {
            const style = getComputedStyle(element), box = element.getBoundingClientRect(), grid = element.parentElement.getBoundingClientRect();
            return {background: style.backgroundColor, border: style.borderTopWidth, center: style.textAlign,
                offset: Math.abs((box.left + box.width / 2) - (grid.left + grid.width / 2))};
        });
        assert.equal(empty.background, 'rgba(0, 0, 0, 0)'); assert.equal(empty.border, '0px');
        assert.equal(empty.center, 'center'); assert.ok(empty.offset < 1);
        await context.close();

        const adminFixture = await createContext(true);
        const admin = await adminFixture.context.newPage();
        await admin.goto(`${base}/library/?module=216200609&snapshot=1927`);
        await admin.locator('.library-moderation').waitFor();
        assert.match(admin.url(), /snapshot=1927/);
        assert.equal(await admin.locator('.library-detail-aside > :first-child').getAttribute('class'), 'library-moderation');
        await admin.locator('.library-moderation button').filter({hasText: /^List$/}).click();
        await admin.getByText('Saved. Current state: LISTED.').waitFor();
        assert.deepEqual(adminFixture.posts, [{state: 'LISTED'}]);
        assert.match(admin.url(), /snapshot=1927/);
        await admin.reload();
        await admin.locator('.library-moderation').waitFor();
        assert.match(admin.url(), /snapshot=1927/);

        await admin.locator('.library-detail-header .library-score').click();
        await admin.locator('#library-score-dialog[open]').waitFor();
        const effects = admin.locator('.library-score-effects').first();
        assert.equal(await effects.locator('.library-score-delta').textContent(), '+26');
        assert.equal(await effects.locator('.library-score-confidence').textContent(), '-30');
        const upper = await effects.locator('.library-score-delta').boundingBox();
        const lower = await effects.locator('.library-score-confidence').boundingBox();
        assert.ok(upper.y < lower.y); assert.ok(Math.abs((upper.x + upper.width) - (lower.x + lower.width)) < 1);
        if (process.env.LIBRARY_BROWSER_SCREENSHOT) await admin.screenshot({path: process.env.LIBRARY_BROWSER_SCREENSHOT});
        await admin.locator('#library-score-dialog .library-dialog-close').click();

        await admin.locator('.library-detail-aside').evaluate(element => {
            const spacer = document.createElement('div'); spacer.style.height = '2000px'; element.append(spacer);
        });
        await admin.locator('.library-detail-aside').hover();
        const pageScroll = await admin.evaluate(() => window.scrollY);
        await admin.mouse.wheel(0, 350);
        await admin.waitForFunction(() => document.querySelector('.library-detail-aside').scrollTop > 100);
        assert.equal(await admin.evaluate(() => window.scrollY), pageScroll);
        await admin.setViewportSize({width: 640, height: 900});
        assert.equal(await admin.locator('.library-detail-aside').evaluate(element => getComputedStyle(element).maxHeight), 'none');
        assert.deepEqual(errors, []);
        await adminFixture.context.close();
    } finally {
        await browser.close();
        await new Promise(done => server.close(done));
    }
});

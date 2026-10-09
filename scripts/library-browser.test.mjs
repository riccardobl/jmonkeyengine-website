import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {resolve, extname, sep} from 'node:path';
import {pathToFileURL} from 'node:url';

const build = process.env.LIBRARY_BROWSER_BUILD;
const playwrightModule = process.env.PLAYWRIGHT_MODULE;

test('Library browser combined installation recipes, navigation, moderation and score layout', {
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
    const snippet = coordinate => `repositories {\n    mavenCentral()\n}\n\ndependencies {\n    implementation("${coordinate}")\n}`;
    const fixture = {
        githubRepositoryId: 216200609, snapshotId: 1927, name: 'Blocks', displayName: 'Blocks',
        owner: 'rvandoosselaer', repositoryUrl: 'https://github.com/rvandoosselaer/Blocks',
        description: 'A community module.', readmeIncluded: true, readmeMarkdown: '# Blocks\n\nExample documentation.',
        stars: 20, likes: 1, processingStatus: 'COMPLETED', moderationState: 'AUTO', visibilityDecision: 'NEEDS_REVIEW',
        compatibility: {recommended: '3.9.0-stable'},
        topics: [], platforms: [], pendingChecks: [], images: [], artifacts: [], funding: [],
        rootArtifact: {groupId: 'org.example', artifactId: 'blocks', version: '1.0', registry: 'MAVEN_CENTRAL'},
        publication: {listed: true, snapshotId: 1808},
        gradleSnippet: snippet('org.example:blocks:1.0'),
        installation: {status: 'AVAILABLE', validation: 'METADATA_ONLY', observedJmeVersion: '3.9.0-stable',
            note: 'Published metadata only; a consumer build has not been verified.'},
        installationOptions: [
            {artifact: {artifactId: 'blocks', version: '1.0'}, target: 'JVM', gradleSnippet: snippet('org.example:blocks:1.0')},
            {artifact: {artifactId: 'blocks-tools', version: '1.0'}, target: 'JVM', gradleSnippet: snippet('org.example:blocks-tools:1.0')},
            {artifact: {artifactId: 'blocks-android', version: '1.0'}, target: 'ANDROID', gradleSnippet: snippet('org.example:blocks-android:1.0')},
            {artifact: {artifactId: 'blocks-ios', version: '1.0'}, target: 'JVM', platforms: [{operatingSystem: 'IOS', architectures: ['ARM64']}],
                platformSource: 'YAML', platformsKnown: true, gradleSnippet: snippet('org.example:blocks-ios:1.0')},
            {artifact: {artifactId: 'blocks-linux', version: '1.0'}, target: 'JVM', platforms: [{operatingSystem: 'LINUX', architectures: ['X86_64']}],
                platformSource: 'INFERRED_NATIVE', platformsKnown: true, gradleSnippet: snippet('org.example:blocks-linux:1.0')},
            {artifact: {artifactId: 'unsupported', version: '1.0'}, target: 'JVM', platforms: [], platformsKnown: true,
                gradleSnippet: snippet('org.example:unsupported:1.0')},
            ...['WINDOWS', 'LINUX', 'MACOS'].map(operatingSystem => ({
                artifact: {artifactId: 'blocks-desktop', version: '1.0'}, platformsKnown: true,
                platforms: [{operatingSystem, architectures: ['X86_64']}],
                gradleSnippet: snippet('org.example:blocks-desktop:1.0')
            })),
            {artifact: {artifactId: 'blocks-shared', version: '1.0'}, platformsKnown: true,
                platforms: ['WINDOWS', 'LINUX', 'MACOS', 'ANDROID', 'IOS'].map(operatingSystem => ({operatingSystem})),
                gradleSnippet: snippet('org.example:blocks-shared:1.0')}
        ],
        score: {score: 0, confidence: 70, decision: 'NEEDS_REVIEW', hardGateFailures: [], warnings: [],
            breakdown: [
                {name: 'github-author-trust', scope: 'root', status: 'PASS', scoreDelta: 26, confidenceDelta: -30, message: 'Author trust'},
                {name: 'artifact-baseline', scope: 'root', status: 'PASS', scoreDelta: 0, confidenceDelta: 0, message: 'Artifact baseline'}
            ]}
    };
    async function createContext(admin, options = {}) {
        const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'clipboard', {value: {
                writeText: async text => { window.copiedSnippet = text; }
            }});
        });
        const posts = [];
        let moderation = options.initialModeration || 'AUTO';
        const latestId = () => options.archived || ['HIDDEN', 'BANNED', 'NEEDS_REVIEW'].includes(moderation)
            || options.score?.decision === 'REJECTED' ? null : moderation === 'LISTED' ? 1927 : 1808;
        const decision = snapshot => options.score?.decision === 'REJECTED' ? 'REJECTED'
            : snapshot === 1808 ? 'LISTED' : 'NEEDS_REVIEW';
        const visibility = snapshot => options.archived || ['HIDDEN', 'BANNED'].includes(moderation) ? 'HIDDEN'
            : decision(snapshot) === 'REJECTED' ? 'REJECTED' : moderation === 'AUTO' ? decision(snapshot) : moderation;
        const item = (snapshot = 1927) => ({...structuredClone(fixture), snapshotId: snapshot, moderationState: moderation,
            repositoryArchived: Boolean(options.archived),
            visibilityDecision: visibility(snapshot),
            publication: {listed: latestId() != null, snapshotId: latestId()},
            rootArtifact: {...fixture.rootArtifact, version: snapshot === 1808 ? '0.9' : '1.0'},
            ...(options.brokenRecipe ? {gradleSnippet: null, installationOptions: [], installation: {status: 'UNAVAILABLE'},
                analysisErrors: ['A required published artifact is unavailable.']} : {}),
            ...(options.score ? {score: structuredClone(options.score)} : {}),
            ...(options.pending ? {processingStatus: 'PENDING', pendingChecks: []} : {}),
            ...(options.legacyRecipe ? {installationOptions: undefined} : {})});
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
                const body = request.postDataJSON(); posts.push(body);
                if (!options.ignoreModeration) moderation = body.state;
                return send(item());
            }
            if (url.pathname.endsWith('/snapshots')) return send({latestSnapshotId: latestId(), items: [
                {snapshotId: 2000, version: 'Pending', processingStatus: 'PENDING', published: false},
                {snapshotId: 1927, version: '1.0', processingStatus: 'COMPLETED', decision: 'NEEDS_REVIEW', visibilityDecision: visibility(1927), published: true},
                {snapshotId: 1808, version: '0.9', processingStatus: 'COMPLETED', decision: 'LISTED', visibilityDecision: visibility(1808), published: true}
            ]});
            if (/\/extensions\/216200609(?:\/snapshots\/\d+)?$/.test(url.pathname)) {
                const specific = url.pathname.match(/\/snapshots\/(\d+)$/);
                if (!specific && latestId() == null) return send({message: 'No approved version'}, 404);
                return send(item(specific ? Number(specific[1]) : latestId()));
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
        assert.equal(await page.locator('.library-detail-badges .library-state-chip').count(), 0);
        assert.equal(await page.locator('.library-detail-warning').count(), 1);
        const sidebar = page.locator('.library-detail-aside');
        assert.deepEqual(await sidebar.locator('.library-detail-facts dt').allTextContents(), ['Recommended jME', 'GitHub stars']);
        assert.deepEqual(await sidebar.locator('.library-detail-facts dd').allTextContents(), ['3.9.0-stable', '20']);
        assert.equal(await sidebar.locator('.library-like-privacy').count(), 0);
        assert.doesNotMatch(await sidebar.textContent(), /Likes use a random identifier|stored only in this browser/);
        assert.equal(await sidebar.locator('.library-detail-like [data-like-count]').textContent(), '1');
        assert.equal(await sidebar.getByRole('link', {name: 'Star on GitHub'}).getAttribute('href'), fixture.repositoryUrl);
        assert.equal(await page.locator('.library-snapshot-status').count(), 0);
        assert.doesNotMatch(await sidebar.textContent(), /Automatic assessment applies|Selected snapshot #|not necessarily a stable release/);
        assert.match(await page.locator('.library-snapshot-select option:checked').textContent(), /^1\.0 — Needs review/);
        assert.match(await page.locator('.library-snapshot-select option[value="latest"]').textContent(), /^0\.9/);
        assert.match(await page.locator('.library-install code').textContent(), /org.example:blocks:1.0/);
        const install = page.locator('.library-install');
        assert.equal(await install.locator('select').count(), 0);
        assert.equal(await install.locator('.library-install-note, .library-install-platform-note').count(), 0);
        const combined = await install.locator('code').textContent();
        assert.equal((combined.match(/dependencies \{/g) || []).length, 1);
        assert.equal((combined.match(/mavenCentral\(\)/g) || []).length, 1);
        assert.equal((combined.match(/implementation\(/g) || []).length, 7);
        assert.doesNotMatch(combined, /Remove dependencies for other platforms/);
        assert.doesNotMatch(combined, /unsupported/);
        assert.match(combined, /implementation\("org.example:blocks-desktop:1.0"\) \/\/ Windows, Linux, macOS/);
        assert.match(combined, /implementation\("org.example:blocks-shared:1.0"\) \/\/ Windows, Linux, macOS, Android, iOS/);
        assert.match(combined, /implementation\("org.example:blocks-android:1.0"\) \/\/ Android/);
        assert.match(combined, /implementation\("org.example:blocks-ios:1.0"\) \/\/ iOS/);
        await page.getByRole('button', {name: 'Copy Gradle snippet'}).click();
        assert.equal(await page.evaluate(() => window.copiedSnippet), combined);
        assert.match(page.url(), /snapshot=1927/);
        assert.match(page.url(), /snapshot=1927/);
        await page.reload();
        await page.locator('.library-detail-header h1').waitFor();
        assert.match(page.url(), /module=216200609&snapshot=1927/);
        await page.locator('.library-snapshot-selector .library-snapshot-select').selectOption('latest');
        await page.waitForURL(/snapshot=latest/);
        assert.match(await page.locator('.library-snapshot-select option:checked').textContent(), /^0\.9/);
        await page.reload();
        await page.locator('.library-detail-header h1').waitFor();
        assert.equal(await page.locator('.library-detail-warning').count(), 0);
        await page.locator('.library-snapshot-select').selectOption('1927');
        await page.waitForURL(/snapshot=1927/);
        await page.locator('.library-back').click();
        await page.locator('.library-card-open').waitFor();
        const newTabPromise = context.waitForEvent('page');
        await page.locator('.library-card-open').click({button: 'middle'});
        const newTab = await newTabPromise;
        await newTab.locator('.library-detail-header h1').waitFor();
        assert.match(newTab.url(), /module=216200609&snapshot=1927/);
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
        assert.deepEqual(await admin.locator('.library-detail-facts dt').allTextContents(), ['Recommended jME', 'GitHub stars']);
        assert.match(admin.url(), /snapshot=1927/);
        assert.equal(await admin.locator('.library-detail-aside > :first-child').getAttribute('class'), 'library-moderation');
        await admin.locator('.library-moderation button').filter({hasText: /^List$/}).click();
        await admin.getByText('Saved. Current state: LISTED.').waitFor();
        assert.deepEqual(adminFixture.posts, [{state: 'LISTED'}]);
        assert.match(admin.url(), /snapshot=1927/);
        assert.doesNotMatch(await admin.locator('.library-snapshot-select option:checked').textContent(), /Needs review/);
        assert.match(await admin.locator('.library-snapshot-select option[value="latest"]').textContent(), /^1\.0/);
        assert.equal(await admin.locator('.library-detail-warning').count(), 0);
        await admin.reload();
        await admin.locator('.library-moderation').waitFor();
        assert.match(admin.url(), /snapshot=1927/);
        await admin.locator('.library-snapshot-select').selectOption('latest');
        await admin.waitForURL(/snapshot=latest/);
        assert.match(await admin.locator('.library-snapshot-select option:checked').textContent(), /^1\.0/);
        await admin.reload();
        await admin.locator('.library-moderation').waitFor();
        assert.match(admin.url(), /snapshot=latest/);
        assert.doesNotMatch(await admin.locator('.library-snapshot-select').textContent(), /Needs review/);

        await admin.locator('.library-detail-header .library-score').click();
        await admin.locator('#library-score-dialog[open]').waitFor();
        const scoreDialog = admin.locator('#library-score-dialog');
        assert.equal(await scoreDialog.locator('.library-dialog-card > p').count(), 1);
        assert.equal(await scoreDialog.locator('.library-score-check').count(), 2);
        assert.equal(await scoreDialog.locator('.library-score-summary .library-detail-row').filter({hasText: 'Decision'}).locator('dd').textContent(), 'LISTED');
        assert.equal(await scoreDialog.locator('.library-score-legend, .library-score-explanation').count(), 0);
        assert.deepEqual(await scoreDialog.locator('.library-score-section > h3').allTextContents(), ['Module checks']);
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
        await admin.evaluate(async () => {
            await document.fonts.ready;
            await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
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

        const ignored = await createContext(true, {ignoreModeration: true});
        const ignoredPage = await ignored.context.newPage();
        await ignoredPage.goto(`${base}/library/?module=216200609&snapshot=1927`);
        await ignoredPage.locator('.library-moderation').waitFor();
        await ignoredPage.locator('.library-moderation button').filter({hasText: /^List$/}).click();
        await ignoredPage.getByText('The backend did not confirm the requested moderation state. No successful save was reported.').waitFor();
        assert.equal(await ignoredPage.getByText('Saved. Current state: LISTED.').count(), 0);
        await ignored.context.close();

        const archived = await createContext(true, {archived: true, initialModeration: 'LISTED'});
        const archivedPage = await archived.context.newPage();
        await archivedPage.goto(`${base}/library/?module=216200609&snapshot=1927`);
        await archivedPage.getByText('Current state: HIDDEN.').waitFor();
        assert.equal(await archivedPage.locator('.library-moderation button').filter({hasText: /^List$/}).isDisabled(), true);
        await archivedPage.locator('.library-detail').getByText('Repository archived on GitHub. Hidden from recommendations; historical snapshots remain available.').waitFor();
        assert.equal(await archivedPage.locator('.library-snapshot-select option[value="latest"]').count(), 0);
        await archived.context.close();

        const broken = await createContext(false, {brokenRecipe: true});
        const brokenPage = await broken.context.newPage();
        await brokenPage.goto(`${base}/library/?module=216200609&snapshot=latest`);
        await brokenPage.getByText('Install recipe unavailable', {exact: true}).waitFor();
        await brokenPage.locator('.library-install').getByText('A required published artifact is unavailable.', {exact: true}).waitFor();
        assert.equal(await brokenPage.locator('.library-install .library-copy-button').count(), 0);
        await broken.context.close();

        const legacy = await createContext(false, {legacyRecipe: true});
        const legacyPage = await legacy.context.newPage();
        await legacyPage.goto(`${base}/library/?module=216200609&snapshot=latest`);
        await legacyPage.locator('.library-install code').waitFor();
        assert.equal(await legacyPage.locator('.library-install select').count(), 0);
        assert.match(await legacyPage.locator('.library-install code').textContent(), /org.example:blocks:1.0/);
        assert.match(await legacyPage.locator('.library-install code').textContent(), /\/\/ JVM/);
        await legacy.context.close();

        const coordinate = 'org.example:blocks:1.0';
        const securityFinding = 'SQL injection risk in QueryStore.load(String), line 42.';
        const advisoryFinding = 'Possible null dereference in Blocks.update(), line 17.';
        const runtimeWarning = 'Reflective method lookup may fail at runtime.';
        const dependencyWarning = `Dependency vulnerability requires review: org.example:${'runtime'.repeat(16)}:1.0.`;
        const flagged = await createContext(false, {score: {...fixture.score, decision: 'REJECTED',
            hardGateFailures: ['spotbugs-high'], breakdown: [
                ...fixture.score.breakdown,
                {name: 'spotbugs-high', scope: 'root', coordinate, status: 'FAIL', scoreDelta: -35,
                    confidenceDelta: 0, message: 'Consumer-impacting security finding.'},
                {name: 'spotbugs-finding', scope: 'root', coordinate, status: 'FAIL', scoreDelta: 0,
                    confidenceDelta: 0, message: securityFinding},
                {name: 'spotbugs-advisory', scope: 'root', coordinate, status: 'WARN', scoreDelta: 0,
                    confidenceDelta: 0, message: advisoryFinding},
                {name: 'runtime-java-class-get-method', scope: 'root', coordinate, status: 'WARN',
                    scoreDelta: 0, confidenceDelta: -5, message: runtimeWarning},
                {name: 'osv', scope: 'dependency', coordinate: 'org.example:runtime:1.0', status: 'WARN',
                    scoreDelta: -25, confidenceDelta: -4, message: dependencyWarning}
            ]}});
        const flaggedPage = await flagged.context.newPage();
        await flaggedPage.goto(`${base}/library/?module=216200609&snapshot=1927`);
        await flaggedPage.locator('.library-detail-header .library-score').click();
        const flaggedDialog = flaggedPage.locator('#library-score-dialog[open]');
        await flaggedDialog.waitFor();
        assert.equal(await flaggedDialog.locator('.library-score-check').count(), 5);
        assert.deepEqual(await flaggedDialog.locator('.library-score-section > h3').allTextContents(),
            ['Blocking issues', 'Module checks', 'Dependencies']);
        const blocking = flaggedDialog.locator('.library-score-check--blocking');
        assert.equal(await blocking.count(), 1);
        assert.equal(await blocking.locator('.library-score-delta').textContent(), '-35');
        assert.equal(await blocking.locator('.library-score-spotbugs-findings li').textContent(), securityFinding);
        assert.equal(await blocking.locator('.library-score-spotbugs-advisory-list li').textContent(), advisoryFinding);
        assert.equal(await blocking.getByText('No score impact.', {exact: true}).count(), 1);
        const zeroWarning = flaggedDialog.locator('.library-score-check').filter({hasText: runtimeWarning});
        assert.equal(await zeroWarning.locator('.library-score-delta').textContent(), '0');
        assert.equal(await zeroWarning.locator('.library-score-confidence').textContent(), '-5');
        assert.equal(await flaggedDialog.locator('.library-score-dependency').getByText(dependencyWarning, {exact: true}).count(), 1);
        assert.equal(await flaggedDialog.locator('.library-score-check--positive').count(), 1);
        assert.equal(await flaggedDialog.locator('.library-score-legend, .library-score-explanation').count(), 0);
        await flaggedPage.setViewportSize({width: 390, height: 844});
        const mobileCards = await flaggedDialog.evaluate(dialog => {
            const form = dialog.querySelector('form'), formBox = form.getBoundingClientRect();
            return {scroll: form.scrollWidth, client: form.clientWidth,
                cardsFit: [...dialog.querySelectorAll('.library-score-check, .library-score-effects')].every(card => {
                    const box = card.getBoundingClientRect();
                    return box.left >= formBox.left && box.right <= formBox.right;
                })};
        });
        assert.ok(mobileCards.scroll <= mobileCards.client + 1);
        assert.equal(mobileCards.cardsFit, true);
        await flagged.context.close();

        for (const [options, message] of [
            [{pending: true}, 'Verification in progress.'],
            [{score: {...fixture.score, breakdown: []}}, 'No score breakdown is available.'],
            [{score: {...fixture.score, hardGateFailures: ['missing-root-coordinate'], breakdown: []}},
                'No verified Maven Central, GitHub Packages, or frozen JitPack artifact was found.']
        ]) {
            const special = await createContext(false, options);
            const specialPage = await special.context.newPage();
            await specialPage.goto(`${base}/library/?module=216200609&snapshot=1927`);
            await specialPage.locator('.library-detail-header .library-score').click();
            const specialDialog = specialPage.locator('#library-score-dialog[open]');
            await specialDialog.waitFor();
            assert.equal(await specialDialog.getByText(message, {exact: true}).count(), 1);
            if (options.score?.hardGateFailures.length) {
                assert.deepEqual(await specialDialog.locator('.library-score-section > h3').allTextContents(), ['Blocking issues']);
                assert.equal(await specialDialog.locator('.library-score-check--blocking').count(), 1);
            }
            await special.context.close();
        }
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
        await new Promise(done => server.close(done));
    }
});

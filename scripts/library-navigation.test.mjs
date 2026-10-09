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

test('snapshot labels use effective approval without changing the automatic evidence', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(code('snapshotStatus'), ctx);
    assert.equal(vm.runInContext('snapshotStatus({processingStatus:"COMPLETED",decision:"LISTED",published:true})', ctx), 'Approved');
    assert.equal(vm.runInContext('snapshotStatus({processingStatus:"COMPLETED",decision:"NEEDS_REVIEW",published:true})', ctx), 'Needs review');
    assert.equal(vm.runInContext('snapshotStatus({processingStatus:"PENDING",published:true})', ctx), 'Pending');
    assert.equal(vm.runInContext('snapshotStatus({processingStatus:"COMPLETED",decision:"NEEDS_REVIEW",visibilityDecision:"LISTED"})', ctx), 'Approved');
    assert.equal(vm.runInContext('snapshotStatus({processingStatus:"COMPLETED",decision:"LISTED",visibilityDecision:"REJECTED"})', ctx), 'Rejected');
});

test('catalog links use latest only for approved entries and pin review snapshots', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(code('catalogSnapshot'), ctx);
    assert.equal(vm.runInContext('catalogSnapshot({snapshotId:2197,visibilityDecision:"LISTED",score:{decision:"NEEDS_REVIEW"}})', ctx), 'latest');
    assert.equal(vm.runInContext('catalogSnapshot({snapshotId:2197,visibilityDecision:"NEEDS_REVIEW"})', ctx), '2197');
    assert.equal(vm.runInContext('catalogSnapshot({snapshotId:2197,visibilityDecision:"REJECTED"})', ctx), '2197');
});

test('the version selector omits technical explanations and uses version options for latest', () => {
    const selector = code('createSnapshotSelector');
    assert.doesNotMatch(selector, /Latest available snapshot|not necessarily a stable release|Selected snapshot #|Automatic assessment applies|Module moderation is separate/);
    assert.match(selector, /option\.value = String\(snapshot\.snapshotId\) === String\(latestId\) \? "latest"/);
    assert.match(selector, /section\.append\(label, selectControl\)/);
    const score = code('openScoreDialog');
    assert.match(score, /item\.visibilityDecision \|\| score\.decision/);
});

test('module sidebar omits internal assessment metadata without removing user actions or warnings', () => {
    const detail = code('openDetail');
    assert.doesNotMatch(detail, /detailRow\("(?:Catalog publication|Registry|Module moderation|Automatic assessment|jME core observed in analysis)"/);
    assert.doesNotMatch(detail, /library-like-privacy|Likes use a random identifier/);
    assert.match(detail, /detailRow\("Recommended jME", item\.compatibility\?\.recommended\)/);
    assert.match(detail, /detailRow\("GitHub stars"/);
    assert.match(detail, /createLikeButton\(item/);
    assert.match(detail, /if \(state\.adminSession\) aside\.append\(renderModeration\(item\)\)/);
    assert.match(detail, /createVisibilityWarning\(item, true\)/);
});

test('module score badges omit snapshot visibility without removing security warnings', () => {
    const detail = code('openDetail');
    assert.doesNotMatch(detail, /Snapshot visibility|library-state-chip--inline/);
    assert.match(detail, /virusTotalIndicator\(item\)/);
    assert.match(detail, /createVisibilityWarning\(item, true\)/);
});

test('score dialog uses one short introduction and retains score cards and concrete findings', () => {
    const markup = readFileSync(new URL('../layouts/library/list.html', import.meta.url), 'utf8');
    const dialog = markup.match(/<dialog class="library-dialog" id="library-score-dialog">([^]*?)<\/dialog>/)[1];
    assert.equal((dialog.match(/<p>/g) || []).length, 1);
    assert.match(dialog, /Confidence reflects check coverage, not a safety guarantee/);
    assert.ok(dialog.match(/<p>([^]*?)<\/p>/)[1].split(/\s+/).length <= 25);
    const score = code('openScoreDialog');
    assert.doesNotMatch(score, /library-score-legend|library-score-explanation|Score contributions|Author trust applies only|A dependency can maintain/);
    assert.match(score, /appendCheckList\(gateSection, blockingChecks, true, "blocking"\)/);
    assert.match(score, /appendCheckList\(moduleSection, moduleChecks, true\)/);
    assert.match(score, /appendCheckList\(group, coordinateChecks, false\)/);
    assert.match(score, /if \(check\.message\) row\.append/);
    assert.match(score, /library-score-spotbugs-findings/);
    assert.match(score, /library-score-spotbugs-advisories/);
});

test('snippet platform selection preserves the base split unless YAML declares specific platforms', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(code('installationTargets'), ctx);
    for (const [option, expected] of [
        [{target: 'JVM'}, ['JVM']],
        [{target: 'ANDROID', platforms: []}, ['ANDROID']],
        [{target: 'JVM', platforms: [], platformsKnown: true}, []],
        [{target: 'JVM', platforms: [{operatingSystem: 'IOS'}, {operatingSystem: 'MACOS'}, {operatingSystem: 'IOS'}]}, ['IOS', 'MACOS']],
        [{target: 'JVM', platforms: [{operatingSystem: 'UNKNOWN'}]}, ['JVM']]
    ]) {
        ctx.option = option;
        assert.deepEqual(Array.from(vm.runInContext('installationTargets(option)', ctx)), expected);
    }
});

test('identical install snippets share one recipe with the union of their supported platforms', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(`${code('installationTargets')}\n${code('installationRecipes')}\n${code('installationRecipeLabel')}`, ctx);
    const desktop = 'repositories { mavenCentral() }\ndependencies { implementation("example:desktop:1") }';
    const mobile = 'dependencies { implementation("example:mobile:1") }';
    ctx.item = {installationOptions: [
        {artifact: {artifactId: 'desktop'}, gradleSnippet: desktop,
            platformsKnown: true, platforms: [{operatingSystem: 'WINDOWS'}]},
        {artifact: {artifactId: 'desktop'}, gradleSnippet: desktop.replace(/\n/g, '\r\n'),
            platformsKnown: true, platforms: [{operatingSystem: 'LINUX'}]},
        {artifact: {artifactId: 'desktop'}, gradleSnippet: `\n${desktop}\n`,
            platformsKnown: true, platforms: [{operatingSystem: 'MACOS'}, {operatingSystem: 'LINUX'}]},
        {artifact: {artifactId: 'mobile'}, gradleSnippet: mobile,
            platformsKnown: true, platforms: [{operatingSystem: 'ANDROID'}, {operatingSystem: 'IOS'}]},
        {artifact: {artifactId: 'unsupported'}, gradleSnippet: desktop,
            platformsKnown: true, platforms: []}
    ]};
    const recipes = JSON.parse(vm.runInContext('JSON.stringify(installationRecipes(item))', ctx));
    assert.equal(recipes.length, 2);
    assert.equal(recipes[0].gradleSnippet, desktop);
    assert.deepEqual(recipes[0].targets, ['WINDOWS', 'LINUX', 'MACOS']);
    assert.deepEqual(recipes[1].targets, ['ANDROID', 'IOS']);
    assert.deepEqual(Array.from(vm.runInContext('installationRecipes(item).map(installationRecipeLabel)', ctx)),
        ['Windows, Linux, macOS', 'Android, iOS']);
});

test('different coordinates or repositories never merge merely because their platforms match', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(`${code('installationTargets')}\n${code('installationRecipes')}`, ctx);
    ctx.item = {installationOptions: [
        {artifact: {artifactId: 'one'}, target: 'JVM', gradleSnippet: 'dependencies { implementation("example:one:1") }'},
        {artifact: {artifactId: 'two'}, target: 'JVM', gradleSnippet: 'dependencies { implementation("example:two:1") }'},
        {artifact: {artifactId: 'one'}, target: 'JVM', gradleSnippet: 'repositories { maven { url = "https://registry.example" } }\ndependencies { implementation("example:one:1") }'}
    ]};
    assert.equal(vm.runInContext('installationRecipes(item).length', ctx), 3);
});

test('known unsupported options do not fall back to an unchecked legacy recipe', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(`${code('installationTargets')}\n${code('installationRecipes')}`, ctx);
    ctx.item = {gradleSnippet: 'legacy snippet', installationOptions: [
        {artifact: {artifactId: 'unsupported'}, gradleSnippet: 'legacy snippet', platformsKnown: true, platforms: []}
    ]};
    assert.equal(vm.runInContext('installationRecipes(item).length', ctx), 0);
    ctx.item = {gradleSnippet: 'legacy snippet', rootArtifact: {packaging: 'aar'}};
    assert.deepEqual(Array.from(vm.runInContext('installationRecipes(item)[0].targets', ctx)), ['ANDROID']);
});

test('the install section contains all recipes without a selector or routine analysis notes', () => {
    const render = code('renderInstallRecipe');
    assert.equal((render.match(/node\("select"/g) || []).length, 0);
    assert.match(render, /combinedInstallationSnippet\(recipes\)/);
    assert.doesNotMatch(render, /installation\?\.note|library-install-note|library-install-platform-note|Install artifact/);
});

test('all install roots share one dependency block with inline platform comments', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(`${code('installationRecipeLabel')}\n${code('installationSnippetParts')}\n${code('combinedInstallationSnippet')}`, ctx);
    const snippet = coordinate => `repositories {\n    mavenCentral()\n}\n\ndependencies {\n    implementation("${coordinate}")\n}`;
    ctx.recipes = [
        {gradleSnippet: snippet('example:desktop:1'), targets: ['WINDOWS', 'LINUX']},
        {gradleSnippet: snippet('example:core:1'), targets: ['WINDOWS', 'LINUX', 'MACOS', 'ANDROID', 'IOS']},
        {gradleSnippet: snippet('example:android:1'), targets: ['ANDROID']}
    ];
    const combined = vm.runInContext('combinedInstallationSnippet(recipes)', ctx);
    assert.equal((combined.match(/repositories \{/g) || []).length, 1);
    assert.equal((combined.match(/mavenCentral\(\)/g) || []).length, 1);
    assert.equal((combined.match(/dependencies \{/g) || []).length, 1);
    assert.equal((combined.match(/implementation\(/g) || []).length, 3);
    assert.doesNotMatch(combined, /Remove dependencies for other platforms/);
    assert.match(combined, /implementation\("example:desktop:1"\) \/\/ Windows, Linux/);
    assert.match(combined, /implementation\("example:core:1"\) \/\/ Windows, Linux, macOS, Android, iOS/);
    assert.match(combined, /implementation\("example:android:1"\) \/\/ Android/);
});

test('combined repositories retain authentication and combine narrow content filters', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(`${code('installationRecipeLabel')}\n${code('installationSnippetParts')}\n${code('combinedInstallationSnippet')}`, ctx);
    const snippet = artifact => `repositories {\n    mavenCentral()\n    maven {\n        name = "GitHubPackages_owner_repo"\n        url = uri("https://maven.pkg.github.com/owner/repo")\n        credentials {\n            username = providers.environmentVariable("GITHUB_PACKAGES_USERNAME").orNull\n            password = providers.environmentVariable("GITHUB_PACKAGES_TOKEN").orNull\n        }\n        content {\n            includeModule("example", "${artifact}")\n        }\n    }\n    maven {\n        name = "JitPack"\n        url = uri("https://jitpack.io")\n        content {\n            includeGroup("com.github.${artifact}")\n        }\n    }\n}\n\ndependencies {\n    implementation("example:${artifact}:1")\n}`;
    ctx.recipes = [
        {gradleSnippet: snippet('desktop'), targets: ['WINDOWS']},
        {gradleSnippet: snippet('android'), targets: ['ANDROID']}
    ];
    const combined = vm.runInContext('combinedInstallationSnippet(recipes)', ctx);
    for (const name of ['GitHubPackages_owner_repo', 'JitPack']) {
        assert.equal(combined.split(`name = "${name}"`).length - 1, 1);
    }
    assert.match(combined, /GITHUB_PACKAGES_USERNAME/);
    assert.match(combined, /GITHUB_PACKAGES_TOKEN/);
    assert.match(combined, /includeModule\("example", "desktop"\)/);
    assert.match(combined, /includeModule\("example", "android"\)/);
    assert.match(combined, /includeGroup\("com.github.desktop"\)/);
    assert.match(combined, /includeGroup\("com.github.android"\)/);
});

test('duplicate root declarations are shown once, preserving their classifier and platform union', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(`${code('installationRecipeLabel')}\n${code('installationSnippetParts')}\n${code('combinedInstallationSnippet')}`, ctx);
    const snippet = 'dependencies {\n    implementation("example:native:1:arm64")\n}';
    ctx.recipes = [
        {gradleSnippet: snippet, targets: ['WINDOWS']},
        {gradleSnippet: snippet, targets: ['LINUX']}
    ];
    const combined = vm.runInContext('combinedInstallationSnippet(recipes)', ctx);
    assert.equal((combined.match(/implementation\(/g) || []).length, 1);
    assert.match(combined, /implementation\("example:native:1:arm64"\) \/\/ Windows, Linux/);
});

test('historical custom snippets are preserved intact with a platform comment', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(`${code('installationRecipeLabel')}\n${code('installationSnippetParts')}\n${code('combinedInstallationSnippet')}`, ctx);
    const snippet = 'dependencies { implementation("example:legacy:1") { exclude(group = "legacy") } }';
    ctx.recipes = [{gradleSnippet: snippet, targets: ['JVM']}];
    assert.equal(vm.runInContext('combinedInstallationSnippet(recipes)', ctx), `// JVM\n${snippet}`);
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

test('archived repositories have a hidden badge and an explicit reason even with a manual listing', () => {
    const ctx = context('https://jmonkeyengine.org/library/');
    vm.runInContext(`${code('stateLabel')}\n${code('visibilityReasons')}`, ctx);
    ctx.item = {repositoryArchived: true, moderationState: 'LISTED', visibilityDecision: 'HIDDEN'};
    assert.equal(vm.runInContext('stateLabel(item)', ctx), 'HIDDEN');
    assert.match(vm.runInContext('visibilityReasons(item)[0]', ctx), /Repository archived on GitHub/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const template = readFileSync(new URL('../layouts/shortcodes/initializer.html', import.meta.url), 'utf8');
const script = template.match(/<script>([\s\S]*?)<\/script>/)[1];

test('embed height follows only valid messages from its configured frame', () => {
    const frame = {src: 'http://127.0.0.1:8081/?embed=1', contentWindow: {}, style: {}};
    let receive;
    vm.runInNewContext(script, {
        URL,
        document: {getElementById: () => frame},
        window: {addEventListener: (_name, listener) => { receive = listener; }}
    });
    const message = (height, extra = {}) => ({source: frame.contentWindow, origin: 'http://127.0.0.1:8081',
        data: JSON.stringify({name: 'jme-initializer-resize', height}), ...extra});
    receive(message(1200.2));
    assert.equal(frame.style.height, '1201px');
    receive(message(700));
    assert.equal(frame.style.height, '700px', 'collapsing content can shrink the iframe');
    receive(message(999, {source: {}}));
    receive(message(999, {origin: 'https://unrelated.example'}));
    receive(message(-1));
    receive(message(100000));
    receive(message('999'));
    receive(message(999, {data: 'not-json'}));
    assert.equal(frame.style.height, '700px');
});

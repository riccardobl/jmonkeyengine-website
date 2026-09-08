import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const config = readFileSync(new URL('../config.toml', import.meta.url), 'utf8');
const header = readFileSync(new URL('../layouts/partials/header.html', import.meta.url), 'utf8');
const initializer = readFileSync(new URL('../layouts/shortcodes/initializer.html', import.meta.url), 'utf8');

test('production keeps the external initializer embed and hides Library navigation by default', () => {
    assert.match(config, /libraryEnabled=false/);
    assert.match(config, /initializerUrl="https:\/\/start\.jmonkeyengine\.org"/);
    assert.match(header, /\{\{ if \.Site\.Params\.libraryEnabled \}\}[\s\S]*href="\/library\/"[\s\S]*\{\{ end \}\}/);
    assert.match(initializer, /\.Page\.Site\.Params\.initializerUrl/);
    assert.match(initializer, /\?embed=1/);
});

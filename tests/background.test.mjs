import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const code = await readFile(new URL('../src/background.js', import.meta.url), 'utf8');

function setup({ closed = false } = {}) {
  const calls = [];
  let click;
  const record = (name) => async (arg) => {
    calls.push([name, arg]);
    if (closed) throw new Error('Tab closed');
  };
  vm.runInNewContext(code, { URL, chrome: {
    action: {
      onClicked: { addListener(fn) { click = fn; } },
      setBadgeText: record('badge'), setTitle: record('title'),
    },
    scripting: { executeScript: record('inject') },
    tabs: { sendMessage: async (id, message) => calls.push(['message', { id, message }]) },
  } });
  return { click, calls };
}

test('toolbar injects before messaging and clears previous errors', async () => {
  const { click, calls } = setup();
  await click({ id: 3, url: 'https://rezka.ag/series/example.html' });
  assert.deepEqual(calls.map(([name]) => name), ['inject', 'message', 'badge', 'title']);
  assert.equal(calls[0][1].files[0], 'content.js');
  assert.equal(calls[1][1].message.type, 'rezka-window-toggle');
  assert.equal(calls[2][1].text, '');
});

test('toolbar rejects unsupported sites and protocols', async () => {
  for (const url of ['https://rezka.ag.evil.test/', 'https://example.com', 'chrome://extensions', 'ftp://rezka.ag']) {
    const { click, calls } = setup();
    await click({ id: 3, url });
    assert.deepEqual(calls.map(([name]) => name), ['badge', 'title']);
    assert.equal(calls[0][1].text, '!');
  }
});

test('closed tabs do not cause an unhandled rejection', async () => {
  const { click } = setup({ closed: true });
  await assert.doesNotReject(click({ id: 3, url: 'https://rezka.ag/' }));
});

test('missing tab identifiers are ignored', async () => {
  const { click, calls } = setup();
  await click({});
  assert.equal(calls.length, 0);
});

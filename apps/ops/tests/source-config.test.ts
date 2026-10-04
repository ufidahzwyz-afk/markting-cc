import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceScope, credentialReference, platformLoginScope } from '../src/lib/source-config';
test('real source scope is explicit and cannot carry cursor, credentials or cross-kind selectors', () => {
  assert.deepEqual(sourceScope({ folder_ids: ['authorized-folder'] }, 'mac_drive', true), { folder_ids: ['authorized-folder'] });
  assert.throws(() => sourceScope({}, 'mac_drive', true), { code: 'SOURCE_SCOPE_REQUIRED' });
  for (const scope of [{ cursor: 'opaque' }, { password: 'test-only' }, { urls: ['https://example.com'] }, { folder_ids: ['one', 'one'] }]) assert.throws(() => sourceScope(scope, 'mac_drive', true), { code: 'INVALID_SOURCE_SCOPE' });
  for (const url of ['http://127.0.0.1', 'http://10.0.0.1', 'http://172.16.0.1', 'https://localhost', 'https://u:p@example.com', 'file:///etc/passwd']) assert.throws(() => sourceScope({ urls: [url] }, 'market_public', true), { code: 'INVALID_SOURCE_SCOPE' });
  assert.deepEqual(sourceScope({conversation_ids:['approved'],platform_login:{method:'password',recipe_id:'trusted-chatgpt',recipe_version:'1'}},'chatgpt',true),{conversation_ids:['approved'],platform_login:{method:'password',recipe_id:'trusted-chatgpt',recipe_version:'1'}});
  assert.throws(()=>sourceScope({platform_login:{method:'password',recipe_id:'trusted',recipe_version:'1'}},'chatgpt',true),{code:'SOURCE_SCOPE_REQUIRED'});
  assert.deepEqual(sourceScope({ urls: ['https://example.com/news'] }, 'competitor_public', true), { urls: ['https://example.com/news'] });
});
test('only references and fixed login adapter versions are accepted by ordinary configuration', () => {
  assert.equal(credentialReference('env:BORAN_DRIVE_TOKEN'), 'env:BORAN_DRIVE_TOKEN');
  assert.throws(() => credentialReference('plain-test-token'), { code: 'INVALID_CREDENTIAL_REFERENCE' });
  assert.throws(() => platformLoginScope({ platform_login: { method: 'password', recipe_id: 'trusted', recipe_version: '1', script: 'untrusted' } }), { code: 'INVALID_LOGIN_SCOPE' });
  assert.deepEqual(platformLoginScope({ platform_login: { method: 'password', recipe_id: 'trusted', recipe_version: '1' } }), { platform_login: { method: 'password', recipe_id: 'trusted', recipe_version: '1' } });
});

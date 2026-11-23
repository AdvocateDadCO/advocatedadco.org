const assert = require('node:assert/strict');
const release = require('./pages-release.cjs');
const commit = 'a'.repeat(40);
const files = { '/index.html': 'reviewed', '/old.css': 'old' };
const live = { id: 'recorded', files, deployment_trigger: { metadata: { branch: 'main', commit_dirty: false, commit_hash: commit } } };
const receipt = { id: live.id, commit, manifest_sha256: release.manifestDigest(files) };
release.assertProvenance(live, files, true, receipt);
assert.throws(() => release.assertProvenance({ ...live, id: 'unknown' }, files, true, receipt));
assert.throws(() => release.assertProvenance({ ...live, files: { ...files, '/index.html': 'drift' } }, files, true, receipt));
assert.throws(() => release.assertProvenance(live, files, false, receipt));
assert.throws(() => release.assertProvenance({ ...live, deployment_trigger: { metadata: { ...live.deployment_trigger.metadata, commit_dirty: true } } }, files, true, receipt));
assert.throws(() => release.assertProvenance({ ...live, deployment_trigger: { metadata: { ...live.deployment_trigger.metadata, branch: 'other' } } }, files, true, receipt));
assert.throws(() => release.assertProvenance({ ...live, deployment_trigger: { metadata: { branch: 'main', commit_dirty: false, commit_hash: '' } } }, files, true, receipt));
assert.throws(() => release.assertProvenance(live, files, true, null));
release.approvedRemovals([{ name: 'old.css' }], [], [{ path: '/old.css', change: 'removed' }]);
assert.throws(() => release.approvedRemovals([{ name: 'old.css' }], [{ name: 'old.css' }], [{ path: '/old.css', change: 'removed' }]));
release.validateApproval([{ name: 'index.html', hash: 'approved' }], { 'index.html': 'approved' });
assert.throws(() => release.validateApproval([{ name: 'index.html', hash: 'changed' }], { 'index.html': 'approved' }));
assert.throws(() => release.validateApproval([{ name: 'new.html', hash: 'new' }], {}));
assert.equal(release.excluded('.github/deploy/release-policy.json'), true);
assert.equal(release.excluded('hero-v2.css?v=20260912-matched-tag.css'), false);
assert.deepEqual(release.differences({ '/index.html': 'old' }, { '/index.html': 'new', '/new.css': 'new' }), [{ path: '/index.html', change: 'changed' }, { path: '/new.css', change: 'added' }]);
const imageNames = ['images/a.webp', 'images/b/c.jpg', 'favicon.ico', 'index.html', 'mixed/x.png', 'mixed/y.html'];
const okHeaders = '# comment\n/images/*\n  Cache-Control: public, max-age=2592000\n\n/favicon.ico\n  Cache-Control: public, max-age=2592000\n';
assert.deepEqual(release.validateHeaders(okHeaders, imageNames), { '/images/*': 'public, max-age=2592000', '/favicon.ico': 'public, max-age=2592000' });
for (const bad of [
  '/*\n  Cache-Control: public, max-age=2592000\n',
  '/index.html\n  Cache-Control: public, max-age=2592000\n',
  '/mixed/*\n  Cache-Control: public, max-age=2592000\n',
  '/missing/*\n  Cache-Control: public, max-age=2592000\n',
  '/images/*\n  X-Robots-Tag: noindex\n',
  '/images/*\n  Cache-Control: public, max-age=2592000\n  Access-Control-Allow-Origin: *\n',
  '/images/*\n  ! Cache-Control\n',
  '/images/*\n  Cache-Control: no-store\n',
  '/images/*\n  Cache-Control: public, max-age=99999999\n',
  '/images/*\n',
  'https://advocatedadco.org/images/*\n  Cache-Control: public, max-age=2592000\n',
  '/images/:name\n  Cache-Control: public, max-age=2592000\n',
  '/images/../index.html\n  Cache-Control: public, max-age=2592000\n',
  '/images/*\n  Cache-Control: public, max-age=60\n/images/*\n  Cache-Control: public, max-age=60\n',
  '',
]) assert.throws(() => release.validateHeaders(bad, imageNames), undefined, JSON.stringify(bad));
{
  // Tracked-tree behavior: _headers is validated and left out of the Cloudflare manifest; other control files still stop.
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), { execFileSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'headers-test-')), start = process.cwd();
  const commit = (name, text) => { fs.writeFileSync(path.join(root, name), text); execFileSync('git', ['add', name], { cwd: root }); execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', name], { cwd: root }); };
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.mkdirSync(path.join(root, 'images'));
    commit('index.html', '<p>x</p>');
    commit('images/a.png', 'png');
    process.chdir(root);
    if (process.env.RELEASE_TOOLS) {
      commit('_headers', '/images/*\n  Cache-Control: public, max-age=2592000\n');
      assert.deepEqual(Object.keys(release.sourceManifest('HEAD')).sort(), ['/images/a.png', '/index.html']);
      commit('_headers', '/*\n  Cache-Control: public, max-age=2592000\n');
      assert.throws(() => release.sourceManifest('HEAD'));
      commit('_headers', '/images/*\n  Cache-Control: public, max-age=2592000\n');
      commit('_redirects', '/a /b 301\n');
      assert.throws(() => release.sourceManifest('HEAD'), /separately reviewed/);
    } else console.log('RELEASE_TOOLS is not set; skipped the tracked-tree _headers test.');
  } finally { process.chdir(start); fs.rmSync(root, { recursive: true, force: true }); }
}
console.log('Image-only _headers validation, release provenance, approval, drift, deletion, and file-diff checks passed.');

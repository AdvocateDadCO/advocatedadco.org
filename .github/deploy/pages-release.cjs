const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const REPO = 'AdvocateDadCO/advocatedadco.org';
const PROJECT = 'advocatedadco';
const ENVIRONMENT = 'cloudflare-pages-production';
const check = (ok, message) => { if (!ok) throw new Error(message); };
const git = (...args) => execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 });
const excluded = name => ['.git', '.github', '.gitignore', 'README.md'].includes(name.split('/')[0]);
const policy = () => JSON.parse(fs.readFileSync(process.env.RELEASE_POLICY || '.github/deploy/release-policy.json', 'utf8'));
const sha = () => git('rev-parse', 'HEAD').toString().trim();
const digest = obj => crypto.createHash('sha256').update(JSON.stringify(obj)).digest('hex');
const manifestDigest = obj => digest(Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))));
function entries(ref) {
  return git('ls-tree', '-r', '-z', ref).toString('utf8').split('\0').filter(Boolean).map(row => {
    const offset = row.indexOf('\t'), [mode, type, hash] = row.slice(0, offset).split(' ');
    return { mode, type, hash, name: row.slice(offset + 1) };
  }).filter(item => !excluded(item.name));
}
function differences(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter(name => before[name] !== after[name])
    .map(name => ({ path: name, change: !(name in after) ? 'removed' : !(name in before) ? 'added' : 'changed' }));
}
function save(name, obj) {
  fs.mkdirSync(process.env.RELEASE_EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(process.env.RELEASE_EVIDENCE, name), JSON.stringify(obj, null, 2) + '\n');
}
function read(name) { return JSON.parse(fs.readFileSync(path.join(process.env.RELEASE_EVIDENCE, name), 'utf8')); }
function summary(text) { if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n'); }
function blake() { return createRequire(path.join(process.env.RELEASE_TOOLS, 'package.json'))('blake3-wasm'); }
function assetHash(name, bytes) { return blake().hash(bytes.toString('base64') + path.extname(name).slice(1)).toString('hex').slice(0, 32); }
function sourceManifest(ref) {
  return Object.fromEntries(entries(ref).map(item => {
    check(item.mode === '100644' && item.type === 'blob', 'Only regular tracked static files may be deployed.');
    check(!['_worker.js', '_headers', '_redirects', '_routes.json'].includes(item.name), 'Pages control files require a separately reviewed implementation.');
    return ['/' + item.name, assetHash(item.name, git('cat-file', 'blob', item.hash))];
  }));
}
function validateApproval(list, approved) {
  const actual = Object.fromEntries(list.map(item => [item.name, item.hash]));
  check(differences(approved, actual).length === 0, 'Public-content approval list differs from the proposed tracked files; review is required.');
}
function prepare() {
  const list = entries('HEAD');
  validateApproval(list, policy().approved_public_files);
  check(!fs.existsSync(process.env.RELEASE_SITE), 'Staging directory already exists.');
  fs.mkdirSync(process.env.RELEASE_SITE, { recursive: true });
  for (const item of list) {
    check(item.mode === '100644' && item.type === 'blob', 'Only regular tracked static files may be deployed.');
    const target = path.resolve(process.env.RELEASE_SITE, item.name);
    check(target.startsWith(path.resolve(process.env.RELEASE_SITE) + path.sep), 'Unsafe site path.');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git('cat-file', 'blob', item.hash));
  }
  save('source.json', { commit: sha(), site_files: list.length });
  console.log('Prepared the approved tracked public files only.');
}
function stagedManifest() {
  const expected = new Map(entries('HEAD').map(item => [item.name, item.hash]));
  const result = {};
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir)) {
      const target = path.join(dir, name), relative = prefix + name, stat = fs.lstatSync(target);
      check(!stat.isSymbolicLink(), 'Symlinks are not permitted in staging.');
      if (stat.isDirectory()) walk(target, relative + '/');
      else {
        const bytes = fs.readFileSync(target);
        const hash = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
        check(expected.get(relative) === hash, 'Staged bytes differ from main.');
        result['/' + relative] = assetHash(relative, bytes);
      }
    }
  }
  walk(process.env.RELEASE_SITE);
  check(Object.keys(result).length === expected.size, 'Staging omitted a tracked public file.');
  return result;
}
async function request(url, token, method = 'GET', body) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
  check(response.ok, 'Release API request failed (HTTP ' + response.status + ').');
  return response.json();
}
async function cf(route) {
  check(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN, 'Required Cloudflare secrets are missing.');
  const data = await request('https://api.cloudflare.com/client/v4/accounts/' + process.env.CLOUDFLARE_ACCOUNT_ID + '/pages/projects/' + PROJECT + route, process.env.CLOUDFLARE_API_TOKEN);
  check(data.success, 'Cloudflare request failed.');
  return data.result;
}
const gh = (route, method, body) => request('https://api.github.com/repos/' + REPO + route, process.env.GITHUB_TOKEN, method, body);
async function currentMain() {
  const ref = await gh('/git/ref/heads/main');
  check(ref.object.sha === sha(), 'This run is no longer at the current main commit; start a fresh run.');
}
async function production() {
  const project = await cf('');
  check(project.name === PROJECT && project.production_branch === 'main' && !project.source && project.domains.includes('advocatedadco.org'), 'Unexpected Pages project configuration.');
  const live = await cf('/deployments/' + project.canonical_deployment.id);
  check(live.environment === 'production' && live.latest_stage.status === 'success' && !live.uses_functions && live.files, 'Production is not a successful static deployment with a manifest.');
  return live;
}
function assertProvenance(live, expectedManifest, isAncestor, record) {
  const meta = live.deployment_trigger?.metadata || {};
  check(meta.branch === 'main' && meta.commit_dirty === false && /^[a-f0-9]{40}$/.test(meta.commit_hash || ''), 'Live production is not a clean recorded main commit; direct-upload drift requires review.');
  check(isAncestor, 'The live commit is not an ancestor of the proposed main commit.');
  check(differences(live.files, expectedManifest).length === 0, 'Live bytes differ from the recorded GitHub commit; direct-upload drift requires review.');
  check(record && record.id === live.id && record.commit === meta.commit_hash && record.manifest_sha256 === manifestDigest(live.files), 'Live deployment has no matching GitHub production receipt; review is required.');
}
async function receiptFor(live) {
  const commit = live.deployment_trigger?.metadata?.commit_hash;
  const bootstrap = policy().bootstrap;
  if (bootstrap.id === live.id) return bootstrap;
  const records = await gh('/deployments?sha=' + encodeURIComponent(commit) + '&environment=' + ENVIRONMENT + '&per_page=100');
  for (const record of records) {
    const payload = typeof record.payload === 'string' ? JSON.parse(record.payload) : record.payload;
    if (payload?.id !== live.id) continue;
    const statuses = await gh('/deployments/' + record.id + '/statuses');
    if (statuses[0]?.state === 'success') return payload;
  }
  return null;
}
function approvedRemovals(beforeEntries, afterEntries, delta) {
  const before = new Set(beforeEntries.map(item => '/' + item.name));
  const after = new Set(afterEntries.map(item => '/' + item.name));
  check(delta.filter(item => item.change === 'removed').every(item => before.has(item.path) && !after.has(item.path)), 'Upload would delete a file that Git did not remove.');
}
async function preflight() {
  await currentMain();
  const live = await production(), commit = live.deployment_trigger?.metadata?.commit_hash;
  check(/^[a-f0-9]{40}$/.test(commit || ''), 'Live deployment has no valid GitHub commit; stop for review.');
  let ancestor = false;
  try { git('merge-base', '--is-ancestor', commit, 'HEAD'); ancestor = true; } catch { /* fail closed below */ }
  const previous = sourceManifest(commit);
  assertProvenance(live, previous, ancestor, await receiptFor(live));
  const proposed = stagedManifest(), changes = differences(live.files, proposed);
  approvedRemovals(entries(commit), entries('HEAD'), changes);
  const plan = { baseline: live.id, before_commit: commit, target_commit: sha(), site_files: Object.keys(proposed).length, changes };
  const plan_sha256 = digest(plan);
  save('baseline.json', { id: live.id, url: live.url, commit, files: live.files });
  save('proposed-manifest.json', proposed);
  save('review-plan.json', { ...plan, plan_sha256 });
  summary('## Release review\n\nRollback: ' + live.id + '\n\nTarget main commit: ' + sha() +
    '\n\nReview digest: `' + plan_sha256 + '`\n\n' +
    (changes.length ? changes.map(item => '- **' + item.change + '**: `' + item.path + '`').join('\n') : 'No site-file changes.'));
  console.log('Production provenance, exact manifest, and deletion checks passed. Review plan recorded.');
}
function requireReview() {
  const plan = read('review-plan.json');
  check(process.env.REVIEWED_PLAN_SHA256 === plan.plan_sha256, 'Deploy requires the exact review digest from a successful verify-only run.');
  check(plan.changes.length > 0, 'No site-file change is proposed; another production deployment is unnecessary.');
  const checks = read('site-checks.json');
  check(checks.passed, 'Public content, internal links, media, and search checks must pass.');
}
async function beforeProduction() {
  requireReview();
  const preview = read('preview-receipt.json'), tests = read('preview-browser-checks.json');
  check(tests.passed && preview.commit === sha() && preview.manifest_verified, 'Verified preview and browser checks are required.');
  await currentMain();
  check((await production()).id === read('baseline.json').id, 'Production changed after preview; stop for review.');
  check(differences(read('proposed-manifest.json'), stagedManifest()).length === 0, 'Staging changed after preview.');
}
async function verify(mode) {
  const branch = mode === 'preview' ? 'release-check-' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT : 'main';
  const message = 'AdvocateDadCO GitHub Actions ' + process.env.GITHUB_RUN_ID + '/' + process.env.GITHUB_RUN_ATTEMPT;
  const list = await cf('/deployments?env=' + (mode === 'preview' ? 'preview' : 'production'));
  const found = list.find(item => item.deployment_trigger?.metadata?.branch === branch && item.deployment_trigger?.metadata?.commit_hash === sha() && item.deployment_trigger?.metadata?.commit_message === message);
  check(found, 'Could not identify this exact run deployment.');
  const deployment = await cf('/deployments/' + found.id), manifest = read('proposed-manifest.json');
  check(deployment.latest_stage.status === 'success' && deployment.environment === mode && differences(deployment.files || {}, manifest).length === 0, 'Deployment did not match the verified upload.');
  check((await production()).id === (mode === 'preview' ? read('baseline.json').id : deployment.id), 'Unexpected canonical deployment.');
  const receipt = { mode, id: deployment.id, url: deployment.url, rollback: read('baseline.json').id, commit: sha(), site_files: Object.keys(manifest).length, manifest_sha256: manifestDigest(manifest), manifest_verified: true };
  save(mode + '-receipt.json', receipt);
  summary('## Verified ' + mode + '\n\nDeployment: ' + receipt.id + '\n\nURL: ' + receipt.url + '\n\nRollback: ' + receipt.rollback);
}
async function recordProduction() {
  const receipt = read('production-receipt.json');
  check(read('production-browser-checks.json').passed, 'Production browser tests must pass before recording success.');
  check((await production()).id === receipt.id, 'Production changed before the receipt was recorded.');
  const record = await gh('/deployments', 'POST', { ref: sha(), auto_merge: false, required_contexts: [], environment: ENVIRONMENT, production_environment: true, payload: receipt, description: 'Verified Cloudflare Pages release' });
  await gh('/deployments/' + record.id + '/statuses', 'POST', { state: 'success', environment: ENVIRONMENT, environment_url: receipt.url, log_url: 'https://github.com/' + REPO + '/actions/runs/' + process.env.GITHUB_RUN_ID, auto_inactive: false });
  save('github-production-record.json', { github_deployment: record.id, ...receipt });
  console.log('Verified production receipt recorded in GitHub.');
}
module.exports = { excluded, differences, manifestDigest, sourceManifest, assertProvenance, approvedRemovals, validateApproval };
if (require.main === module) {
  const commands = { prepare, preflight, 'require-review': requireReview, 'before-production': beforeProduction, 'verify-preview': () => verify('preview'), 'verify-production': () => verify('production'), 'record-production': recordProduction };
  Promise.resolve().then(() => { check(commands[process.argv[2]], 'Unknown release command.'); return commands[process.argv[2]](); })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

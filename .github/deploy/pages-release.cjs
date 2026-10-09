const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const PROJECT = 'advocatedadco';
function excluded(name) {
  return ['.git', '.github', '.gitignore', 'README.md'].includes(name.split('/')[0]);
}
function differences(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(name => before[name] !== after[name])
    .map(name => ({ path: name, change: !(name in after) ? 'removed' : !(name in before) ? 'added' : 'changed' }));
}
function check(condition, message) { if (!condition) throw new Error(message); }
function git(...args) { return execFileSync('git', args, { maxBuffer: 128 * 1024 * 1024 }); }
function save(name, data) {
  fs.mkdirSync(process.env.RELEASE_EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(process.env.RELEASE_EVIDENCE, name), JSON.stringify(data, null, 2) + '\n');
}
function read(name) { return JSON.parse(fs.readFileSync(path.join(process.env.RELEASE_EVIDENCE, name), 'utf8')); }
function settings() { return JSON.parse(fs.readFileSync('.github/deploy/first-deploy.json', 'utf8')); }
function sourceEntries() {
  return git('ls-tree', '-r', '-z', 'HEAD').toString('utf8').split('\0').filter(Boolean).map(row => {
    const [head, name] = row.split('\t');
    const [mode, type, sha] = head.split(' ');
    return { mode, type, sha, name };
  }).filter(entry => !excluded(entry.name));
}
function prepare() {
  const expected = settings();
  const entries = sourceEntries();
  check(entries.every(e => e.type === 'blob' && e.mode === '100644'), 'Only regular static files may be deployed.');
  const actual = Object.fromEntries(entries.map(e => [e.name, e.sha]));
  const delta = differences(expected.files, actual);
  check(delta.length === 0, 'Site differs from the reviewed first-deploy commit; stop and review.');
  check(entries.length === expected.expected_files, 'Expected exactly 188 site files.');
  check(!fs.existsSync(process.env.RELEASE_SITE), 'Staging directory already exists.');
  fs.mkdirSync(process.env.RELEASE_SITE, { recursive: true });
  for (const entry of entries) {
    const target = path.resolve(process.env.RELEASE_SITE, entry.name);
    check(target.startsWith(path.resolve(process.env.RELEASE_SITE) + path.sep), 'Unsafe site path.');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git('cat-file', 'blob', entry.sha));
  }
  save('source.json', { commit: git('rev-parse', 'HEAD').toString().trim(), site_files: entries.length, verified_source_commit: expected.source_commit });
  console.log('Prepared exactly 188 reviewed site files; repository metadata excluded.');
}
function localManifest() {
  const req = createRequire(path.join(process.env.RELEASE_TOOLS, 'package.json'));
  const blake = req('blake3-wasm');
  const result = {};
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir)) {
      const target = path.join(dir, name), relative = prefix + name;
      const st = fs.lstatSync(target);
      check(!st.isSymbolicLink(), 'Symlinks are not allowed.');
      if (st.isDirectory()) walk(target, relative + '/');
      else {
        check(!excluded(relative), 'Repository metadata leaked into staging.');
        const bytes = fs.readFileSync(target), ext = path.extname(relative).slice(1);
        result['/' + relative] = blake.hash(bytes.toString('base64') + ext).toString('hex').slice(0, 32);
        const expected = settings().files[relative];
        const gitHash = crypto.createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
        check(expected === gitHash, 'Staged bytes differ from reviewed source.');
      }
    }
  }
  walk(process.env.RELEASE_SITE);
  check(Object.keys(result).length === 188, 'Staged file count changed.');
  return result;
}
async function api(route) {
  check(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN, 'Required Cloudflare secrets are missing.');
  const response = await fetch('https://api.cloudflare.com/client/v4/accounts/' + process.env.CLOUDFLARE_ACCOUNT_ID + '/pages/projects/' + PROJECT + route, {
    headers: { Authorization: 'Bearer ' + process.env.CLOUDFLARE_API_TOKEN },
    signal: AbortSignal.timeout(45000)
  });
  const data = await response.json();
  check(response.ok && data.success, 'Cloudflare request failed (HTTP ' + response.status + ').');
  return data.result;
}
async function production() {
  const project = await api('');
  check(project.name === PROJECT && project.production_branch === 'main' && !project.source && project.domains.includes('advocatedadco.org'), 'Unexpected Pages project configuration.');
  const deployment = await api('/deployments/' + project.canonical_deployment.id);
  check(deployment.environment === 'production' && deployment.latest_stage.status === 'success' && !deployment.uses_functions, 'Production is not a successful static deployment.');
  check(deployment.files && typeof deployment.files === 'object', 'Cloudflare did not return its file manifest.');
  return deployment;
}
async function html(base) {
  const response = await fetch(new URL('/policy-action.html', base), { signal: AbortSignal.timeout(45000) });
  check(response.ok, 'Policy page verification failed (HTTP ' + response.status + ').');
  return (await response.text()).replace(/\r\n/g, '\n');
}
async function preflight() {
  const live = await production(), expected = settings(), proposed = localManifest();
  check(live.id === expected.baseline_deployment, 'Production has changed since the handoff; stop and review.');
  check(Object.keys(live.files).length === 189, 'Expected 189 files in baseline production.');
  const delta = differences(live.files, proposed);
  check(JSON.stringify(delta) === JSON.stringify([
    { path: '/fundraising.css', change: 'removed' },
    { path: '/policy-action.html', change: 'changed' }
  ]), 'Production difference exceeds the approved two-change gate.');
  const before = await html(live.url);
  const after = fs.readFileSync(path.join(process.env.RELEASE_SITE, 'policy-action.html'), 'utf8').replace(/\r\n/g, '\n');
  const description = /^[ \t]*<meta\b[^\r\n]*\bname=["']description["'][^\r\n]*>[ \t]*$/gmi;
  check((before.match(description) || []).length === 1 && (after.match(description) || []).length === 1, 'Expected one meta-description in each policy page.');
  check(before.replace(description, '') === after.replace(description, ''), 'Policy page change includes more than its meta-description.');
  save('baseline.json', { id: live.id, url: live.url, files: live.files });
  save('proposed-manifest.json', proposed);
  save('two-change-gate.json', { passed: true, rollback: live.id, site_files: 188, changes: delta, policy_change: 'meta-description only' });
  console.log('Two-change gate passed against authenticated production manifest.');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '\n### Two-change gate passed\n\n- Production baseline and rollback: ' + live.id +
    '\n- Verified source: ' + expected.source_commit +
    '\n- Proposed site files: 188\n- Policy meta-description update and retired stylesheet removal only.\n');
}
async function beforeProduction() {
  const preview = read('preview-receipt.json');
  check(preview.manifest_verified && preview.policy_page_verified && preview.commit === read('source.json').commit, 'Verified preview receipt is required.');
  check((await production()).id === read('baseline.json').id, 'Production changed after preview; stop.');
  check(differences(read('proposed-manifest.json'), localManifest()).length === 0, 'Staged files changed after preview.');
  console.log('Production baseline and staged files remain unchanged.');
}
async function verify(mode) {
  const source = read('source.json'), baseline = read('baseline.json');
  const branch = mode === 'preview' ? 'step3-check-' + process.env.GITHUB_RUN_ID + '-' + process.env.GITHUB_RUN_ATTEMPT : 'main';
  const deployments = await api('/deployments?env=' + (mode === 'preview' ? 'preview' : 'production'));
  const candidate = deployments.find(d => d.deployment_trigger?.metadata?.branch === branch && d.deployment_trigger?.metadata?.commit_hash === source.commit);
  check(candidate, 'Could not identify deployment for this exact commit and branch.');
  let deployment;
  for (let attempt = 0; attempt < 20; attempt++) {
    deployment = await api('/deployments/' + candidate.id);
    if (deployment.latest_stage.status === 'success') break;
    check(!['failure', 'canceled'].includes(deployment.latest_stage.status), 'Deployment failed.');
    await new Promise(resolve => setTimeout(resolve, 1500));
  }
  check(deployment.latest_stage.status === 'success', 'Deployment is not successful.');
  const manifest = read('proposed-manifest.json');
  check(deployment.files && differences(deployment.files, manifest).length === 0, 'Deployment manifest does not exactly match the staged 188 files.');
  check(deployment.environment === (mode === 'preview' ? 'preview' : 'production'), 'Unexpected deployment environment.');
  const page = await html(deployment.url);
  const local = fs.readFileSync(path.join(process.env.RELEASE_SITE, 'policy-action.html'), 'utf8').replace(/\r\n/g, '\n');
  check(page === local, 'Served policy page does not match reviewed file.');
  const current = await production();
  check(current.id === (mode === 'preview' ? baseline.id : deployment.id), 'Unexpected canonical deployment after ' + mode + '.');
  const receipt = { mode, id: deployment.id, url: deployment.url, rollback: baseline.id, commit: source.commit, site_files: 188, manifest_verified: true, policy_page_verified: true, canonical: mode === 'production' };
  save(mode + '-receipt.json', receipt);
  console.log(JSON.stringify(receipt));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    '\n### Verified ' + mode + '\n\n- Deployment: ' + deployment.id + '\n- URL: ' + deployment.url +
    '\n- Rollback: ' + baseline.id + '\n- 188 files, exact manifest and policy page verified.\n');
}
module.exports = { excluded, differences };
if (require.main === module) {
  const command = process.argv[2];
  Promise.resolve().then(() => {
    if (command === 'prepare') return prepare();
    if (command === 'preflight') return preflight();
    if (command === 'before-production') return beforeProduction();
    if (command === 'verify-preview') return verify('preview');
    if (command === 'verify-production') return verify('production');
    throw new Error('Unknown release command.');
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}


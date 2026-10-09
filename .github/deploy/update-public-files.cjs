const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { excluded } = require('./pages-release.cjs');
const policyPath = path.join(__dirname, 'release-policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath));
const allowNew = process.argv.includes('--approve-additions');
const checkOnly = process.argv.includes('--check');
try {
  const rows = execFileSync('git', ['ls-files', '--stage', '-z']).toString().split('\0').filter(Boolean);
  const next = {};
  for (const row of rows) {
    const offset = row.indexOf('\t');
    const [mode, hash, stage] = row.slice(0, offset).split(' '), name = row.slice(offset + 1);
    if (excluded(name)) continue;
    if (mode !== '100644' || stage !== '0') throw Error('Resolve unsupported files or conflicts before updating approval.');
    if (!(name in policy.approved_public_files) && !allowNew) throw Error('New tracked files require human review and --approve-additions. No fingerprints were written.');
    next[name] = hash;
  }
  const before = policy.approved_public_files;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(next)])];
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const name of keys) if (before[name] !== next[name]) counts[!(name in next) ? 'removed' : !(name in before) ? 'added' : 'changed']++;
  console.log('Staged public fingerprint changes: ' + JSON.stringify(counts));
  if (checkOnly) {
    if (Object.values(counts).some(Boolean)) throw Error('Public fingerprints need updating.');
  } else {
    policy.approved_public_files = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(policyPath, JSON.stringify(policy, null, 2) + '\n');
    console.log('Updated fingerprints from the staged Git index. Review and stage this policy change in the same PR.');
  }
} catch (error) {
  console.error(error.message.startsWith('Command failed') ? 'Could not read the staged Git index.' : error.message);
  process.exitCode = 1;
}

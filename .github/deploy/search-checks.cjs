const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { differences } = require('./pages-release.cjs');
const rebuilt = path.join(process.env.RELEASE_TOOLS, 'rebuilt-pagefind');
const cli = path.join(process.env.RELEASE_TOOLS, 'node_modules', 'pagefind', 'lib', 'runner', 'bin.cjs');
function critical(root) {
  const result = {};
  function walk(dir, prefix = '') {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name), relative = prefix + name;
      if (fs.statSync(full).isDirectory()) walk(full, relative + '/');
      else if (/pagefind-entry\.json$|\.pf_(?:fragment|index|meta)$|\.pagefind$/.test(relative)) {
        result[relative] = require('node:crypto').createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    }
  }
  walk(root);
  return result;
}
try {
  require('./build-search.cjs').build(process.env.RELEASE_SITE, rebuilt, process.env.RELEASE_TOOLS, JSON.parse(fs.readFileSync('.github/deploy/release-policy.json')));
  const changes = differences(critical(path.join(process.env.RELEASE_SITE, 'pagefind')), critical(rebuilt));
  const report = { passed: changes.length === 0, different_files: changes.map(item => item.path) };
  fs.writeFileSync(path.join(process.env.RELEASE_EVIDENCE, 'search-rebuild-check.json'), JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) throw Error('Committed search data differs from a fresh index of the staged HTML; regenerate and review Pagefind in GitHub.');
  console.log('Committed search index exactly matches a fresh verification build; the rebuild is never uploaded.');
} catch (error) {
  console.error(error.message.startsWith('Committed search') ? error.message : 'Search verification build failed.');
  process.exitCode = 1;
}

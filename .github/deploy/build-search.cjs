const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

function build(site, output, tools, policy) {
  const names = Object.keys(policy.approved_public_files).filter(name => {
    if (!name.endsWith('.html') || policy.test_pages.includes(name) || policy.search_exclusions.includes(name)) return false;
    const html = fs.readFileSync(path.join(site, name), 'utf8');
    const attribute = (tag, key) => {
      const found = tag.match(new RegExp('\\b' + key + '\\s*=\\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\\s>]+))', 'i'));
      return found ? (found[1] ?? found[2] ?? found[3]) : '';
    };
    return !(html.match(/<meta\b[^>]*>/gi) || []).some(tag => attribute(tag, 'name').toLowerCase() === 'robots' && /\bnoindex\b/i.test(attribute(tag, 'content')));
  }).sort();
  if (!names.length || names.some(name => /[{},*?\[\]]/.test(name))) throw Error('Unsupported search source list.');
  const glob = names.length === 1 ? names[0] : '{' + names.join(',') + '}';
  const cli = path.join(tools, 'node_modules', 'pagefind', 'lib', 'runner', 'bin.cjs');
  execFileSync(process.execPath, [cli, '--site', site, '--output-path', output, '--glob', glob], { stdio: 'pipe', timeout: 120000 });
}
module.exports = { build };
if (require.main === module) {
  try {
    const [site, output, tools, policyFile] = process.argv.slice(2);
    build(site, output, tools, JSON.parse(fs.readFileSync(policyFile)));
    console.log('Built search from approved public HTML; test and noindex pages excluded.');
  } catch { console.error('Search build failed.'); process.exitCode = 1; }
}

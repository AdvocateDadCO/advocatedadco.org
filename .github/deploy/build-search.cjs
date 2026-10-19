const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

// Approved, indexable HTML pages in a fixed sorted order. Test and noindex pages are excluded.
function sources(site, policy) {
  const names = Object.keys(policy.approved_public_files).filter(name => {
    if (!name.endsWith('.html') || policy.test_pages.includes(name) || policy.search_exclusions.includes(name)) return false;
    const html = fs.readFileSync(path.join(site, name), 'utf8');
    const attribute = (tag, key) => {
      const found = tag.match(new RegExp('\\b' + key + '\\s*=\\s*(?:"([^"]*)"|\x27([^\x27]*)\x27|([^\\s>]+))', 'i'));
      return found ? (found[1] ?? found[2] ?? found[3]) : '';
    };
    return !(html.match(/<meta\b[^>]*>/gi) || []).some(tag => attribute(tag, 'name').toLowerCase() === 'robots' && /\bnoindex\b/i.test(attribute(tag, 'content')));
  }).sort();
  if (!names.length) throw Error('Unsupported search source list.');
  return names;
}

// The Pagefind CLI numbers pages in filesystem directory order, so its index differs between
// machines for identical HTML. Adding the same pages through the Pagefind API in sorted order
// gives byte-identical search data on any machine, so the committed index can be checked exactly.
async function build(site, output, tools, policy) {
  const names = sources(site, policy);
  const pagefind = await import(pathToFileURL(path.join(tools, 'node_modules', 'pagefind', 'lib', 'index.js')).href);
  try {
    const { index, errors } = await pagefind.createIndex({});
    if (errors.length || !index) throw Error('Search index could not be created.');
    for (const name of names) {
      const added = await index.addHTMLFile({ sourcePath: name, content: fs.readFileSync(path.join(site, name), 'utf8') });
      if (added.errors.length) throw Error('Search page could not be indexed.');
    }
    const written = await index.writeFiles({ outputPath: output });
    if (written.errors.length) throw Error('Search files could not be written.');
  } finally {
    await pagefind.close();
  }
}
module.exports = { build, sources };
if (require.main === module) {
  const [site, output, tools, policyFile] = process.argv.slice(2);
  build(site, output, tools, JSON.parse(fs.readFileSync(policyFile)))
    .then(() => console.log('Built search from approved public HTML in sorted order; test and noindex pages excluded.'))
    .catch(() => { console.error('Search build failed.'); process.exitCode = 1; });
}

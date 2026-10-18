// Run from the macos package: node Tests/EverplainCoreTests/Fixtures/ResearchWorkspaceExportCSLChecks.js
const fs = require('fs');
const vm = require('vm');
const assert = require('assert/strict');
const path = require('path');
const directory = process.argv[2] || path.resolve('Sources/EverplainMac/Resources/ResearchExport');
const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
const context = { module: { exports: {} }, console: { log() {}, warn() {}, error() {} } };
vm.createContext(context);
vm.runInContext(read('citeproc.js'), context);
vm.runInContext(read('bibliography.js'), context);
const items = [
  {id:'zhou',type:'article-journal',title:'Intergenerational Care across Migration',author:[{family:'Zhou',given:'Min'}],issued:{'date-parts':[[2024]]},'container-title':'Journal of Family Sociology',volume:'18',issue:'2',page:'101-122'},
  {id:'li',type:'book',title:'流动家庭与代际照护',author:[{family:'李',given:'敏'}],issued:{'date-parts':[[2023]]},publisher:'社会科学文献出版社','publisher-place':'北京',language:'zh-CN'}
];
function format(style, locale, citations = items) {
  return JSON.parse(context.everplainFormatBibliography(JSON.stringify({items:citations, style, locale, localeXML:read('locales-'+locale+'.xml')})));
}
const asa = format(read('american-sociological-association.csl'),'en-US');
const gbt = format(read('china-national-standard-gb-t-7714-2015-author-date.csl'),'zh-CN');
const chicago = format(read('chicago-author-date.csl'),'en-US');
assert.match(asa.textEntries.join(''),/Zhou, Min/);
assert.match(gbt.textEntries.join(''),/李敏/);
assert.match(gbt.textEntries.join(''),/ZHOU M/);
assert.notEqual(asa.textEntries.join(''),gbt.textEntries.join(''));
assert.notEqual(chicago.textEntries.join(''),asa.textEntries.join(''));
assert.equal(format(read('american-sociological-association.csl'),'en-US',[]).textEntries.length,0);
assert.throws(() => format('invalid CSL','en-US'));
const custom = '<?xml version="1.0" encoding="utf-8"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0" class="in-text"><info><title>Fixture style</title><id>https://example.org/style</id><updated>2026-01-01T00:00:00+00:00</updated></info><citation><layout><text variable="title"/></layout></citation><bibliography><layout><text variable="title" font-style="italic"/></layout></bibliography></style>';
const dangerousTitle = '</script><script>globalThis.compromised=true</script>';
const result = format(custom,'en-US',[{id:'danger',type:'book',title:dangerousTitle}]);
assert.equal(context.compromised,undefined);
assert.match(result.htmlEntries.join(''),/(?:&lt;|&#60;)\/script(?:&gt;|&#62;)/);
assert.match(result.htmlEntries.join(''),/<i>/);
console.log('CSL checks passed: exact ASA, GB/T 7714, Chicago, custom style, empty metadata, malformed style, and inert hostile title.');

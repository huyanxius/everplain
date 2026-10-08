const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const assets = path.resolve(__dirname,'../../app/src/main/assets/document-diff');
const manifest = JSON.parse(fs.readFileSync(path.join(assets,'provenance.json')));
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
assert.equal(hash(path.join(assets,'web-document-diff.js')),manifest.bundleSha256);
assert.equal(hash(path.join(__dirname,'web-document-diff.ts')),manifest.sourceSha256);
manifest.packages.forEach(p=>assert.equal(hash(path.join(assets,p.licenseFile)),p.licenseSha256));
const context = vm.createContext({}); // deliberately no document, window, fetch or native bridges
vm.runInContext(fs.readFileSync(path.join(assets,'web-document-diff.js'),'utf8'),context,{timeout:5000});
const diff = (base,proposed) => JSON.parse(context.EverplainDocumentDiff.diffJson(JSON.stringify({base,proposed})));
assert.deepEqual(diff('迁移后的照护主要由**母亲**承担。','迁移后的照护主要由**祖辈**承担，并依赖邻里互助。'),[
 {kind:'unchanged',text:'迁移后的照护主要由'},{kind:'deleted',text:'母亲'},{kind:'inserted',text:'祖辈'},
 {kind:'unchanged',text:'承担'},{kind:'inserted',text:'，并依赖邻里互助'},{kind:'unchanged',text:'。'}]);
assert.deepEqual(diff('## Findings\n\n- Grandparents provide daily care.\n- Mothers coordinate remotely.','## Findings\n\n- Grandparents provide daily care.\n- Parents coordinate remotely.').filter(x=>x.kind!=='unchanged'),[{kind:'deleted',text:'Mothers'},{kind:'inserted',text:'Parents'}]);
assert.deepEqual(diff('**同一段😀**','**同一段😀**'),[{kind:'unchanged',text:'同一段😀'}]);
assert.throws(()=>diff('x'.repeat(200001),'short'),/bound/);
assert.equal(vm.runInContext('typeof window + ":" + typeof document + ":" + typeof fetch',context),'undefined:undefined:undefined');
console.log('PASS 5 isolated diff checks, source/bundle/36 license hashes');
(async () => {
  const payload = '研究😀与\\\'\";throw new Error(\'injected\');\u2028后续中文';
  const bytes = Buffer.from(JSON.stringify({base:payload,proposed:payload}),'utf8');
  context.android = {consumeNamedDataAsArrayBuffer(name) {
    assert.equal(name,'request');
    return Promise.resolve(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  }};
  const result = JSON.parse(await vm.runInContext(fs.readFileSync(path.join(__dirname,'runtime-envelope.js'),'utf8'),context,{timeout:5000}));
  assert.equal(result.length,1);
  assert.equal(result[0].kind,'unchanged');
  assert.ok(result[0].text.includes('研究😀'));
  assert.ok(result[0].text.includes('throw new Error'));
  assert.ok(result[0].text.includes('后续中文'));
  console.log('PASS fixed named-buffer UTF8 envelope; quotes, emoji and source-looking text stay data');
})().catch(error=>{console.error(error);process.exitCode=1});
assert.throws(()=>diff('现有正文',''),/Invalid content for node doc/); // Preserve the actual Web boundary; no invented fallback.
const emojiRaw=diff('😀','😃');
assert.deepEqual(emojiRaw.map(p=>[p.kind,Array.from({length:p.text.length},(_,i)=>p.text.charCodeAt(i))]),[
 ['unchanged',[0xD83D]],['deleted',[0xDE00]],['inserted',[0xDE03]]
]);
console.log('PASS source empty-proposal error and exact split-surrogate wire boundary');

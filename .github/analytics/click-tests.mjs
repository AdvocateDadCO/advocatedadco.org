import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from './resource-click-worker.mjs';
const {catalog,allowed}=JSON.parse(fs.readFileSync(new URL('./resource-catalog.json',import.meta.url)));
const resource=allowed.resources[0], writes=[];
const env={CLICKS:{writeDataPoint:v=>writes.push(v)}};
const request=(data,headers={},url='/event')=>new Request('https://counter.example'+url,{method:'POST',headers:{Origin:'https://advocatedadco.org','Content-Type':'application/json',...headers},body:JSON.stringify(data)});
assert.equal((await worker.fetch(request({resource,page:'resources',test:true}),env)).status,204);
assert.deepEqual(writes[0],{indexes:[resource],blobs:[resource,catalog[resource].name,'resources',catalog[resource].kind,'test'],doubles:[1]});
for(const payload of [{resource:'unknown',page:'resources'},{resource,page:'private'},{resource,page:'resources',email:'do-not-store@example.invalid'},{resource,page:'resources',test:'yes'},null])assert.equal((await worker.fetch(request(payload),env)).status,400);
assert.equal((await worker.fetch(request({resource,page:'resources'},{Origin:'https://other.example'}),env)).status,403);
assert.equal((await worker.fetch(request({resource,page:'resources'},{DNT:'1'}),env)).status,204);
assert.equal((await worker.fetch(request({resource,page:'resources'},{'Sec-GPC':'1'}),env)).status,204);
assert.equal(writes.length,1);
assert.equal((await worker.fetch(request({resource,page:'resources'}, {},'/event?ignored=1'),env)).status,404);
assert.equal((await worker.fetch(request({resource,page:'resources'}),{})).status,503);
assert.equal((await worker.fetch(request({resource,page:'resources'},{'Content-Length':'999'}),env)).status,413);
assert.equal((await worker.fetch(new Request('https://counter.example/event',{method:'OPTIONS',headers:{Origin:'https://advocatedadco.org'}}),env)).status,204);
const source=fs.readFileSync(new URL('../../resource-clicks.js',import.meta.url),'utf8');
function client({gpc=false,dnt='0',host='advocatedadco.org',search='',pathname='/resources',id=resource}={}){
 const handlers={},requests=[];let now=1000;
 class Element{closest(){return{dataset:{resourceId:id}};}}
 const context={Element,location:{hostname:host,pathname,search},navigator:{globalPrivacyControl:gpc,doNotTrack:dnt},window:{},performance:{now:()=>now},URLSearchParams,document:{addEventListener:(name,fn)=>handlers[name]=fn},fetch:(...args)=>{requests.push(args);return Promise.resolve();}};
 vm.runInNewContext(source,context);
 return{handlers,requests,click:(type='click',button=0,trusted=true)=>{now+=1000;handlers[type]?.({type,isTrusted:trusted,button,target:new Element()});}};
}
for(const options of [{gpc:true},{dnt:'1'},{host:'preview.example'}])assert.deepEqual(Object.keys(client(options).handlers),[]);
const c=client({search:'?resource_tracking_test=1&private_value=never-send'});
c.click();c.click('auxclick',1);c.click('auxclick',2);c.click('click',0,false);
assert.equal(c.requests.length,2);
assert.deepEqual(JSON.parse(c.requests[0][1].body),{resource,page:'resources',test:true});
assert.equal(c.requests[0][1].referrerPolicy,'no-referrer');
assert.equal(c.requests[0][1].credentials,'omit');
assert.equal(c.requests[0][1].keepalive,true);
assert.ok(!JSON.stringify(c.requests).includes('private_value'));
// Root and clean/HTML aliases must produce the same reviewed source-page ID.
for(const [page,paths] of Object.entries({home:['/','/index','/index.html','/index/'],'from-access-to-agency':['/from-access-to-agency','/from-access-to-agency.html'],'ecc-transition-readiness-families':['/ecc-transition-readiness-families','/ecc-transition-readiness-families.html']})){
 const id=allowed[page][0];
 for(const pathname of paths){
  const browser=client({pathname,id,search:'?resource_tracking_test=1&private_value=never-send'});browser.click();
  assert.equal(browser.requests.length,1);
  const payload=JSON.parse(browser.requests[0][1].body);
  assert.deepEqual(payload,{resource:id,page,test:true});
  const before=writes.length;
  assert.equal((await worker.fetch(request(payload),env)).status,204);
  assert.equal(writes.length,before+1);
  assert.equal(writes.at(-1).blobs[4],'test');
 }
 for(const privacy of [{gpc:true},{dnt:'1'}])assert.deepEqual(Object.keys(client({pathname:paths[0],id,...privacy}).handlers),[]);
}
const articleOnly=allowed.home.find(id=>!allowed.resources.includes(id));
assert.equal((await worker.fetch(request({resource:articleOnly,page:'resources',test:true}),env)).status,400);
assert.deepEqual(Object.keys(client({pathname:'/private'}).handlers),[]);
// Actual HTML and the deployed Worker constants must agree with the reviewed catalog.
const normalize=value=>{const u=new URL(value,'https://advocatedadco.org/');u.hash='';u.pathname=u.pathname.replace(/\.html$/,'');return u.href;};
for(const [page,ids] of Object.entries(allowed)){
 const file=page==='home'?'index.html':page+'.html';
 const html=fs.readFileSync(new URL('../../'+file,import.meta.url),'utf8');
 const marked=[...html.matchAll(/<a\b[^>]*data-resource-id="([^"]+)"[^>]*>/g)];
 const seen=new Set();
 for(const [tag,id] of marked){assert.ok(ids.includes(id),`${file}: unapproved ID`);assert.ok(catalog[id]);assert.equal(normalize(tag.match(/href="([^"]+)"/)[1]),normalize(catalog[id].url));seen.add(id);}
 assert.deepEqual([...seen].sort(),[...ids].sort(),`${file}: catalog coverage mismatch`);
}
const workerSource=fs.readFileSync(new URL('./resource-click-worker.mjs',import.meta.url),'utf8');
assert.deepEqual(JSON.parse(workerSource.match(/const \{catalog, allowed\} = (.*);/)[1]),{catalog,allowed});
console.log('PASS: resource validation, data minimization, test separation, origin restrictions, privacy signals, keyboard/primary and middle-click handling, and nonblocking requests.');

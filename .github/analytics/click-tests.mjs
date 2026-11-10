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
function client({gpc=false,dnt='0',host='advocatedadco.org',search=''}={}){
 const handlers={},requests=[];let now=1000;
 class Element{closest(){return{dataset:{resourceId:resource}};}}
 const context={Element,location:{hostname:host,pathname:'/resources',search},navigator:{globalPrivacyControl:gpc,doNotTrack:dnt},window:{},performance:{now:()=>now},URLSearchParams,document:{addEventListener:(name,fn)=>handlers[name]=fn},fetch:(...args)=>{requests.push(args);return Promise.resolve();}};
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
console.log('PASS: resource validation, data minimization, test separation, origin restrictions, privacy signals, keyboard/primary and middle-click handling, and nonblocking requests.');

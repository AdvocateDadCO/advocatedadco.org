(() => {
'use strict';
const dialog=document.querySelector('#viewer');
if(!dialog || typeof dialog.showModal!=='function')return;
const links=[...document.querySelectorAll('.photo-link')];
const get=id=>document.getElementById(id);
const area=get('photo-area'), img=get('full-photo'), title=get('viewer-title'), status=get('viewer-status');
let photos=null,index=0,zoom=1,opener=null,sequence=0,ready=false;
function size(){
 if(!photos)return;
 const p=photos[index], base=Math.min(area.clientWidth/p.originalWidth,area.clientHeight/p.originalHeight,1);
 img.style.width=Math.round(p.originalWidth*base*zoom)+'px';
 img.style.height=Math.round(p.originalHeight*base*zoom)+'px';
 get('zoom-level').textContent=zoom===1?'Fit':`${Math.round(zoom*100)}% of fit`;
 get('zoom-out').disabled=zoom<=1;get('zoom-in').disabled=zoom>=8;
}
function show(n){
 index=(n+photos.length)%photos.length;zoom=1;ready=false;
 const p=photos[index],current=++sequence;
 title.textContent=`Photo ${index+1} of ${photos.length}: ${p.caption}`;
 get('description').textContent=p.alt;
 get('full-link').href='/'+p.full;
 get('full-link').textContent=`Open full-size photo ${index+1} (${p.originalWidth.toLocaleString()} × ${p.originalHeight.toLocaleString()}; ${(p.fullBytes/1e6).toFixed(1)} MB)`;
 status.textContent=`Loading photo ${index+1} of ${photos.length}: ${p.caption}.`;
 img.hidden=true;img.alt=p.alt;img.removeAttribute('src');
 img.onload=()=>{if(current!==sequence)return;ready=true;img.hidden=false;size();status.textContent=`Photo ${index+1} of ${photos.length}: ${p.caption}. Loaded.`;};
 img.onerror=()=>{if(current===sequence)status.textContent='The photo could not load. Try the full-size image link below.';};
 size();area.scrollTop=0;area.scrollLeft=0;img.src='/'+p.full;
}
for(const link of links)link.addEventListener('click',async event=>{
 if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button!==0)return;
 event.preventDefault();opener=link;
 try{
  if(!photos){const r=await fetch('/dc-album-data.json');if(!r.ok)throw Error('Album unavailable');photos=await r.json();}
  document.body.classList.add('viewer-open');dialog.showModal();show(Number(link.dataset.index));title.focus();
 }catch{document.body.classList.remove('viewer-open');location.href=link.href;}
});
get('close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('close',()=>{sequence++;img.removeAttribute('src');document.body.classList.remove('viewer-open');opener?.focus();});
get('previous').addEventListener('click',()=>show(index-1));get('next').addEventListener('click',()=>show(index+1));
function changeZoom(value){zoom=Math.max(1,Math.min(8,value));size();if(zoom===1){area.scrollTop=0;area.scrollLeft=0;}}
get('zoom-in').addEventListener('click',()=>changeZoom(zoom*2));get('zoom-out').addEventListener('click',()=>changeZoom(zoom/2));get('fit').addEventListener('click',()=>changeZoom(1));
dialog.addEventListener('keydown',event=>{
 if(event.key==='Tab'){
  const focusable=[...dialog.querySelectorAll('button:not(:disabled),a[href],[tabindex="0"]')];
  const first=focusable[0],last=focusable.at(-1);
  if(event.shiftKey&&(document.activeElement===first||document.activeElement===title)){event.preventDefault();last.focus();}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
 }
 if(event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
 if(document.activeElement===area&&zoom>1)return;
 if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();show(index+(event.key==='ArrowRight'?1:-1));}
});
window.addEventListener('resize',()=>{if(dialog.open)size();});
})();

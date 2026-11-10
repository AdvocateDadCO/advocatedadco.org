/* Aggregate resource selections only. Links work independently of this script. */
(() => {
  'use strict';
  if (!['advocatedadco.org', 'www.advocatedadco.org'].includes(location.hostname)) return;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  const page = location.pathname.replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
  if (!['resources', 'how-can-i-help', 'blv-professional-access', 'project-inspire'].includes(page)) return;
  const endpoint = 'https://advocatedad-resource-clicks.trebor681.workers.dev/event';
  let lastId = '', lastAt = 0;
  function record(event) {
    if (!event.isTrusted || (event.type === 'auxclick' && event.button !== 1) || (event.type === 'click' && event.button !== 0)) return;
    const link = event.target instanceof Element ? event.target.closest('a[data-resource-id]') : null;
    if (!link) return;
    const id = link.dataset.resourceId;
    if (!/^r[a-f0-9]{12}$/.test(id)) return;
    const now = performance.now();
    if (id === lastId && now - lastAt < 600) return;
    lastId = id; lastAt = now;
    const payload = {resource:id, page};
    if (new URLSearchParams(location.search).get('resource_tracking_test') === '1') payload.test = true;
    try {
      fetch(endpoint, {method:'POST', mode:'cors', credentials:'omit', referrerPolicy:'no-referrer', keepalive:true,
        headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)}).catch(() => {});
    } catch (_) { /* Measurement must never prevent navigation. */ }
  }
  document.addEventListener('click', record, {capture:true, passive:true});
  document.addEventListener('auxclick', record, {capture:true, passive:true});
})();

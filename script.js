const status = document.querySelector('#share-status');
const copyButton = document.querySelector('#copy-button');
const url = window.location.href;

copyButton?.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = 'Page link copied.';
  } catch {
    status.textContent = 'Select the address in your browser to copy this page.';
  }
});

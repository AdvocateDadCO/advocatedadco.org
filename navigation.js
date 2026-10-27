const menuButton = document.querySelector('.menu-toggle');
const primaryNav = document.querySelector('#primary-nav');

menuButton?.addEventListener('click', () => {
  const open = menuButton.getAttribute('aria-expanded') === 'true';
  menuButton.setAttribute('aria-expanded', String(!open));
  primaryNav?.classList.toggle('nav-open', !open);
});

primaryNav?.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton?.setAttribute('aria-expanded', 'false');
    primaryNav.classList.remove('nav-open');
  });
});

// Escape closes the disclosure and returns keyboard users to its trigger.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || menuButton?.getAttribute('aria-expanded') !== 'true') return;
  event.preventDefault();
  menuButton.setAttribute('aria-expanded', 'false');
  primaryNav?.classList.remove('nav-open');
  menuButton.focus();
});

// Keep links available when JavaScript is unavailable.
if (menuButton && primaryNav) document.documentElement.classList.add('navigation-ready');

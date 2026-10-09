(() => {
  'use strict';
  const carousel = document.querySelector('.dc-highlights');
  if (!carousel) return;
  const slides = [...carousel.querySelectorAll('.dc-highlight-slide')];
  const controls = carousel.querySelector('.dc-highlight-controls');
  const play = carousel.querySelector('.dc-highlight-play');
  const picker = carousel.querySelector('select');
  const count = carousel.querySelector('.dc-highlight-count');
  const announcement = carousel.querySelector('.dc-highlight-announcement');
  let current = 0;
  let timer = null;

  function pause() {
    window.clearInterval(timer);
    timer = null;
    play.textContent = 'Play slideshow';
    play.setAttribute('aria-label', 'Play slideshow');
    announcement.setAttribute('aria-live', 'polite');
  }

  function show(index, announce = true) {
    current = (index + slides.length) % slides.length;
    slides.forEach((slide, n) => { slide.hidden = n !== current; });
    slides[current].querySelector('img').loading = 'eager';
    picker.value = String(current);
    count.textContent = `${current + 1} / ${slides.length}`;
    if (announce && !timer) {
      announcement.textContent = `Photo ${current + 1} of ${slides.length}: ${slides[current].querySelector('figcaption').textContent}`;
    }
  }

  function step(amount) { pause(); show(current + amount); }
  carousel.querySelector('.dc-highlight-prev').addEventListener('click', () => step(-1));
  carousel.querySelector('.dc-highlight-next').addEventListener('click', () => step(1));
  picker.addEventListener('change', () => { pause(); show(Number(picker.value)); });
  play.addEventListener('click', () => {
    if (timer) { pause(); return; }
    announcement.textContent = '';
    announcement.setAttribute('aria-live', 'off');
    play.textContent = 'Pause slideshow';
    play.setAttribute('aria-label', 'Pause slideshow');
    timer = window.setInterval(() => show(current + 1, false), 6500);
  });
  carousel.addEventListener('keydown', event => {
    if (event.target.tagName === 'SELECT') return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  carousel.addEventListener('focusin', pause);
  carousel.addEventListener('mouseenter', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.addEventListener('change', pause);
  show(0, false);
  carousel.classList.add('is-enhanced');
  controls.hidden = false;
})();

// ========================================
// NAVIGATION
// ========================================

const hamburger = document.getElementById('navHamburger');
const mobileMenu = document.getElementById('mobileMenu');

// Mobile menu toggle
if (hamburger && mobileMenu) {
  hamburger.addEventListener('click', () => {
    const isOpen = mobileMenu.classList.contains('mobile-menu--open');
    mobileMenu.classList.toggle('mobile-menu--open');
    hamburger.classList.toggle('nav__hamburger--open');
    document.body.style.overflow = isOpen ? '' : 'hidden';
    hamburger.setAttribute('aria-label', isOpen ? 'Menü öffnen' : 'Menü schließen');
  });

  // Close on link click
  mobileMenu.querySelectorAll('.mobile-menu__link').forEach(link => {
    link.addEventListener('click', () => {
      mobileMenu.classList.remove('mobile-menu--open');
      hamburger.classList.remove('nav__hamburger--open');
      document.body.style.overflow = '';
    });
  });
}

// Close mobile menu on escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mobileMenu?.classList.contains('mobile-menu--open')) {
    mobileMenu.classList.remove('mobile-menu--open');
    hamburger.classList.remove('nav__hamburger--open');
    document.body.style.overflow = '';
  }
});

// ========================================
// HERO VIDEO — force autoplay on mobile
// ========================================
// iOS Safari and some Android browsers silently ignore the autoplay
// HTML attribute if muted/playsinline aren't set via JS properties,
// and occasionally require an explicit play() call. We force both
// on load and retry on the first user interaction as a last resort.
const heroVideo = document.querySelector('.hero__video');
if (heroVideo) {
  heroVideo.muted = true;
  heroVideo.defaultMuted = true;
  heroVideo.playsInline = true;
  heroVideo.setAttribute('muted', '');
  heroVideo.setAttribute('playsinline', '');
  heroVideo.setAttribute('webkit-playsinline', '');

  const tryPlayHero = () => {
    const p = heroVideo.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => { /* will retry on user interaction */ });
    }
  };

  tryPlayHero();

  // Retry when the video is ready enough to play
  heroVideo.addEventListener('loadedmetadata', tryPlayHero, { once: true });
  heroVideo.addEventListener('canplay', tryPlayHero, { once: true });

  // Final fallback: kick it off on the first user interaction
  const unlockHero = () => {
    tryPlayHero();
    document.removeEventListener('touchstart', unlockHero);
    document.removeEventListener('click', unlockHero);
    document.removeEventListener('scroll', unlockHero);
  };
  document.addEventListener('touchstart', unlockHero, { passive: true, once: true });
  document.addEventListener('click', unlockHero, { passive: true, once: true });
  document.addEventListener('scroll', unlockHero, { passive: true, once: true });
}

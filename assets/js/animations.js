// ========================================
// SCROLL REVEAL ANIMATIONS
// ========================================

const revealElements = document.querySelectorAll('.reveal, .reveal--left, .reveal--right');

if (revealElements.length > 0) {
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('reveal--visible');
        revealObserver.unobserve(entry.target);
      }
    });
  }, {
    threshold: 0.15,
    rootMargin: '0px 0px -50px 0px'
  });

  revealElements.forEach(el => revealObserver.observe(el));
}

// ========================================
// PACKAGE BREAK — parallax: image scrolls slower than the page so we appear
// to "drive through" the image as the user scrolls.
// ========================================

(function setupPackageBreakParallax() {
  const images = document.querySelectorAll('.package-break img');
  if (!images.length) return;

  let ticking = false;

  const update = () => {
    const vh = window.innerHeight;
    images.forEach(img => {
      const wrap = img.parentElement;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      // Skip work when the wrapper is far from viewport
      if (rect.bottom < -200 || rect.top > vh + 200) return;
      // Progress: -1 when wrapper is just below viewport, +1 when just above
      const center = (rect.top + rect.height / 2) - vh / 2;
      const range = vh / 2 + rect.height / 2;
      const progress = Math.max(-1, Math.min(1, center / range));
      // Image is 130% of container — has 30% headroom (15% top + 15% bottom)
      // Translate within that headroom for the parallax effect.
      img.style.transform = `translate3d(0, ${(progress * -12).toFixed(2)}%, 0)`;
    });
    ticking = false;
  };

  const onScroll = () => {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  };

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  update();
})();
// Nur das Video, das mindestens 50% im Viewport ist, wird geladen.
// Sobald es darunter fällt, schaltet src auf about:blank und der Stream
// stoppt — verhindert Bandbreiten-Konflikte und Lag bei den nächsten Videos.
// ========================================

const filmFrames = document.querySelectorAll('.film-showcase__frame iframe[data-src]');

if (filmFrames.length > 0) {
  const setFilmPlaying = (iframe, playing) => {
    if (playing) {
      if (iframe.dataset.playing !== 'true') {
        iframe.src = iframe.dataset.src;
        iframe.dataset.playing = 'true';
      }
    } else {
      if (iframe.dataset.playing === 'true') {
        iframe.src = 'about:blank';
        iframe.dataset.playing = 'false';
      }
    }
  };

  const filmFrameObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      setFilmPlaying(entry.target, entry.intersectionRatio >= 0.5);
    });
  }, {
    threshold: [0, 0.5, 1],
    rootMargin: '0px'
  });

  filmFrames.forEach(frame => filmFrameObserver.observe(frame));
}

// ========================================
// EDITORIAL MARQUEE — device-consistent speed
// The track scales with viewport via fluid clamp() font-size, so a fixed
// animation duration feels different on each screen (fast on wide desktops,
// slow on phones). Compute the duration from the measured track width to
// keep the scroll speed constant at ~SPEED_PX pixels/second everywhere.
// ========================================

(function setupEditorialMarquee() {
  const SPEED_PX = 110; // pixels per second — tune for feel
  const tracks = document.querySelectorAll('.editorial-marquee__track');
  if (!tracks.length) return;

  function updateDuration(track) {
    // The track repeats its tags 2× so translateX(-50%) loops seamlessly.
    // Animated distance is therefore scrollWidth / 2.
    const distance = track.scrollWidth / 2;
    if (!distance) return;
    const duration = Math.max(20, distance / SPEED_PX);
    track.style.animationDuration = duration + 's';
  }

  tracks.forEach(track => {
    // Wait for webfonts, then measure. Layout shift after font-load changes
    // the width significantly.
    const apply = () => updateDuration(track);
    apply();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(apply);
    }
    window.addEventListener('resize', apply);
  });
})();

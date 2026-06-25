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
// FILM SHOWCASE — play while visible, stop when scrolled past
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
      // Load as soon as the frame approaches the viewport, unload only once it
      // is well past. The previous "must be >=50% visible" rule was fragile on
      // mobile (short 16:9 frames in a tall viewport sometimes never tripped
      // the 0.5 ratio), leaving the iframe empty. isIntersecting with a
      // generous rootMargin is robust on phones and still lazy.
      setFilmPlaying(entry.target, entry.isIntersecting);
    });
  }, {
    threshold: 0,
    rootMargin: '300px 0px'
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

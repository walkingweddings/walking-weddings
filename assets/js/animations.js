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
// FILM SHOWCASE — scroll progress → --progress
// ========================================

const filmShowcases = document.querySelectorAll('.film-showcase');

if (filmShowcases.length > 0) {
  let ticking = false;

  const updateFilmProgress = () => {
    const vh = window.innerHeight;
    filmShowcases.forEach(showcase => {
      const stage = showcase.querySelector('.film-showcase__stage');
      if (!stage) return;
      const rect = showcase.getBoundingClientRect();
      const total = showcase.offsetHeight - vh;
      if (total <= 0) {
        stage.style.setProperty('--progress', '1');
        return;
      }
      const scrolled = Math.max(0, -rect.top);
      const progress = Math.min(1, Math.max(0, scrolled / total));
      stage.style.setProperty('--progress', progress.toFixed(3));
    });
    ticking = false;
  };

  const onFilmScroll = () => {
    if (!ticking) {
      requestAnimationFrame(updateFilmProgress);
      ticking = true;
    }
  };

  window.addEventListener('scroll', onFilmScroll, { passive: true });
  window.addEventListener('resize', onFilmScroll, { passive: true });
  updateFilmProgress();
}

// ========================================
// FILM SHOWCASE — play while visible, stop when scrolled past
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
      setFilmPlaying(entry.target, entry.isIntersecting);
    });
  }, {
    threshold: 0,
    rootMargin: '200px 0px 200px 0px'
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

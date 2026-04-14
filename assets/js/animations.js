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
// FILM SHOWCASE — lazy + autoplay iframe swap
// ========================================

const filmFrames = document.querySelectorAll('.film-showcase__frame iframe[data-src]');

if (filmFrames.length > 0) {
  const filmFrameObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const iframe = entry.target;
        if (!iframe.src) {
          iframe.src = iframe.dataset.src;
        }
        filmFrameObserver.unobserve(iframe);
      }
    });
  }, {
    threshold: 0,
    rootMargin: '200px 0px 200px 0px'
  });

  filmFrames.forEach(frame => filmFrameObserver.observe(frame));
}

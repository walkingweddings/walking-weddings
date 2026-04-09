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

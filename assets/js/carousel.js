// ========================================
// TESTIMONIAL CROSSFADE CAROUSEL
// ========================================

const slides = document.querySelectorAll('.testimonials__slide');
const dots = document.querySelectorAll('.testimonials__dot');

if (slides.length > 0) {
  let current = 0;
  let interval;

  function goToSlide(index) {
    slides[current].classList.remove('testimonials__slide--active');
    dots[current]?.classList.remove('testimonials__dot--active');
    current = index;
    slides[current].classList.add('testimonials__slide--active');
    dots[current]?.classList.add('testimonials__dot--active');
  }

  function nextSlide() {
    goToSlide((current + 1) % slides.length);
  }

  function startAutoplay() {
    interval = setInterval(nextSlide, 6000);
  }

  function stopAutoplay() {
    clearInterval(interval);
  }

  // Dot navigation
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      stopAutoplay();
      goToSlide(parseInt(dot.dataset.dot));
      startAutoplay();
    });
  });

  // Pause on hover
  const testimonialSection = document.querySelector('.testimonials');
  if (testimonialSection) {
    testimonialSection.addEventListener('mouseenter', stopAutoplay);
    testimonialSection.addEventListener('mouseleave', startAutoplay);
  }

  startAutoplay();
}

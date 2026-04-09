// ========================================
// NAVIGATION
// ========================================

const nav = document.getElementById('nav');
const hamburger = document.getElementById('navHamburger');
const mobileMenu = document.getElementById('mobileMenu');

// Scroll state for nav background
let lastScroll = 0;

function handleNavScroll() {
  const scrollY = window.scrollY;
  const heroHeight = document.querySelector('.hero')?.offsetHeight || 600;

  if (scrollY > 80) {
    nav.classList.add('nav--scrolled');
  } else {
    nav.classList.remove('nav--scrolled');
  }

  // Hide nav after hero, show on hover
  if (scrollY > heroHeight) {
    nav.classList.add('nav--hidden');
  } else {
    nav.classList.remove('nav--hidden');
  }

  lastScroll = scrollY;
}

window.addEventListener('scroll', handleNavScroll, { passive: true });

// Show nav on hover near top of viewport
document.addEventListener('mousemove', (e) => {
  if (e.clientY < 100) {
    nav.classList.add('nav--peek');
  } else {
    nav.classList.remove('nav--peek');
  }
}, { passive: true });

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

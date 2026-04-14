// ========================================
// NAVIGATION
// ========================================

const nav = document.getElementById('nav');
const hamburger = document.getElementById('navHamburger');
const mobileMenu = document.getElementById('mobileMenu');

// Scroll state for nav background (blur when past first viewport)
function handleNavScroll() {
  if (window.scrollY > 80) {
    nav.classList.add('nav--scrolled');
  } else {
    nav.classList.remove('nav--scrolled');
  }
}

window.addEventListener('scroll', handleNavScroll, { passive: true });

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

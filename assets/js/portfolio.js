// ========================================
// PORTFOLIO FILTER
// ========================================

const filterTabs = document.querySelectorAll('.filter-tab');
const portfolioCards = document.querySelectorAll('.portfolio-card');

if (filterTabs.length > 0 && portfolioCards.length > 0) {
  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const filter = tab.dataset.filter;

      // Update active tab
      filterTabs.forEach(t => t.classList.remove('filter-tab--active'));
      tab.classList.add('filter-tab--active');

      // Filter cards
      portfolioCards.forEach(card => {
        const type = card.dataset.type;
        if (filter === 'all' || type === filter) {
          card.style.display = '';
          card.style.opacity = '0';
          requestAnimationFrame(() => {
            card.style.transition = 'opacity 0.5s ease';
            card.style.opacity = '1';
          });
        } else {
          card.style.opacity = '0';
          setTimeout(() => { card.style.display = 'none'; }, 500);
        }
      });
    });
  });
}

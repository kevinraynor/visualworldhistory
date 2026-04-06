// Navigation module — hamburger menu toggle for mobile

export function initNav() {
    const btn = document.getElementById('hamburger-btn');
    if (!btn) return;

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.body.classList.toggle('menu-open');
        // Close controls panel when opening menu
        document.body.classList.remove('controls-open');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!document.body.classList.contains('menu-open')) return;
        if (e.target.closest('.top-bar-right') || e.target.closest('#hamburger-btn')) return;
        document.body.classList.remove('menu-open');
    });

    // Close menu when a nav link is clicked
    document.querySelectorAll('.top-bar-right a, .top-bar-right button').forEach(el => {
        el.addEventListener('click', () => {
            document.body.classList.remove('menu-open');
        });
    });
}

/**
 * Nav Dropdown Interaction Controller for clembot-doorman
 * Works across desktop, tablet, and mobile touch devices.
 * Accessible with keyboard navigation (Tab, Escape, Enter, Space).
 */
(function () {
  'use strict';

  function initNav() {
    var nav = document.getElementById('nav');
    if (!nav) return;

    var dropdowns = Array.from(nav.querySelectorAll('.nav-dropdown'));
    if (!dropdowns.length) return;

    function closeAll(except) {
      dropdowns.forEach(function (dd) {
        if (dd !== except && dd.classList.contains('is-open')) {
          dd.classList.remove('is-open');
          var trigger = dd.querySelector('.nav-dropdown-trigger');
          if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }
      });
    }

    dropdowns.forEach(function (dd) {
      var trigger = dd.querySelector('.nav-dropdown-trigger');
      var menu = dd.querySelector('.nav-dropdown-menu');
      if (!trigger || !menu) return;

      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var wasOpen = dd.classList.contains('is-open');
        closeAll(wasOpen ? null : dd);
        if (!wasOpen) {
          dd.classList.add('is-open');
          trigger.setAttribute('aria-expanded', 'true');
        }
      });

      // Close when clicking a link inside menu
      menu.addEventListener('click', function (e) {
        if (e.target.closest('a')) {
          closeAll();
        }
      });
    });

    // Close when clicking outside (or on backdrop)
    document.addEventListener('click', function (e) {
      if (!e.target.closest('.nav-dropdown-menu') && !e.target.closest('.nav-dropdown-trigger')) {
        closeAll();
      }
    });

    // Close on Escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.key === 'Esc') {
        var openDd = nav.querySelector('.nav-dropdown.is-open');
        if (openDd) {
          var trigger = openDd.querySelector('.nav-dropdown-trigger');
          closeAll();
          if (trigger) trigger.focus();
        }
      }
    });

    // Close on orientation change or desktop breakpoint transition
    var lastW = window.innerWidth;
    window.addEventListener('resize', function () {
      if (Math.abs(window.innerWidth - lastW) > 100) {
        lastW = window.innerWidth;
        closeAll();
      }
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNav);
  } else {
    initNav();
  }
})();

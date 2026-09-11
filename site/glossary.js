/**
 * Clembot Doorman · Interactive Glossary & Concept Callouts
 *
 * Lightweight, zero-dependency engine that manages inline term boxes (.term-box)
 * and displays rich floating callouts on hover, focus, and mobile tap.
 */
(function () {
  'use strict';

  var GLOSSARY = {
    'doorman-needs': {
      title: 'doorman needs',
      isCode: true,
      cat: 'CLI Command',
      meta: 'Local · Free · Offline',
      body: 'Inspects your active build\'s prompt history (~/.claude/projects/) to identify what tools your agent repeatedly reaches for, grouping requests into 12 capability taxonomies to recommend pre-vetted MCP servers.',
      usage: 'doorman needs .'
    },
    'doorman-doctor': {
      title: 'doorman doctor',
      isCode: true,
      cat: 'CLI Command',
      meta: 'Local · Free · Offline',
      body: 'A zero-dependency health check that scans your agent harness configurations (Claude Code, Cursor, Antigravity, Windsurf) to audit tool rosters, active subagents, and token exposure ratios.',
      usage: 'doorman doctor'
    },
    'doorman-report': {
      title: 'doorman report',
      isCode: true,
      cat: 'CLI Command',
      meta: 'Static Scanner · Free',
      body: 'Inspects candidate MCP tool schemas and instructions without executing untrusted code, testing for prompt injection patterns, steering ads, and token-draining schema bloat.',
      usage: 'doorman report <url>'
    },
    'doorman-watch': {
      title: 'doorman watch',
      isCode: true,
      cat: 'CLI Command',
      meta: 'Feed Monitor · Background',
      body: 'Continuously polls MCP registries and feeds for newly graded tool listings, checking scores and blocking rogue tools before unreviewed candidates enter your build.',
      usage: 'doorman watch'
    },
    'doorman-eval': {
      title: 'doorman eval',
      isCode: true,
      cat: 'CLI Command',
      meta: '2-Phase Vet · Full Pipeline',
      body: 'Runs the complete adoption pipeline: performs local Fit Review against your skills first ($0.00), then calls the paid scorecard gateway only if the capability is genuinely novel.',
      usage: 'doorman eval <target>'
    },
    'clembot': {
      title: 'Clembot',
      isCode: false,
      cat: 'Agent Framework',
      meta: 'Autonomous Mesh',
      body: 'A multi-harness autonomous agent architecture combining Claude Code, Google Antigravity, and custom orchestrators. Implements strict role specialization, sandboxed gates, and zero-trust tool adoption.',
      usage: 'Built by Wanessa Labs'
    },
    'mcp': {
      title: 'Model Context Protocol (MCP)',
      isCode: false,
      cat: 'Open Protocol',
      meta: 'Anthropic Standard',
      body: 'An open protocol that standardizes how AI agents connect to external tools, APIs, and data sources via stdio or Server-Sent Events (SSE). Modern foundation for tool calling.',
      usage: 'modelcontextprotocol.io'
    },
    'bazantic': {
      title: 'Bazantic',
      isCode: false,
      cat: 'Gateway & Continuity',
      meta: 'Base Mainnet · x402 Gateway',
      body: 'Decentralized continuity and API agentification network. Hosts clembot-doorman.bazgateway.com to settle evaluation micropayments ($0.01 USDC) and provide repeatable recipe.md guidance.',
      usage: 'clembot-doorman.bazgateway.com'
    },
    'fit-review': {
      title: 'Fit Review',
      isCode: false,
      cat: 'Verification Phase',
      meta: 'Phase 1 · $0.00 Spent',
      body: 'Compares candidate MCP tool capabilities against existing skill frontmatter (.claude/skills, .agents/skills) using local evaluation to stop redundant tool purchases at $0.00 before spending tokens.',
      usage: 'fit-review.mjs'
    },
    'x402': {
      title: 'x402 Protocol',
      isCode: false,
      cat: 'Payment Protocol',
      meta: 'HTTP 402 · Base Network',
      body: 'The standard HTTP 402 Payment Required challenge protocol, enabling autonomous agents to purchase verified tool scorecards using micro-USDC on Base without credit cards.',
      usage: '$0.01 USDC per audit'
    },
    'mcp-gate': {
      title: 'mcp-gate.sh',
      isCode: true,
      cat: 'Security Hook',
      meta: 'Offline Bash Hook · < 5ms',
      body: 'A lightweight 180-line offline bash hook that intercepts all MCP tool invocations in Claude Code and blocks unallowlisted servers before any context reaches the LLM.',
      usage: 'hooks/mcp-gate.sh'
    },
    'allowlist': {
      title: 'Local Allowlist',
      isCode: false,
      cat: 'Tool Governance',
      meta: 'Local JSON Registry',
      body: 'A machine-local, cryptographically hashed ledger of human-approved MCP servers and authorized subagents. Only allowlisted tools pass through the gate.',
      usage: '~/.claude/mcp-registry.json'
    },
    'vet': {
      title: '/vet',
      isCode: true,
      cat: 'Slash Command',
      meta: 'Claude Code Command',
      body: 'An interactive Claude Code chat command (.claude/commands/vet.md) that lets developers audit any MCP URL inline, running the local Fit Review and reporting security status in chat.',
      usage: '/vet <url>'
    },
    'recipe': {
      title: 'recipe.md',
      isCode: true,
      cat: 'Guidance Format',
      meta: 'Deterministic Execution',
      body: 'A compact, structured Markdown specification generated by Bazantic that guides models through tool parameters step-by-step, eliminating schema hallucination.',
      usage: 'Guided tool execution'
    },
    'scorecard': {
      title: 'Scorecard API',
      isCode: false,
      cat: 'Evaluation Service',
      meta: '100-Point Security Audit',
      body: 'Automated adversarial audit service at scorecard.wanessalabs.com that probes candidate MCP tools for prompt injections, parameter hallucination, and behavioral drift.',
      usage: 'scorecard.wanessalabs.com'
    },
    'steering-ads': {
      title: 'Commercial Steering Ads',
      isCode: false,
      cat: 'Attack Vector',
      meta: 'Prompt Hijacking',
      body: 'Prompts embedded in MCP tool descriptions telling reading models to proactively upsell products, recite scripted sales lines, and steer users away from competitors.',
      usage: 'Observed in WebZum (6,290 chars)'
    },
    'prompt-injection': {
      title: 'Indirect Prompt Injection',
      isCode: false,
      cat: 'Attack Vector',
      meta: 'Hostile Metadata',
      body: 'Adversarial instructions disguised inside third-party tool metadata attempting to break agent instructions, bypass safety guardrails, or leak environment credentials.',
      usage: 'Capped at Grade F'
    },
    'schema-bloat': {
      title: 'Schema Bloat & Drift',
      isCode: false,
      cat: 'Reliability Issue',
      meta: 'Context Exhaustion',
      body: 'Unpruned, overly verbose JSON schemas that consume tens of thousands of tokens and induce models to hallucinate non-existent arguments across multi-turn loops.',
      usage: 'Solved by Bazantic recipe.md'
    },
    'zero-trust': {
      title: 'Zero-Trust Gate',
      isCode: false,
      cat: 'Security Architecture',
      meta: 'Fails Closed (Exit 2)',
      body: 'All MCP tool calls are intercepted locally before reaching the LLM. Only cryptographically allowlisted tools execute; unreviewed candidates are declined at zero cost.',
      usage: 'mcp-gate.sh · PreToolUse'
    },
    'funnel': {
      title: '2-Phase Defense Funnel',
      isCode: false,
      cat: 'Adoption Pipeline',
      meta: 'Free Local → Paid Gateway',
      body: 'A sequential pipeline that stops redundant or unsafe tools locally for $0.00, only paying $0.01 for remote adversarial grading when a tool is genuinely novel.',
      usage: 'Local Gate → Paid Scorecard'
    }
  };

  var popoverEl = null;
  var currentTarget = null;
  var isPinned = false;
  var hideTimer = null;

  function createPopover() {
    if (popoverEl) return popoverEl;
    popoverEl = document.createElement('aside');
    popoverEl.id = 'term-popover';
    popoverEl.className = 'term-popover';
    popoverEl.setAttribute('role', 'tooltip');
    popoverEl.setAttribute('aria-hidden', 'true');
    popoverEl.innerHTML =
      '<div class="popover-badge">' +
        '<span class="popover-cat" id="popover-cat"></span>' +
        '<span class="popover-meta" id="popover-meta"></span>' +
      '</div>' +
      '<div class="popover-title" id="popover-title"></div>' +
      '<p class="popover-body" id="popover-body"></p>' +
      '<div class="popover-foot" id="popover-foot">' +
        '<span>Tip: tap or hover to inspect</span>' +
        '<code id="popover-usage"></code>' +
      '</div>';
    document.body.appendChild(popoverEl);

    // Keep popover open if mouse moves into it
    popoverEl.addEventListener('mouseenter', function () {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    popoverEl.addEventListener('mouseleave', function () {
      if (!isPinned) scheduleHide();
    });

    return popoverEl;
  }

  function positionPopover(target) {
    if (!popoverEl || !target) return;
    var rect = target.getBoundingClientRect();
    var popWidth = popoverEl.offsetWidth || 320;
    var popHeight = popoverEl.offsetHeight || 160;

    // Detect dark theme
    var isInk = Boolean(target.closest('.ink') || target.closest('[data-theme="dark"]'));
    if (isInk) {
      popoverEl.classList.add('is-ink');
    } else {
      popoverEl.classList.remove('is-ink');
    }

    // Determine vertical placement: above if enough room, else below
    var placeAbove = rect.top >= popHeight + 14;
    var top = placeAbove ? (rect.top - popHeight - 8) : (rect.bottom + 8);

    // Determine horizontal placement centered, clamped inside viewport
    var targetCenter = rect.left + rect.width / 2;
    var left = targetCenter - popWidth / 2;
    var maxLeft = window.innerWidth - popWidth - 14;
    left = Math.max(14, Math.min(maxLeft, left));

    popoverEl.style.top = Math.round(top) + 'px';
    popoverEl.style.left = Math.round(left) + 'px';
  }

  function show(target, pin) {
    if (!target) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    var key = target.getAttribute('data-term');
    if (!key || !GLOSSARY[key]) return;

    var data = GLOSSARY[key];
    var pop = createPopover();

    document.getElementById('popover-cat').textContent = data.cat;
    document.getElementById('popover-meta').textContent = data.meta;

    var titleEl = document.getElementById('popover-title');
    if (data.isCode) {
      titleEl.innerHTML = '<code>' + data.title + '</code>';
    } else {
      titleEl.textContent = data.title;
    }

    document.getElementById('popover-body').textContent = data.body;
    document.getElementById('popover-usage').textContent = data.usage || '';

    // Clear active state on previous target
    if (currentTarget && currentTarget !== target) {
      currentTarget.removeAttribute('data-active');
    }

    currentTarget = target;
    currentTarget.setAttribute('data-active', 'true');
    isPinned = Boolean(pin);

    pop.setAttribute('data-visible', 'true');
    pop.setAttribute('aria-hidden', 'false');

    positionPopover(target);
  }

  function scheduleHide() {
    if (isPinned) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      hide();
    }, 120);
  }

  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (currentTarget) {
      currentTarget.removeAttribute('data-active');
      currentTarget = null;
    }
    isPinned = false;
    if (popoverEl) {
      popoverEl.setAttribute('data-visible', 'false');
      popoverEl.setAttribute('aria-hidden', 'true');
    }
  }

  function init() {
    // Event delegation on document
    document.addEventListener('mouseover', function (e) {
      var target = e.target.closest('.term-box');
      if (target) {
        show(target, false);
      }
    });

    document.addEventListener('mouseout', function (e) {
      var target = e.target.closest('.term-box');
      if (target) {
        scheduleHide();
      }
    });

    document.addEventListener('focusin', function (e) {
      var target = e.target.closest('.term-box');
      if (target) {
        show(target, false);
      }
    });

    document.addEventListener('focusout', function (e) {
      var target = e.target.closest('.term-box');
      if (target) {
        scheduleHide();
      }
    });

    document.addEventListener('click', function (e) {
      var target = e.target.closest('.term-box');
      if (target) {
        // Toggle pinned state on click / touch
        if (currentTarget === target && isPinned) {
          hide();
        } else {
          show(target, true);
        }
        e.stopPropagation();
      } else if (popoverEl && !popoverEl.contains(e.target)) {
        hide();
      }
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        hide();
      }
    });

    window.addEventListener('resize', function () {
      if (currentTarget && popoverEl && popoverEl.getAttribute('data-visible') === 'true') {
        positionPopover(currentTarget);
      }
    });

    window.addEventListener('scroll', function () {
      if (currentTarget && popoverEl && popoverEl.getAttribute('data-visible') === 'true') {
        positionPopover(currentTarget);
      }
    }, { passive: true });

    initNavDropdowns();
  }

  function initNavDropdowns() {
    var dropdowns = Array.prototype.slice.call(document.querySelectorAll('.nav-dropdown'));
    if (!dropdowns.length) return;

    function closeAll(except) {
      dropdowns.forEach(function (dd) {
        if (dd !== except) {
          var btn = dd.querySelector('.nav-dropdown-trigger');
          if (btn) btn.setAttribute('aria-expanded', 'false');
          dd.classList.remove('is-open');
        }
      });
    }

    dropdowns.forEach(function (dd) {
      var trigger = dd.querySelector('.nav-dropdown-trigger');
      if (!trigger) return;

      trigger.addEventListener('click', function (e) {
        e.stopPropagation();
        var isOpen = dd.classList.contains('is-open');
        closeAll(isOpen ? null : dd);
        var willOpen = !isOpen;
        trigger.setAttribute('aria-expanded', String(willOpen));
        dd.classList.toggle('is-open', willOpen);
      });
    });

    document.addEventListener('click', function (e) {
      var insideDropdown = dropdowns.some(function (dd) { return dd.contains(e.target); });
      if (!insideDropdown) {
        closeAll();
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' || e.keyCode === 27) {
        var openDropdown = dropdowns.find(function (dd) { return dd.classList.contains('is-open'); });
        if (openDropdown) {
          var btn = openDropdown.querySelector('.nav-dropdown-trigger');
          closeAll();
          if (btn) btn.focus();
        }
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

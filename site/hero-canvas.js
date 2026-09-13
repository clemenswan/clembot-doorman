/**
 * hero-canvas.js - Interactive 3D Canvas Engine for Clembot Doorman Secondary Pages
 *
 * Provides distinct, thematic, 60fps interactive 3D hero scenes for all secondary pages:
 *  1. 'how-it-works': 2-Phase Defense Funnel ($0 Local Gate -> $0.01 Base Scorecard)
 *  2. 'judges': ETHOnline Criteria Radar Matrix (5 Core Dimensions & Prize Constellation)
 *  3. 'bazantic': Schema Compression Engine (-87% tokens) & x402 Micropayment Rail
 *  4. 'clembot': 27-Agent Neural Swarm & Central Doorman Sentinel Forcefield
 *  5. 'wanessa-labs': 7-Month Timeline & 56-Project Constellation with Shipment Waves
 *  6. 'direction': Infinite Cryptographic Trust Rail with Snap-locking Blocks
 *  7. 'guide': MCP Protocol Oscilloscope & Real-time Security Inspection Beam
 *
 * Features:
 *  - 100% zero external dependencies (pure Canvas 2D with 3D projection math)
 *  - Interactive: responds to mouse movements (3D tilt/orbit) and canvas/button clicks
 *  - High-DPI Retina scaling
 *  - Automatic lifecycle: pauses when offscreen (IntersectionObserver) or background tab (visibilitychange)
 *  - Respects prefers-reduced-motion (renders static frame, no RAF loop)
 */

(function () {
  'use strict';

  var canvas = document.getElementById('hero-canvas');
  if (!canvas) return;

  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var heroType = canvas.getAttribute('data-hero') || 'how-it-works';
  var host = canvas.parentElement;
  if (!host) return;

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Dimensions & High-DPI Scaling ──────────────────────────────────────────
  var width = 0;
  var height = 0;
  var dpr = 1;

  function resize() {
    var rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    if (!width || !height) return;

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener('resize', function () {
    resize();
    if (reducedMotion) renderStatic();
  });

  // ── Mouse & Touch Tracking ────────────────────────────────────────────────
  var mouse = {
    x: width * 0.7,
    y: height * 0.5,
    targetX: width * 0.7,
    targetY: height * 0.5,
    normalizedX: 0.4,
    normalizedY: 0,
    isDown: false,
    hovered: false
  };

  function updateMousePos(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    mouse.targetX = clientX - rect.left;
    mouse.targetY = clientY - rect.top;
    mouse.normalizedX = (mouse.targetX / width) * 2 - 1;
    mouse.normalizedY = (mouse.targetY / height) * 2 - 1;
  }

  window.addEventListener('mousemove', function (e) {
    var rect = canvas.getBoundingClientRect();
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      mouse.hovered = true;
      updateMousePos(e.clientX, e.clientY);
    } else {
      mouse.hovered = false;
    }
  });

  canvas.addEventListener('click', function (e) {
    updateMousePos(e.clientX, e.clientY);
    triggerAction();
  });

  // Hook up HUD trigger button if present in DOM
  var hudBtn = document.getElementById('hud-trigger-btn');
  if (hudBtn) {
    hudBtn.addEventListener('click', function (e) {
      e.preventDefault();
      triggerAction();
    });
  }

  // ── 3D Projection Helpers ──────────────────────────────────────────────────
  function project(x, y, z, cx, cy, rotX, rotY, fov) {
    fov = fov || 380;
    var cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    var cosX = Math.cos(rotX), sinX = Math.sin(rotX);

    // Rotate around Y
    var x1 = x * cosY - z * sinY;
    var z1 = x * sinY + z * cosY;

    // Rotate around X
    var y2 = y * cosX - z1 * sinX;
    var z2 = y * sinX + z1 * cosX;

    var dist = fov + z2;
    if (dist < 10) dist = 10;
    var scale = fov / dist;

    return {
      x: cx + x1 * scale,
      y: cy + y2 * scale,
      scale: scale,
      depth: z2
    };
  }

  function draw3DCube(ctx, cx, cy, cz, size, rotX, rotY, colorFill, colorStroke, fov) {
    var s = size / 2;
    var vertices = [
      { x: -s, y: -s, z: -s },
      { x:  s, y: -s, z: -s },
      { x:  s, y:  s, z: -s },
      { x: -s, y:  s, z: -s },
      { x: -s, y: -s, z:  s },
      { x:  s, y: -s, z:  s },
      { x:  s, y:  s, z:  s },
      { x: -s, y:  s, z:  s }
    ];

    var proj = [];
    for (var i = 0; i < vertices.length; i++) {
      var v = vertices[i];
      proj.push(project(cx + v.x, cy + v.y, cz + v.z, 0, 0, rotX, rotY, fov));
    }

    var faces = [
      [0, 1, 2, 3], // front
      [5, 4, 7, 6], // back
      [4, 0, 3, 7], // left
      [1, 5, 6, 2], // right
      [4, 5, 1, 0], // top
      [3, 2, 6, 7]  // bottom
    ];

    for (var f = 0; f < faces.length; f++) {
      var face = faces[f];
      var p0 = proj[face[0]], p1 = proj[face[1]], p2 = proj[face[2]];
      // Backface culling check
      var cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
      if (cross > 0) {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        for (var k = 1; k < face.length; k++) {
          ctx.lineTo(proj[face[k]].x, proj[face[k]].y);
        }
        ctx.closePath();
        if (colorFill) {
          ctx.fillStyle = colorFill;
          ctx.fill();
        }
        if (colorStroke) {
          ctx.strokeStyle = colorStroke;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }
  }

  // ── Universal Particle System ──────────────────────────────────────────────
  var particles = [];
  function emitParticles(x, y, count, color, speed, life) {
    for (var i = 0; i < count; i++) {
      var angle = Math.random() * Math.PI * 2;
      var spd = (Math.random() * 0.7 + 0.3) * (speed || 3);
      particles.push({
        x: x,
        y: y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        color: color || '#2f6b4f',
        alpha: 1,
        life: life || 1.0,
        decay: Math.random() * 0.02 + 0.015,
        size: Math.random() * 2.5 + 1.5
      });
    }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.alpha -= p.decay * (dt * 60);
      if (p.alpha <= 0) {
        particles.splice(i, 1);
      } else {
        ctx.save();
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ── Interactive Scenes Implementation ──────────────────────────────────────

  // 1. HOW IT WORKS: 2-Phase Defense Funnel ($0 Local Gate -> $0.01 Base Laser)
  var funnelScene = (function () {
    var items = [];
    var count = 22;

    function init() {
      items = [];
      for (var i = 0; i < count; i++) {
        spawnItem(true);
      }
    }

    function getGate1X() {
      var panel = host.querySelector('.hero-panel');
      if (panel && getComputedStyle(panel).display !== 'none') {
        var pRect = panel.getBoundingClientRect();
        var cRect = canvas.getBoundingClientRect();
        return pRect.left - cRect.left;
      }
      return width * 0.62;
    }

    function spawnItem(init) {
      var gate1X = getGate1X();
      var startX = init ? Math.random() * width * 0.9 : -40 - Math.random() * 120;
      var isHostile = Math.random() < 0.22; // 22% hostile/redundant
      var isDuplicate = Math.random() < 0.18; // 18% duplicate
      items.push({
        x: startX,
        y: height * 0.2 + Math.random() * height * 0.6,
        z: (Math.random() - 0.5) * 120,
        size: Math.random() * 10 + 16,
        vx: Math.random() * 1.4 + 1.2,
        rotX: Math.random() * Math.PI,
        rotY: Math.random() * Math.PI,
        spinX: (Math.random() - 0.5) * 0.04,
        spinY: (Math.random() - 0.5) * 0.04,
        state: startX < gate1X ? 'raw' : 'phase1',
        isDuplicate: isDuplicate,
        isHostile: isHostile,
        bounceVy: 0,
        opacity: 1
      });
    }

    function trigger() {
      for (var i = 0; i < 6; i++) {
        var it = {
          x: -30 - i * 35,
          y: height * 0.3 + (i / 5) * height * 0.4,
          z: (Math.random() - 0.5) * 80,
          size: 20,
          vx: 3.2,
          rotX: 0,
          rotY: 0,
          spinX: 0.05,
          spinY: 0.03,
          state: 'raw',
          isDuplicate: i === 1,
          isHostile: i === 3,
          bounceVy: 0,
          opacity: 1
        };
        items.push(it);
      }
      emitParticles(width * 0.1, height * 0.5, 20, '#2f6b4f', 4, 1.2);
    }

    function drawGateBadge(x, y, w, h, bgSolid, bgTint, strokeColor, textColor, text) {
      ctx.save();
      // Drop shadow so badge floats cleanly over lines and canvas background
      ctx.shadowColor = 'rgba(18, 17, 16, 0.12)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;

      // 1. Solid opaque base so lines and moving items never show through
      ctx.fillStyle = bgSolid;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 4);
        ctx.fill();
      } else {
        ctx.fillRect(x, y, w, h);
      }

      // Reset shadow for inner tint and border
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;

      // 2. Tinted overlay fill & stroke border
      ctx.fillStyle = bgTint;
      if (typeof ctx.roundRect === 'function') {
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 4);
        ctx.fill();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.25;
        ctx.stroke();
      } else {
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.25;
        ctx.strokeRect(x, y, w, h);
      }

      // 3. Crisp centered label
      ctx.fillStyle = textColor;
      ctx.font = '600 11px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
      ctx.restore();
    }

    function render(dt) {
      var gate1X = getGate1X();
      var gate2X = gate1X + (width - gate1X) * 0.52;

      // Draw Gate 1: Phase 1 Local Free Fit ($0.00) line (split around badge height: 16 to 42)
      ctx.save();
      ctx.strokeStyle = '#2f6b4f';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(gate1X, 0);
      ctx.lineTo(gate1X, 16);
      ctx.moveTo(gate1X, 42);
      ctx.lineTo(gate1X, height);
      ctx.stroke();

      // Gate 2 Laser Glow (split around badge height: 16 to 42)
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.2)';
      ctx.lineWidth = 14;
      ctx.beginPath();
      ctx.moveTo(gate2X, 0);
      ctx.lineTo(gate2X, 16);
      ctx.moveTo(gate2X, 42);
      ctx.lineTo(gate2X, height);
      ctx.stroke();

      // Draw Gate 2: Phase 2 Base Scorecard ($0.01) core line (split around badge height: 16 to 42)
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gate2X, 0);
      ctx.lineTo(gate2X, 16);
      ctx.moveTo(gate2X, 42);
      ctx.lineTo(gate2X, height);
      ctx.stroke();
      ctx.restore();

      // Render & update items
      for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        it.rotX += it.spinX;
        it.rotY += it.spinY;
        it.x += it.vx;

        // Gate 1 Encounter
        if (it.state === 'raw' && it.x >= gate1X) {
          if (it.isDuplicate) {
            it.state = 'refused_local';
            it.vx = -1.8;
            it.bounceVy = (Math.random() - 0.5) * 2;
            emitParticles(gate1X, it.y, 8, '#d97706', 2.5);
          } else {
            it.state = 'phase1';
            emitParticles(gate1X, it.y, 5, '#2f6b4f', 2);
          }
        }

        // Gate 2 Encounter
        if (it.state === 'phase1' && it.x >= gate2X) {
          if (it.isHostile) {
            it.state = 'blocked_laser';
            it.vx = -0.5;
            it.opacity = 0.9;
            emitParticles(gate2X, it.y, 16, '#c0392b', 4, 1.4);
          } else {
            it.state = 'passed_verified';
            it.vx *= 1.4;
            emitParticles(gate2X, it.y, 10, '#10b981', 3, 1.0);
          }
        }

        var fillColor = 'rgba(210, 205, 195, 0.4)';
        var strokeColor = 'rgba(140, 135, 125, 0.6)';

        if (it.state === 'refused_local') {
          it.y += it.bounceVy;
          it.opacity -= dt * 0.7;
          fillColor = 'rgba(217, 119, 6, 0.35)';
          strokeColor = '#d97706';
        } else if (it.state === 'phase1') {
          fillColor = 'rgba(47, 107, 79, 0.3)';
          strokeColor = '#2f6b4f';
        } else if (it.state === 'blocked_laser') {
          it.opacity -= dt * 1.2;
          fillColor = 'rgba(192, 57, 43, 0.6)';
          strokeColor = '#c0392b';
        } else if (it.state === 'passed_verified') {
          it.opacity -= dt * 0.4;
          fillColor = 'rgba(16, 185, 129, 0.5)';
          strokeColor = '#10b981';
        }

        if (it.opacity <= 0 || it.x > width + 50 || it.x < -100) {
          items.splice(i, 1);
          spawnItem(false);
        } else {
          ctx.save();
          ctx.globalAlpha = Math.max(0, it.opacity);
          var rotCamX = mouse.normalizedY * 0.3;
          var rotCamY = mouse.normalizedX * 0.3;
          draw3DCube(ctx, it.x, it.y, it.z, it.size, it.rotX + rotCamX, it.rotY + rotCamY, fillColor, strokeColor, 350);
          ctx.restore();
        }
      }

      // Draw Gate Badges IN FRONT of lines and items
      drawGateBadge(gate1X - 68, 16, 136, 26, '#ffffff', 'rgba(47, 107, 79, 0.12)', '#2f6b4f', '#2f6b4f', 'PHASE 1: LOCAL FIT ($0.00)');
      drawGateBadge(gate2X - 74, 16, 148, 26, '#ffffff', 'rgba(16, 185, 129, 0.15)', 'rgba(16, 185, 129, 0.9)', '#059669', 'PHASE 2: BASE SCORE ($0.01)');
    }

    return { init: init, render: render, trigger: trigger };
  })();

  // 2. JUDGES: ETHOnline Criteria Radar Matrix (5 Core Dimensions & Rotating Polyhedron)
  var judgesScene = (function () {
    var angle = 0;
    var criteria = [
      { name: 'TECHNICALITY', score: 0.98, code: 'TECH' },
      { name: 'ORIGINALITY', score: 0.95, code: 'ORIG' },
      { name: 'PRACTICALITY', score: 1.0,  code: 'PRAC' },
      { name: 'USABILITY',    score: 0.97, code: 'UX/DX' },
      { name: 'WOW FACTOR',   score: 0.99, code: 'WOW' }
    ];

    var satellites = [
      { label: 'BAZANTIC TRACK', angle: 0, r: 190, color: '#2f6b4f' },
      { label: 'BASE / x402', angle: Math.PI * 0.7, r: 175, color: '#10b981' },
      { label: 'AUTONOMOUS FIT', angle: Math.PI * 1.4, r: 185, color: '#2563eb' }
    ];

    var pulseRadius = 0;
    var pulseActive = false;

    function init() {}

    function trigger() {
      pulseRadius = 10;
      pulseActive = true;
      var cx = width > 900 ? width * 0.72 : width * 0.5;
      var cy = height * 0.5;
      emitParticles(cx, cy, 32, '#d97706', 5, 1.5);
    }

    function render(dt) {
      angle += dt * 0.55;
      var cx = width > 900 ? width * 0.72 : width * 0.5;
      var cy = height * 0.5;
      var radius = Math.min(width, height) * 0.28;

      var rotX = mouse.normalizedY * 0.45;
      var rotY = angle + mouse.normalizedX * 0.45;

      ctx.save();
      ctx.strokeStyle = 'rgba(47, 107, 79, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(47, 107, 79, 0.1)';
      ctx.beginPath();
      ctx.arc(cx, cy, radius * 0.6, 0, Math.PI * 2);
      ctx.stroke();

      if (pulseActive) {
        pulseRadius += dt * 260;
        ctx.strokeStyle = 'rgba(217, 119, 6, ' + Math.max(0, 1 - pulseRadius / 350) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, pulseRadius, 0, Math.PI * 2);
        ctx.stroke();
        if (pulseRadius > 350) pulseActive = false;
      }

      var radarPoints = [];
      var outerPoints = [];
      for (var i = 0; i < criteria.length; i++) {
        var a = (i / criteria.length) * Math.PI * 2 - Math.PI / 2;
        var p3d = project(
          Math.cos(a) * radius,
          Math.sin(a) * radius * 0.7,
          Math.sin(a + angle) * 40,
          cx, cy, rotX, rotY, 400
        );
        outerPoints.push(p3d);

        var rVal = radius * criteria[i].score;
        var pVal = project(
          Math.cos(a) * rVal,
          Math.sin(a) * rVal * 0.7,
          Math.sin(a + angle) * 40,
          cx, cy, rotX, rotY, 400
        );
        radarPoints.push(pVal);

        ctx.strokeStyle = 'rgba(47, 107, 79, 0.25)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(p3d.x, p3d.y);
        ctx.stroke();

        ctx.fillStyle = '#141110';
        ctx.font = '600 11px "Barlow Condensed", sans-serif';
        ctx.textAlign = p3d.x > cx ? 'left' : 'right';
        ctx.fillText(criteria[i].code + ' (' + (criteria[i].score * 100).toFixed(0) + '%)', p3d.x + (p3d.x > cx ? 6 : -6), p3d.y + 4);
      }

      ctx.beginPath();
      ctx.moveTo(radarPoints[0].x, radarPoints[0].y);
      for (var j = 1; j < radarPoints.length; j++) {
        ctx.lineTo(radarPoints[j].x, radarPoints[j].y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(47, 107, 79, 0.16)';
      ctx.fill();
      ctx.strokeStyle = '#2f6b4f';
      ctx.lineWidth = 2;
      ctx.stroke();

      draw3DCube(ctx, cx, cy, 0, 24, rotX + angle, rotY + angle, 'rgba(217, 119, 6, 0.7)', '#d97706', 400);

      for (var s = 0; s < satellites.length; s++) {
        var sat = satellites[s];
        sat.angle += dt * 0.3;
        var sx = cx + Math.cos(sat.angle) * sat.r;
        var sy = cy + Math.sin(sat.angle) * sat.r * 0.45;

        ctx.strokeStyle = 'rgba(47, 107, 79, 0.2)';
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        ctx.fillStyle = sat.color;
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '600 10px "Barlow Condensed", sans-serif';
        ctx.fillText(sat.label, sx + 8, sy + 3);
      }
      ctx.restore();
    }

    return { init: init, render: render, trigger: trigger };
  })();

  // 3. BAZANTIC: Schema Compression Engine & x402 Gateway Rail
  var bazanticScene = (function () {
    var items = [];
    var chamberX = 0;
    var clampActive = 0;

    function init() {
      items = [];
      for (var i = 0; i < 14; i++) {
        spawn(true);
      }
    }

    function spawn(initial) {
      chamberX = width * 0.58;
      var startX = initial ? Math.random() * width * 0.9 : -50 - Math.random() * 100;
      items.push({
        x: startX,
        y: height * 0.25 + Math.random() * height * 0.45,
        z: (Math.random() - 0.5) * 60,
        size: startX < chamberX ? 36 : 12,
        targetSize: startX < chamberX ? 36 : 12,
        state: startX < chamberX ? 'raw' : 'compressed',
        vx: startX < chamberX ? 1.6 : 2.6,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.04,
        opacity: 1
      });
    }

    function trigger() {
      clampActive = 1.0;
      emitParticles(chamberX, height * 0.48, 26, '#10b981', 5, 1.3);
      for (var i = 0; i < items.length; i++) {
        if (items[i].state === 'raw') {
          items[i].x = chamberX - 10;
        }
      }
    }

    function render(dt) {
      chamberX = width > 900 ? width * 0.58 : width * 0.5;

      if (clampActive > 0) clampActive -= dt * 2.5;

      var railY = height * 0.82;
      ctx.save();
      ctx.strokeStyle = 'rgba(47, 107, 79, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, railY);
      ctx.lineTo(width, railY);
      ctx.moveTo(0, railY + 12);
      ctx.lineTo(width, railY + 12);
      ctx.stroke();

      var t = Date.now() * 0.003;
      for (var p = 0; p < width; p += 80) {
        var dotX = (p + t * 40) % width;
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(dotX, railY + 6, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = '#2f6b4f';
      ctx.font = '600 10px "Barlow Condensed", sans-serif';
      ctx.fillText('x402 MICROPAYMENT HIGHWAY · $0.01 ON BASE L2', width * 0.1, railY + 26);

      var irisSize = 90 - clampActive * 45;
      ctx.strokeStyle = 'rgba(47, 107, 79, 0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(chamberX - irisSize / 2, height * 0.2, irisSize, height * 0.52);

      ctx.fillStyle = 'rgba(47, 107, 79, 0.1)';
      ctx.fillRect(chamberX - 85, height * 0.2 - 28, 170, 22);
      ctx.strokeStyle = 'rgba(47, 107, 79, 0.5)';
      ctx.strokeRect(chamberX - 85, height * 0.2 - 28, 170, 22);
      ctx.fillStyle = '#2f6b4f';
      ctx.font = '700 11px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('BAZANTIC COMPRESSION CHAMBER', chamberX, height * 0.2 - 13);

      ctx.strokeStyle = clampActive > 0 ? '#10b981' : 'rgba(16, 185, 129, 0.4)';
      ctx.lineWidth = clampActive > 0 ? 3 : 1;
      ctx.beginPath();
      ctx.moveTo(chamberX, height * 0.2);
      ctx.lineTo(chamberX, height * 0.72);
      ctx.stroke();
      ctx.restore();

      for (var i = items.length - 1; i >= 0; i--) {
        var it = items[i];
        it.rot += it.spin;
        it.x += it.vx;

        if (it.state === 'raw' && it.x >= chamberX) {
          it.state = 'compressed';
          it.targetSize = 12;
          it.vx = 2.8;
          emitParticles(chamberX, it.y, 8, '#10b981', 3, 0.8);
        }

        if (it.size > it.targetSize) {
          it.size = Math.max(it.targetSize, it.size - dt * 60);
        }

        var rotCamX = mouse.normalizedY * 0.3;
        var rotCamY = mouse.normalizedX * 0.3;

        ctx.save();
        if (it.state === 'raw') {
          draw3DCube(ctx, it.x, it.y, it.z, it.size, it.rot + rotCamX, it.rot + rotCamY, 'rgba(192, 57, 43, 0.15)', 'rgba(192, 57, 43, 0.6)', 380);
          ctx.fillStyle = 'rgba(140, 50, 40, 0.8)';
          ctx.font = '9px "Barlow Condensed", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('3.4k tok', it.x, it.y - it.size / 2 - 4);
        } else {
          draw3DCube(ctx, it.x, it.y, it.z, it.size, it.rot + rotCamX, it.rot + rotCamY, 'rgba(16, 185, 129, 0.7)', '#10b981', 380);
          ctx.fillStyle = '#10b981';
          ctx.font = '700 9px "Barlow Condensed", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('-87%', it.x, it.y - it.size / 2 - 4);
        }
        ctx.restore();

        if (it.x > width + 60) {
          items.splice(i, 1);
          spawn(false);
        }
      }
    }

    return { init: init, render: render, trigger: trigger };
  })();

  // 4. CLEMBOT: 27-Agent Neural Swarm & Central Doorman Sentinel Gate
  var clembotScene = (function () {
    var agents = [];
    var divisions = [
      { name: 'CONTENT', color: '#2f6b4f', count: 6 },
      { name: 'SEO/INTEL', color: '#0284c7', count: 5 },
      { name: 'SOCIAL', color: '#d97706', count: 5 },
      { name: 'DESIGN', color: '#9333ea', count: 5 },
      { name: 'DEPLOY', color: '#e11d48', count: 6 }
    ];

    var sentinelAngle = 0;
    var hostileProbes = [];

    function init() {
      agents = [];
      var total = 27;
      var divIdx = 0;
      var inDiv = 0;

      for (var i = 0; i < total; i++) {
        if (inDiv >= divisions[divIdx].count && divIdx < divisions.length - 1) {
          divIdx++;
          inDiv = 0;
        }
        var div = divisions[divIdx];
        inDiv++;

        var ring = 1 + Math.floor(i / 9);
        var ringRadius = 55 * ring;
        var a = (i / 9) * Math.PI * 2;

        agents.push({
          id: i + 1,
          division: div.name,
          color: div.color,
          baseAngle: a,
          speed: (Math.random() * 0.3 + 0.2) * (ring % 2 === 0 ? -1 : 1),
          ringRadius: ringRadius,
          x: 0,
          y: 0,
          z: (Math.random() - 0.5) * 60,
          pingAlpha: 0
        });
      }

      hostileProbes = [];
      for (var h = 0; h < 3; h++) {
        spawnHostile();
      }
    }

    function spawnHostile() {
      var angle = Math.random() * Math.PI * 2;
      hostileProbes.push({
        x: Math.cos(angle) * 260,
        y: Math.sin(angle) * 260,
        vx: -Math.cos(angle) * 0.8,
        vy: -Math.sin(angle) * 0.8,
        alpha: 1
      });
    }

    function trigger() {
      for (var i = 0; i < agents.length; i++) {
        agents[i].pingAlpha = 1.0;
      }
      var cx = width > 900 ? width * 0.72 : width * 0.5;
      var cy = height * 0.5;
      emitParticles(cx, cy, 27, '#2f6b4f', 4, 1.2);
    }

    function render(dt) {
      sentinelAngle += dt * 0.8;
      var cx = width > 900 ? width * 0.72 : width * 0.5;
      var cy = height * 0.5;

      var rotX = mouse.normalizedY * 0.4;
      var rotY = mouse.normalizedX * 0.4;

      for (var i = 0; i < agents.length; i++) {
        var ag = agents[i];
        ag.baseAngle += ag.speed * dt;
        var ax = Math.cos(ag.baseAngle) * ag.ringRadius;
        var ay = Math.sin(ag.baseAngle) * ag.ringRadius * 0.65;

        var proj = project(ax, ay, ag.z, cx, cy, rotX, rotY, 400);
        ag.projX = proj.x;
        ag.projY = proj.y;
        if (ag.pingAlpha > 0) ag.pingAlpha -= dt * 1.5;
      }

      ctx.save();
      for (var a1 = 0; a1 < agents.length; a1++) {
        for (var a2 = a1 + 1; a2 < agents.length; a2++) {
          var dx = agents[a1].projX - agents[a2].projX;
          var dy = agents[a1].projY - agents[a2].projY;
          var dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 75) {
            ctx.strokeStyle = 'rgba(47, 107, 79, ' + (1 - dist / 75) * 0.25 + ')';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(agents[a1].projX, agents[a1].projY);
            ctx.lineTo(agents[a2].projX, agents[a2].projY);
            ctx.stroke();
          }
        }
      }

      ctx.strokeStyle = 'rgba(47, 107, 79, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, 32, 0, Math.PI * 2);
      ctx.stroke();

      draw3DCube(ctx, cx, cy, 0, 22, rotX + sentinelAngle, rotY + sentinelAngle, 'rgba(47, 107, 79, 0.8)', '#10b981', 400);

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.25)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(cx, cy, 185, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      for (var k = 0; k < agents.length; k++) {
        var node = agents[k];
        ctx.fillStyle = node.color;
        ctx.beginPath();
        ctx.arc(node.projX, node.projY, 4.5, 0, Math.PI * 2);
        ctx.fill();

        if (node.pingAlpha > 0) {
          ctx.strokeStyle = node.color;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(node.projX, node.projY, 14 * (1 - node.pingAlpha), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      for (var h = hostileProbes.length - 1; h >= 0; h--) {
        var probe = hostileProbes[h];
        probe.x += probe.vx;
        probe.y += probe.vy;
        var pDist = Math.sqrt(probe.x * probe.x + probe.y * probe.y);

        var px = cx + probe.x;
        var py = cy + probe.y;

        if (pDist < 185) {
          ctx.strokeStyle = '#c0392b';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.lineTo(px, py);
          ctx.stroke();

          emitParticles(px, py, 12, '#c0392b', 3, 0.8);
          hostileProbes.splice(h, 1);
          spawnHostile();
        } else {
          ctx.fillStyle = '#c0392b';
          ctx.beginPath();
          ctx.arc(px, py, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    return { init: init, render: render, trigger: trigger };
  })();

  // 5. WANESSA LABS: 7-Month Timeline & 56-Project Constellation
  var wanessaScene = (function () {
    var months = ['MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP'];
    var projects = [];
    var waveProgress = 0;

    function init() {
      projects = [];
      for (var i = 0; i < 56; i++) {
        var mIdx = Math.floor(Math.random() * months.length);
        var angle = (i / 56) * Math.PI * 2;
        var ringRadius = 50 + mIdx * 24;
        projects.push({
          id: i + 1,
          month: months[mIdx],
          monthIdx: mIdx,
          ringRadius: ringRadius,
          angle: angle,
          speed: (Math.random() * 0.15 + 0.1) * (mIdx % 2 === 0 ? 1 : -1),
          shipped: mIdx < 5 || Math.random() < 0.7,
          sparkle: 0
        });
      }
    }

    function trigger() {
      waveProgress = 0.01;
      var cx = width > 900 ? width * 0.72 : width * 0.5;
      var cy = height * 0.5;
      emitParticles(cx, cy, 35, '#2f6b4f', 6, 1.6);
    }

    function render(dt) {
      var cx = width > 900 ? width * 0.72 : width * 0.5;
      var cy = height * 0.5;

      var rotX = mouse.normalizedY * 0.45;
      var rotY = mouse.normalizedX * 0.45;

      if (waveProgress > 0) {
        waveProgress += dt * 0.7;
        if (waveProgress > 1.2) waveProgress = 0;
      }

      ctx.save();
      for (var m = 0; m < months.length; m++) {
        var r = 50 + m * 24;
        ctx.strokeStyle = m >= 4 ? 'rgba(47, 107, 79, 0.35)' : 'rgba(47, 107, 79, 0.15)';
        ctx.lineWidth = m >= 4 ? 2 : 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = '#2f6b4f';
        ctx.font = '600 9px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(months[m] + " '26", cx + r, cy + 3);
      }

      if (waveProgress > 0) {
        var wr = 50 + waveProgress * (months.length * 24);
        ctx.strokeStyle = 'rgba(16, 185, 129, ' + (1 - waveProgress) + ')';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, wr, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (var p = 0; p < projects.length; p++) {
        var prj = projects[p];
        prj.angle += prj.speed * dt;
        var px = Math.cos(prj.angle) * prj.ringRadius;
        var py = Math.sin(prj.angle) * prj.ringRadius * 0.75;

        var pt = project(px, py, 0, cx, cy, rotX, rotY, 400);

        if (prj.shipped) {
          ctx.fillStyle = '#2f6b4f';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.strokeStyle = '#d97706';
          ctx.lineWidth = 1;
          ctx.strokeRect(pt.x - 3, pt.y - 3, 6, 6);
        }
      }

      draw3DCube(ctx, cx, cy, 0, 26, rotX + Date.now() * 0.001, rotY + Date.now() * 0.001, 'rgba(47, 107, 79, 0.85)', '#10b981', 400);
      ctx.restore();
    }

    return { init: init, render: render, trigger: trigger };
  })();

  // 6. DIRECTION: Infinite Cryptographic Trust Rail with Snap-locking Blocks
  var directionScene = (function () {
    var blocks = [];
    var railOffset = 0;

    function init() {
      blocks = [];
      for (var i = 0; i < 9; i++) {
        blocks.push({
          z: i * 80,
          hash: '0x' + (Math.floor(Math.random() * 0xffffff)).toString(16),
          verified: true,
          snapY: 0
        });
      }
    }

    function trigger() {
      blocks.unshift({
        z: -60,
        hash: '0x' + (Math.floor(Math.random() * 0xffffff)).toString(16),
        verified: false,
        snapY: -100
      });
      var panel = host.querySelector('.hero-panel');
      var cx = panel && getComputedStyle(panel).display !== 'none'
        ? (panel.getBoundingClientRect().left - canvas.getBoundingClientRect().left + panel.getBoundingClientRect().width * 0.5)
        : (width > 900 ? width * 0.74 : width * 0.5);
      emitParticles(cx, height * 0.45, 25, '#10b981', 5, 1.2);
    }

    function render(dt) {
      var panel = host.querySelector('.hero-panel');
      if (!panel || getComputedStyle(panel).display === 'none' || width <= 900) {
        return;
      }
      var cx = panel.getBoundingClientRect().left - canvas.getBoundingClientRect().left + panel.getBoundingClientRect().width * 0.5;
      var cy = height * 0.52;

      railOffset = (railOffset + dt * 50) % 60;

      ctx.save();
      var fov = 350;
      var trackW = 70;

      ctx.strokeStyle = 'rgba(47, 107, 79, 0.4)';
      ctx.lineWidth = 2;

      var pL1 = project(-trackW, 40, -100, cx, cy, 0.35, 0, fov);
      var pL2 = project(-trackW, 40, 600, cx, cy, 0.35, 0, fov);
      var pR1 = project(trackW, 40, -100, cx, cy, 0.35, 0, fov);
      var pR2 = project(trackW, 40, 600, cx, cy, 0.35, 0, fov);

      ctx.beginPath();
      ctx.moveTo(pL1.x, pL1.y);
      ctx.lineTo(pL2.x, pL2.y);
      ctx.moveTo(pR1.x, pR1.y);
      ctx.lineTo(pR2.x, pR2.y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(47, 107, 79, 0.18)';
      ctx.lineWidth = 1;
      for (var rz = -100 + railOffset; rz < 600; rz += 50) {
        var tieL = project(-trackW - 15, 40, rz, cx, cy, 0.35, 0, fov);
        var tieR = project(trackW + 15, 40, rz, cx, cy, 0.35, 0, fov);
        ctx.beginPath();
        ctx.moveTo(tieL.x, tieL.y);
        ctx.lineTo(tieR.x, tieR.y);
        ctx.stroke();
      }

      function drawRailBlock(wx, wy, wz, bw, bh, bd, fillColor, strokeColor) {
        var hw = bw / 2, hh = bh / 2, hd = bd / 2;
        var verts = [
          { x: wx - hw, y: wy - hh, z: wz - hd },
          { x: wx + hw, y: wy - hh, z: wz - hd },
          { x: wx + hw, y: wy - hh, z: wz + hd },
          { x: wx - hw, y: wy - hh, z: wz + hd },
          { x: wx - hw, y: wy + hh, z: wz - hd },
          { x: wx + hw, y: wy + hh, z: wz - hd },
          { x: wx + hw, y: wy + hh, z: wz + hd },
          { x: wx - hw, y: wy + hh, z: wz + hd }
        ];

        var p = [];
        for (var v = 0; v < verts.length; v++) {
          p.push(project(verts[v].x, verts[v].y, verts[v].z, cx, cy, 0.35, 0, fov));
        }

        var faces = [
          [0, 1, 2, 3], // top
          [3, 2, 6, 7], // front
          [1, 5, 6, 2], // right
          [4, 0, 3, 7]  // left
        ];

        for (var f = 0; f < faces.length; f++) {
          var face = faces[f];
          var p0 = p[face[0]], p1 = p[face[1]], p2 = p[face[2]];
          var cross = (p1.x - p0.x) * (p2.y - p0.y) - (p1.y - p0.y) * (p2.x - p0.x);
          if (cross > 0) {
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            for (var k = 1; k < face.length; k++) {
              ctx.lineTo(p[face[k]].x, p[face[k]].y);
            }
            ctx.closePath();
            ctx.fillStyle = fillColor;
            ctx.fill();
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 1.25;
            ctx.stroke();
          }
        }

        return {
          x: (p[0].x + p[1].x + p[2].x + p[3].x) / 4,
          y: (p[0].y + p[1].y + p[2].y + p[3].y) / 4,
          scale: (p[2].scale + p[3].scale) / 2
        };
      }

      for (var i = blocks.length - 1; i >= 0; i--) {
        var b = blocks[i];
        b.z += dt * 50;

        if (b.snapY < 0) {
          b.snapY = Math.min(0, b.snapY + dt * 240);
          if (b.snapY === 0) {
            b.verified = true;
            var snapP = project(0, 40, b.z, cx, cy, 0.35, 0, fov);
            emitParticles(snapP.x, snapP.y, 10, '#10b981', 3, 0.7);
          }
        }

        var fillColor = b.verified ? 'rgba(47, 107, 79, 0.85)' : 'rgba(217, 119, 6, 0.7)';
        var strokeColor = b.verified ? '#10b981' : '#d97706';

        var topPt = drawRailBlock(0, 30 + b.snapY, b.z, 90, 18, 45, fillColor, strokeColor);

        ctx.fillStyle = '#ffffff';
        ctx.font = '600 ' + Math.max(8, Math.floor(10 * topPt.scale)) + 'px "Barlow Condensed", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(b.hash, topPt.x, topPt.y + 4);

        if (b.z > 600) {
          blocks.splice(i, 1);
          blocks.unshift({
            z: -80,
            hash: '0x' + (Math.floor(Math.random() * 0xffffff)).toString(16),
            verified: true,
            snapY: 0
          });
        }
      }
      ctx.restore();
    }

    return { init: init, render: render, trigger: trigger };
  })();

  // 7. GUIDE: MCP Protocol Oscilloscope & Real-time Security Inspection Beam
  var guideScene = (function () {
    var packets = [];
    var methods = ['tools/list', 'tools/call', 'resources/read', 'prompts/get'];
    var scanBeamX = 0;

    function init() {
      packets = [];
      for (var i = 0; i < 16; i++) {
        spawn(true);
      }
    }

    function spawn(initial) {
      scanBeamX = width * 0.58;
      var startX = initial ? Math.random() * width * 0.9 : -40 - Math.random() * 80;
      var isMalicious = Math.random() < 0.2;
      packets.push({
        x: startX,
        y: height * 0.3 + Math.random() * height * 0.4,
        method: methods[Math.floor(Math.random() * methods.length)],
        isMalicious: isMalicious,
        scanned: startX > scanBeamX,
        quarantined: false,
        vx: Math.random() * 1.5 + 1.2,
        rot: 0,
        opacity: 1
      });
    }

    function trigger() {
      scanBeamX = width * 0.58;
      packets.push({
        x: width * 0.1,
        y: height * 0.48,
        method: 'tools/call [INJECTED]',
        isMalicious: true,
        scanned: false,
        quarantined: false,
        vx: 3.5,
        rot: 0,
        opacity: 1
      });
      emitParticles(width * 0.1, height * 0.48, 15, '#c0392b', 4, 1.0);
    }

    function render(dt) {
      scanBeamX = width > 900 ? width * 0.58 + mouse.normalizedX * 40 : width * 0.5;

      ctx.save();
      ctx.strokeStyle = 'rgba(47, 107, 79, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      var t = Date.now() * 0.003;
      for (var x = 0; x < width; x += 6) {
        var waveY = height * 0.5 + Math.sin(x * 0.02 + t) * 35 + Math.cos(x * 0.04 - t) * 15;
        if (x === 0) ctx.moveTo(x, waveY);
        else ctx.lineTo(x, waveY);
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(scanBeamX, 20);
      ctx.lineTo(scanBeamX, height - 20);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.lineWidth = 16;
      ctx.stroke();

      ctx.fillStyle = 'rgba(47, 107, 79, 0.12)';
      ctx.fillRect(scanBeamX - 70, 16, 140, 22);
      ctx.strokeStyle = 'rgba(47, 107, 79, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(scanBeamX - 70, 16, 140, 22);
      ctx.fillStyle = '#2f6b4f';
      ctx.font = '600 11px "Barlow Condensed", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('DOORMAN PROTOCOL SCANNER', scanBeamX, 31);
      ctx.restore();

      for (var i = packets.length - 1; i >= 0; i--) {
        var pkt = packets[i];
        pkt.x += pkt.vx;
        pkt.rot += dt * 2;

        if (!pkt.scanned && pkt.x >= scanBeamX) {
          pkt.scanned = true;
          if (pkt.isMalicious) {
            pkt.quarantined = true;
            pkt.vx = 0.2;
            emitParticles(scanBeamX, pkt.y, 16, '#c0392b', 4, 1.2);
          } else {
            emitParticles(scanBeamX, pkt.y, 6, '#10b981', 2.5, 0.8);
          }
        }

        if (pkt.quarantined) {
          pkt.opacity -= dt * 0.9;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, pkt.opacity);

        if (pkt.quarantined) {
          draw3DCube(ctx, pkt.x, pkt.y, 0, 24, pkt.rot, pkt.rot, 'rgba(192, 57, 43, 0.4)', '#c0392b', 380);
          ctx.fillStyle = '#c0392b';
          ctx.font = '700 9px "Barlow Condensed", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('BLOCKED: INJECTION', pkt.x, pkt.y - 18);
        } else if (pkt.scanned) {
          draw3DCube(ctx, pkt.x, pkt.y, 0, 20, 0.2, 0.2, 'rgba(16, 185, 129, 0.5)', '#10b981', 380);
          ctx.fillStyle = '#10b981';
          ctx.font = '600 9px "Barlow Condensed", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(pkt.method, pkt.x, pkt.y - 15);
        } else {
          draw3DCube(ctx, pkt.x, pkt.y, 0, 20, 0.2, 0.2, 'rgba(210, 205, 195, 0.4)', '#8c877d', 380);
          ctx.fillStyle = '#8c877d';
          ctx.font = '600 9px "Barlow Condensed", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(pkt.method, pkt.x, pkt.y - 15);
        }
        ctx.restore();

        if (pkt.opacity <= 0 || pkt.x > width + 60) {
          packets.splice(i, 1);
          spawn(false);
        }
      }
    }

    return { init: init, render: render, trigger: trigger };
  })();

  // ── Dispatcher Map ─────────────────────────────────────────────────────────
  var scenes = {
    'how-it-works': funnelScene,
    'judges': judgesScene,
    'bazantic': bazanticScene,
    'clembot': clembotScene,
    'wanessa-labs': wanessaScene,
    'direction': directionScene,
    'guide': guideScene
  };

  var activeScene = scenes[heroType] || funnelScene;
  activeScene.init();

  function triggerAction() {
    activeScene.trigger();
  }

  // ── Animation Loop & Lifecycle ─────────────────────────────────────────────
  var lastTime = performance.now();
  var running = false;
  var rafId = 0;

  function loop(currentTime) {
    if (!running) return;
    if (getComputedStyle(canvas).display === 'none' || width <= 900) {
      rafId = requestAnimationFrame(loop);
      return;
    }
    var dt = Math.min((currentTime - lastTime) / 1000, 0.08);
    lastTime = currentTime;

    ctx.clearRect(0, 0, width, height);
    activeScene.render(dt);
    updateParticles(dt);

    rafId = requestAnimationFrame(loop);
  }

  function renderStatic() {
    if (getComputedStyle(canvas).display === 'none' || width <= 900) return;
    ctx.clearRect(0, 0, width, height);
    activeScene.render(0.016);
  }

  function play() {
    if (reducedMotion) {
      renderStatic();
      return;
    }
    if (running) return;
    running = true;
    lastTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  function pause() {
    running = false;
    cancelAnimationFrame(rafId);
  }

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        if (entries[0].isIntersecting) {
          play();
        } else {
          pause();
        }
      },
      { threshold: 0.01 }
    );
    observer.observe(host);
  } else {
    play();
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      pause();
    } else {
      play();
    }
  });

})();

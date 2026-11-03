"use client";

import { useEffect, useRef } from "react";

const SPACING = 32;
const POINTER_RADIUS = 300;
const WAVE_LIFE = 1.3;
const WAVE_BAND = 52;
const MAX_PARTICLES = 160;

type Ember = { x: number; y: number; z: number; vx: number; vy: number; phase: number };
type Wave = { x: number; y: number; t: number; speed: number; power: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number };
type Particle = { x: number; y: number; vx: number; vy: number; life: number; size: number };

/**
 * A live page-wide background drawn on one fixed 2D canvas behind the content.
 *
 * It is always moving: the dot grid drifts and shimmers, warm ribbons flow across the page, embers sway upward,
 * and sparks cross now and then. It also answers the pointer: a glow follows the cursor, nearby dots swell and
 * link to it, moving leaves a trail of embers and faint ripples, and clicks send a ring through the grid. Scrolling
 * moves the layers at different speeds, drags a warm glow down the page, and drives a rail on the right edge.
 *
 * Decoration only. It runs at 60 frames per second with a fine pointer and 30 on touch, pauses when the tab is
 * hidden, draws one still frame for prefers-reduced-motion, and skips the pointer effects on touch devices.
 */
export function PageBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ctx = context;
    const reducedMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarseMedia = window.matchMedia("(pointer: coarse)");
    let reduced = reducedMedia.matches;
    let coarse = coarseMedia.matches;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let frame = 0;
    let last = 0;
    let time = 0;
    let pointerX = -9999;
    let pointerY = -9999;
    let lagX = -9999;
    let lagY = -9999;
    let pointerActive = false;
    let pointerSpeed = 0;
    let travel = 0;
    let wakeTravel = 0;
    let scrollY = window.scrollY;
    let scrollVelocity = 0;
    const waves: Wave[] = [];
    const sparks: Spark[] = [];
    const particles: Particle[] = [];
    let nextSpark = 1.2;
    let embers: Ember[] = [];

    function seedEmbers() {
      const count = coarse ? 40 : 110;
      embers = Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random() * 4000,
        z: 0.3 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 10,
        vy: 22 + Math.random() * 46,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1 : 1.5);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw(0);
    }

    function progress() {
      const max = Math.max(1, document.documentElement.scrollHeight - height);
      return Math.min(1, Math.max(0, scrollY / max));
    }

    function burst(x: number, y: number, count: number, spread: number, vx = 0, vy = 0) {
      for (let i = 0; i < count; i++) {
        if (particles.length >= MAX_PARTICLES) particles.shift();
        const angle = Math.random() * Math.PI * 2;
        const speed = spread * (0.3 + Math.random() * 0.7);
        particles.push({
          x: x + (Math.random() - 0.5) * 6,
          y: y + (Math.random() - 0.5) * 6,
          vx: Math.cos(angle) * speed + vx * 0.25,
          vy: Math.sin(angle) * speed + vy * 0.25 - 14,
          life: 0.8 + Math.random() * 0.6,
          size: 0.8 + Math.random() * 1.8,
        });
      }
    }

    function draw(dt: number) {
      ctx.clearRect(0, 0, width, height);
      const p = progress();
      const speed = Math.min(1, scrollVelocity / 60);

      // Pointer position eases toward the real one, so the glow trails a little behind it.
      if (pointerActive) {
        if (lagX < -9000) {
          lagX = pointerX;
          lagY = pointerY;
        }
        const k = 1 - Math.pow(0.0006, dt || 0.016);
        lagX += (pointerX - lagX) * k;
        lagY += (pointerY - lagY) * k;
      }
      const boost = Math.min(1, pointerSpeed / 1400);

      // Warm glow that travels down the page with the scroll position.
      const glowY = height * (0.12 + p * 0.76);
      const glow = ctx.createRadialGradient(width * 0.5, glowY, 0, width * 0.5, glowY, Math.max(width, height) * 0.62);
      glow.addColorStop(0, `rgba(239,100,50,${0.12 + speed * 0.07})`);
      glow.addColorStop(1, "rgba(239,100,50,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      // A slow cool blob drifts across the page, echoing the mineral light on the left half of the rift.
      const bx = width * (0.25 + 0.22 * Math.sin(time * 0.11));
      const by = height * (0.55 + 0.28 * Math.cos(time * 0.08 + p * 3));
      const cool = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(width, height) * 0.42);
      cool.addColorStop(0, "rgba(120,145,190,0.07)");
      cool.addColorStop(1, "rgba(120,145,190,0)");
      ctx.fillStyle = cool;
      ctx.fillRect(0, 0, width, height);

      // Flowing ribbons: warm lines that undulate across the page all the time.
      ctx.globalCompositeOperation = "lighter";
      for (let r = 0; r < 3; r++) {
        const baseY = height * (0.2 + r * 0.3) - ((scrollY * (0.06 + r * 0.04)) % (height * 0.9)) + (r === 1 ? height * 0.3 : 0);
        const amp = 26 + r * 12 + boost * 22;
        const freq = 0.0035 + r * 0.0012;
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, "rgba(239,100,50,0)");
        grad.addColorStop(0.5, `rgba(239,120,70,${0.1 + r * 0.02 + boost * 0.08})`);
        grad.addColorStop(1, "rgba(239,100,50,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 14) {
          let y = baseY + Math.sin(x * freq + time * (0.6 + r * 0.25)) * amp + Math.sin(x * freq * 2.3 - time * 0.9) * amp * 0.35;
          if (pointerActive) {
            const d = Math.hypot(x - lagX, y - lagY);
            if (d < 220) y += ((y - lagY) / Math.max(d, 1)) * (1 - d / 220) * 26;
          }
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      // Dot grid. It drifts on a slow flow field, shimmers in three brightness steps, scrolls slower than the content
      // so it reads as depth, bends away from the pointer and rings outward from clicks and from the pointer's wake.
      const offsetY = -((scrollY * 0.25) % SPACING);
      const hot: { x: number; y: number; a: number }[] = [];
      const buckets: number[][] = [[], [], []];
      for (let gy = offsetY; gy < height + SPACING; gy += SPACING) {
        for (let gx = SPACING / 2; gx < width + SPACING; gx += SPACING) {
          let x = gx + Math.sin(gy * 0.011 + time * 0.9) * 3.2;
          let y = gy + Math.cos(gx * 0.011 + time * 0.8) * 3.2;
          let heat = 0;
          if (pointerActive) {
            const dx = gx - lagX;
            const dy = gy - lagY;
            const d = Math.hypot(dx, dy);
            if (d < POINTER_RADIUS && d > 0.01) {
              const f = 1 - d / POINTER_RADIUS;
              const push = (16 + boost * 22) * f * f;
              x += (dx / d) * push;
              y += (dy / d) * push;
              heat = f;
            }
          }
          for (const wave of waves) {
            const d = Math.hypot(gx - wave.x, gy - wave.y);
            const away = Math.abs(d - wave.t * wave.speed);
            if (away < WAVE_BAND && d > 0.01) {
              const g = (1 - away / WAVE_BAND) * (1 - wave.t / WAVE_LIFE) * wave.power;
              x += ((gx - wave.x) / d) * g * 12;
              y += ((gy - wave.y) / d) * g * 12;
              heat = Math.max(heat, g);
            }
          }
          if (heat > 0.03) hot.push({ x, y, a: heat });
          else {
            const shimmer = Math.sin(time * 1.5 + gx * 0.021 + gy * 0.017);
            buckets[shimmer > 0.45 ? 2 : shimmer > -0.3 ? 1 : 0].push(x, y);
          }
        }
      }
      const levels = [0.08, 0.16, 0.3];
      buckets.forEach((points, level) => {
        ctx.fillStyle = `rgba(200,192,186,${levels[level]})`;
        ctx.beginPath();
        for (let i = 0; i < points.length; i += 2) ctx.rect(points[i] - 0.9, points[i + 1] - 0.9, 1.8, 1.8);
        ctx.fill();
      });
      // Dots near the pointer light up and link to it.
      if (pointerActive) {
        ctx.lineWidth = 1;
        for (const dot of hot) {
          const d = Math.hypot(dot.x - lagX, dot.y - lagY);
          if (d < 150 && dot.a > 0.15) {
            ctx.strokeStyle = `rgba(239,130,93,${(1 - d / 150) * 0.38})`;
            ctx.beginPath();
            ctx.moveTo(lagX, lagY);
            ctx.lineTo(dot.x, dot.y);
            ctx.stroke();
          }
        }
      }
      for (const dot of hot) {
        ctx.fillStyle = `rgba(239,130,93,${0.2 + dot.a * 0.8})`;
        const size = 2 + dot.a * 3.2;
        ctx.fillRect(dot.x - size / 2, dot.y - size / 2, size, size);
      }

      ctx.globalCompositeOperation = "lighter";
      // Halo around the pointer.
      if (pointerActive) {
        const radius = 200 + boost * 120;
        const halo = ctx.createRadialGradient(lagX, lagY, 0, lagX, lagY, radius);
        halo.addColorStop(0, `rgba(255,120,60,${0.2 + boost * 0.14})`);
        halo.addColorStop(1, "rgba(255,120,60,0)");
        ctx.fillStyle = halo;
        ctx.fillRect(lagX - radius, lagY - radius, radius * 2, radius * 2);
      }

      // Embers: world position drifts up over time and sways, scroll moves them at their own depth, the pointer swirls them.
      const span = height + 40;
      for (const ember of embers) {
        ember.y -= (ember.vy + scrollVelocity * 0.6 * ember.z) * dt;
        ember.x += (ember.vx / Math.max(width, 1)) * dt;
        if (ember.x < 0) ember.x += 1;
        if (ember.x > 1) ember.x -= 1;
        const sy = ((((ember.y - scrollY * 0.35 * ember.z) % span) + span) % span) - 20;
        let sx = ember.x * width + Math.sin(time * 0.9 + ember.phase) * 14 * ember.z;
        let ey = sy;
        if (pointerActive) {
          const dx = sx - lagX;
          const dy = sy - lagY;
          const d = Math.hypot(dx, dy);
          if (d < 220 && d > 0.01) {
            const f = 1 - d / 220;
            sx += (dx / d) * f * 34 - (dy / d) * f * 22;
            ey += (dy / d) * f * 34 + (dx / d) * f * 22;
          }
        }
        const flicker = 0.55 + 0.45 * Math.sin(time * 2.6 + ember.phase);
        ctx.fillStyle = `rgba(255,${120 + Math.round(ember.z * 60)},60,${(0.3 + 0.55 * ember.z) * flicker})`;
        ctx.beginPath();
        ctx.arc(sx, ey, 0.8 + ember.z * 2.1, 0, Math.PI * 2);
        ctx.fill();
      }

      // Particles shed by the pointer's movement and by clicks.
      for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        particle.life -= dt / 1.1;
        if (particle.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vy -= 18 * dt;
        particle.vx *= Math.pow(0.4, dt);
        ctx.fillStyle = `rgba(255,${130 + Math.round(particle.life * 50)},70,${Math.min(1, particle.life) * 0.85})`;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.size * (0.5 + particle.life * 0.5), 0, Math.PI * 2);
        ctx.fill();
      }

      // Sparks: now and then a bright streak crosses the page.
      for (let i = sparks.length - 1; i >= 0; i--) {
        const spark = sparks[i];
        spark.life -= dt / 1.4;
        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
        if (spark.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        const tail = 0.09;
        const grad = ctx.createLinearGradient(spark.x, spark.y, spark.x - spark.vx * tail, spark.y - spark.vy * tail);
        grad.addColorStop(0, `rgba(255,190,140,${spark.life * 0.9})`);
        grad.addColorStop(1, "rgba(255,120,60,0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(spark.x, spark.y);
        ctx.lineTo(spark.x - spark.vx * tail, spark.y - spark.vy * tail);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";

      // Scroll rail on the right edge.
      if (width >= 900) {
        const railX = width - 13;
        const top = 96;
        const bottom = height - 40;
        ctx.strokeStyle = "rgba(190,184,178,0.1)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(railX, top);
        ctx.lineTo(railX, bottom);
        ctx.stroke();
        const markerY = top + (bottom - top) * p;
        const rail = ctx.createLinearGradient(0, markerY - 70, 0, markerY + 70);
        rail.addColorStop(0, "rgba(239,130,93,0)");
        rail.addColorStop(0.5, `rgba(239,130,93,${0.55 + speed * 0.4})`);
        rail.addColorStop(1, "rgba(239,130,93,0)");
        ctx.strokeStyle = rail;
        ctx.lineWidth = 1.5 + speed * 1.5;
        ctx.beginPath();
        ctx.moveTo(railX, Math.max(top, markerY - 70));
        ctx.lineTo(railX, Math.min(bottom, markerY + 70));
        ctx.stroke();
        ctx.fillStyle = "rgba(255,168,120,0.95)";
        ctx.beginPath();
        ctx.arc(railX, markerY, 2.4 + speed * 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick(timestamp: number) {
      frame = 0;
      if (document.hidden || reduced) return;
      const delta = last ? timestamp - last : 16;
      if (last && delta < (coarse ? 1000 / 30 : 1000 / 62)) {
        frame = requestAnimationFrame(tick);
        return;
      }
      last = timestamp;
      const dt = Math.min(delta, 80) / 1000;
      time += dt;
      scrollVelocity *= Math.pow(0.002, dt);
      pointerSpeed *= Math.pow(0.02, dt);
      for (let i = waves.length - 1; i >= 0; i--) {
        waves[i].t += dt;
        if (waves[i].t >= WAVE_LIFE) waves.splice(i, 1);
      }
      nextSpark -= dt;
      if (nextSpark <= 0) {
        nextSpark = 1.8 + Math.random() * 2.8;
        const fromLeft = Math.random() < 0.5;
        sparks.push({
          x: fromLeft ? -20 : width + 20,
          y: Math.random() * height * 0.7,
          vx: (fromLeft ? 1 : -1) * (520 + Math.random() * 380),
          vy: 120 + Math.random() * 260,
          life: 1,
        });
      }
      draw(dt);
      frame = requestAnimationFrame(tick);
    }

    function start() {
      if (!frame && !reduced && !document.hidden) {
        last = 0;
        frame = requestAnimationFrame(tick);
      }
    }

    function onScroll() {
      const next = window.scrollY;
      scrollVelocity = Math.min(160, Math.max(scrollVelocity, Math.abs(next - scrollY)));
      scrollY = next;
      if (reduced) draw(0);
    }
    let lastMoveTime = 0;
    function onMove(event: PointerEvent) {
      if (event.pointerType !== "mouse" || reduced) return;
      const now = performance.now();
      const dx = event.clientX - pointerX;
      const dy = event.clientY - pointerY;
      const moved = pointerActive ? Math.hypot(dx, dy) : 0;
      const dtMs = Math.max(1, now - lastMoveTime);
      lastMoveTime = now;
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (!pointerActive) {
        lagX = pointerX;
        lagY = pointerY;
      }
      pointerActive = true;
      if (moved > 0) {
        pointerSpeed = Math.max(pointerSpeed * 0.6, (moved / dtMs) * 1000);
        travel += moved;
        wakeTravel += moved;
        // Moving sheds embers, and a long sweep leaves a faint ripple.
        while (travel > 16) {
          travel -= 16;
          burst(pointerX, pointerY, 1, 38, (dx / dtMs) * 1000, (dy / dtMs) * 1000);
        }
        if (wakeTravel > 240) {
          wakeTravel = 0;
          waves.push({ x: pointerX, y: pointerY, t: 0, speed: 380, power: 0.45 });
          if (waves.length > 5) waves.shift();
        }
      }
    }
    function onLeave() {
      pointerActive = false;
      lagX = -9999;
      lagY = -9999;
    }
    function onDown(event: PointerEvent) {
      if (event.pointerType !== "mouse" || event.button !== 0 || reduced) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-no-cursor-fx]") || target.closest("input, textarea")) return;
      waves.push({ x: event.clientX, y: event.clientY, t: 0, speed: 700, power: 1 });
      if (waves.length > 5) waves.shift();
      burst(event.clientX, event.clientY, 22, 190);
    }
    function onVisibility() {
      if (document.hidden) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else start();
    }
    function onMedia() {
      reduced = reducedMedia.matches;
      coarse = coarseMedia.matches;
      seedEmbers();
      resize();
      if (reduced) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else start();
    }

    seedEmbers();
    resize();
    start();
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    reducedMedia.addEventListener("change", onMedia);
    coarseMedia.addEventListener("change", onMedia);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      reducedMedia.removeEventListener("change", onMedia);
      coarseMedia.removeEventListener("change", onMedia);
    };
  }, []);

  return <canvas ref={ref} className="fx-backdrop" aria-hidden="true" />;
}

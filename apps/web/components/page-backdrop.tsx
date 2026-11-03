"use client";

import { useEffect, useRef } from "react";

const SPACING = 34;
const POINTER_RADIUS = 230;
const WAVE_SPEED = 620;
const WAVE_LIFE = 1.1;
const WAVE_BAND = 44;

type Ember = { x: number; y: number; z: number; vx: number; vy: number; phase: number };
type Wave = { x: number; y: number; t: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number };

/**
 * A live page-wide background drawn on one fixed 2D canvas behind the content: a dot grid that bends away from
 * the pointer and rings outward on click, embers that drift upward and move at different speeds as you scroll,
 * a warm glow that travels down the page with scroll position, and a rail on the right edge that tracks scroll.
 * It is decoration only. It pauses when the tab is hidden, is capped at 30 frames per second, draws a single
 * still frame for prefers-reduced-motion, and skips the pointer effects on touch devices.
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
    let pointerActive = false;
    let scrollY = window.scrollY;
    let scrollVelocity = 0;
    const waves: Wave[] = [];
    const sparks: Spark[] = [];
    let nextSpark = 1.5;
    let embers: Ember[] = [];

    function seedEmbers() {
      const count = coarse ? 36 : 96;
      embers = Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random() * 4000,
        z: 0.3 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 6,
        vy: 8 + Math.random() * 16,
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

    function draw(dt: number) {
      ctx.clearRect(0, 0, width, height);
      const p = progress();
      const speed = Math.min(1, scrollVelocity / 60);

      // Warm glow that travels down the page with the scroll position.
      const glowY = height * (0.12 + p * 0.76);
      const glow = ctx.createRadialGradient(width * 0.5, glowY, 0, width * 0.5, glowY, Math.max(width, height) * 0.62);
      glow.addColorStop(0, `rgba(239,100,50,${0.12 + speed * 0.06})`);
      glow.addColorStop(1, "rgba(239,100,50,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
      const side = ctx.createRadialGradient(width * (p < 0.5 ? 0.04 : 0.96), height * (1 - p), 0, width * (p < 0.5 ? 0.04 : 0.96), height * (1 - p), height * 0.55);
      side.addColorStop(0, "rgba(180,120,90,0.05)");
      side.addColorStop(1, "rgba(180,120,90,0)");
      ctx.fillStyle = side;
      ctx.fillRect(0, 0, width, height);
      // A slow cool blob drifts across the page, echoing the mineral light on the left half of the rift.
      const bx = width * (0.25 + 0.2 * Math.sin(time * 0.07));
      const by = height * (0.55 + 0.25 * Math.cos(time * 0.05 + p * 3));
      const cool = ctx.createRadialGradient(bx, by, 0, bx, by, Math.max(width, height) * 0.4);
      cool.addColorStop(0, "rgba(120,145,190,0.06)");
      cool.addColorStop(1, "rgba(120,145,190,0)");
      ctx.fillStyle = cool;
      ctx.fillRect(0, 0, width, height);

      // Dot grid, scrolling slower than the content so it reads as depth.
      const offsetY = -((scrollY * 0.25) % SPACING);
      const hot: { x: number; y: number; a: number }[] = [];
      ctx.fillStyle = "rgba(190,184,178,0.13)";
      ctx.beginPath();
      for (let gy = offsetY; gy < height + SPACING; gy += SPACING) {
        for (let gx = SPACING / 2; gx < width + SPACING; gx += SPACING) {
          let x = gx;
          let y = gy;
          let heat = 0;
          if (pointerActive) {
            const dx = gx - pointerX;
            const dy = gy - pointerY;
            const d = Math.hypot(dx, dy);
            if (d < POINTER_RADIUS && d > 0.01) {
              const f = 1 - d / POINTER_RADIUS;
              x += (dx / d) * f * f * 11;
              y += (dy / d) * f * f * 11;
              heat = f;
            }
          }
          for (const wave of waves) {
            const d = Math.hypot(gx - wave.x, gy - wave.y);
            const radius = wave.t * WAVE_SPEED;
            const away = Math.abs(d - radius);
            if (away < WAVE_BAND && d > 0.01) {
              const g = (1 - away / WAVE_BAND) * (1 - wave.t / WAVE_LIFE);
              x += ((gx - wave.x) / d) * g * 9;
              y += ((gy - wave.y) / d) * g * 9;
              heat = Math.max(heat, g);
            }
          }
          if (heat > 0.02) hot.push({ x, y, a: heat });
          else ctx.rect(x - 0.8, y - 0.8, 1.6, 1.6);
        }
      }
      ctx.fill();
      for (const dot of hot) {
        ctx.fillStyle = `rgba(239,130,93,${0.15 + dot.a * 0.8})`;
        const size = 1.8 + dot.a * 2.6;
        ctx.fillRect(dot.x - size / 2, dot.y - size / 2, size, size);
      }

      // Embers: world position drifts up over time, scroll moves them at their own depth.
      ctx.globalCompositeOperation = "lighter";
      const span = height + 40;
      for (const ember of embers) {
        ember.y -= (ember.vy + scrollVelocity * 0.6 * ember.z) * dt;
        ember.x += (ember.vx / Math.max(width, 1)) * dt;
        if (ember.x < 0) ember.x += 1;
        if (ember.x > 1) ember.x -= 1;
        const sy = (((ember.y - scrollY * 0.35 * ember.z) % span) + span) % span - 20;
        let sx = ember.x * width;
        if (pointerActive) {
          const dx = sx - pointerX;
          const dy = sy - pointerY;
          const d = Math.hypot(dx, dy);
          if (d < 140 && d > 0.01) sx += (dx / d) * (1 - d / 140) * 18;
        }
        const flicker = 0.55 + 0.45 * Math.sin(time * 2.2 + ember.phase);
        const alpha = (0.26 + 0.5 * ember.z) * flicker;
        const radius = 0.7 + ember.z * 1.9;
        ctx.fillStyle = `rgba(255,${120 + Math.round(ember.z * 60)},60,${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
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
        ctx.lineWidth = 1.6;
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
      const delta = last ? timestamp - last : 33;
      if (delta < 1000 / 30) {
        frame = requestAnimationFrame(tick);
        return;
      }
      last = timestamp;
      const dt = Math.min(delta, 80) / 1000;
      time += dt;
      scrollVelocity *= Math.pow(0.002, dt);
      for (let i = waves.length - 1; i >= 0; i--) {
        waves[i].t += dt;
        if (waves[i].t >= WAVE_LIFE) waves.splice(i, 1);
      }
      nextSpark -= dt;
      if (nextSpark <= 0) {
        nextSpark = 2.5 + Math.random() * 3.5;
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
    function onMove(event: PointerEvent) {
      if (event.pointerType !== "mouse" || reduced) return;
      pointerX = event.clientX;
      pointerY = event.clientY;
      pointerActive = true;
    }
    function onLeave() {
      pointerActive = false;
    }
    function onDown(event: PointerEvent) {
      if (event.pointerType !== "mouse" || event.button !== 0 || reduced) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-no-cursor-fx]") || target.closest("input, textarea")) return;
      waves.push({ x: event.clientX, y: event.clientY, t: 0 });
      if (waves.length > 3) waves.shift();
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

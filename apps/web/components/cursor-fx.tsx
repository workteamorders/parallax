"use client";

import { useEffect, useRef } from "react";

const INTERACTIVE = "a, button, [role='button'], summary, label, select";
const TEXT_INPUT = "input, textarea, [contenteditable='true']";
const MAX_RIPPLES = 4;

/**
 * A trailing ring that follows the pointer, grows and snaps onto interactive elements, and a ripple on click.
 * The native cursor is never hidden. The effect is off for touch input and for prefers-reduced-motion, and it
 * stays out of anything marked data-no-cursor-fx (the trading panel) and of text fields.
 */
export function CursorFx() {
  const ringRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ring = ringRef.current;
    if (!ring) return;
    const fine = window.matchMedia("(pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let enabled = fine.matches && !reducedMotion.matches;
    let frame = 0;
    let targetX = -100;
    let targetY = -100;
    let x = -100;
    let y = -100;
    let size = 28;
    let targetSize = 28;
    let shown = false;
    let overLink = false;
    let pressed = false;

    function hide() {
      shown = false;
      ring!.dataset.visible = "false";
    }

    function loop() {
      frame = 0;
      x += (targetX - x) * 0.22;
      y += (targetY - y) * 0.22;
      size += (targetSize - size) * 0.2;
      ring!.style.transform = `translate3d(${x - size / 2}px, ${y - size / 2}px, 0)`;
      ring!.style.width = `${size}px`;
      ring!.style.height = `${size}px`;
      const moving = Math.abs(targetX - x) > 0.3 || Math.abs(targetY - y) > 0.3 || Math.abs(targetSize - size) > 0.3;
      if (moving && shown && !document.hidden) frame = requestAnimationFrame(loop);
    }
    function kick() {
      if (!frame && !document.hidden) frame = requestAnimationFrame(loop);
    }

    function onMove(event: PointerEvent) {
      if (!enabled || event.pointerType !== "mouse") return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-no-cursor-fx]") || target.closest(TEXT_INPUT)) {
        hide();
        return;
      }
      const link = target.closest(INTERACTIVE);
      overLink = Boolean(link);
      if (link) {
        // Snap onto the element: the ring centres on it and takes its size, within limits.
        const box = link.getBoundingClientRect();
        targetX = box.left + box.width / 2 + (event.clientX - (box.left + box.width / 2)) * 0.25;
        targetY = box.top + box.height / 2 + (event.clientY - (box.top + box.height / 2)) * 0.25;
        targetSize = Math.min(Math.max(Math.max(box.width, box.height) * 0.55, 44), 74);
      } else {
        targetX = event.clientX;
        targetY = event.clientY;
        targetSize = 28;
      }
      if (!shown) {
        x = targetX;
        y = targetY;
        shown = true;
        ring!.dataset.visible = "true";
      }
      ring!.dataset.link = overLink ? "true" : "false";
      kick();
    }
    function onDown(event: PointerEvent) {
      if (!enabled || event.pointerType !== "mouse" || event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-no-cursor-fx]") || target.closest(TEXT_INPUT)) return;
      pressed = true;
      ring!.dataset.pressed = "true";
      const live = document.querySelectorAll(".fx-ripple");
      if (live.length >= MAX_RIPPLES) live[0]?.remove();
      const ripple = document.createElement("span");
      ripple.className = "fx-ripple";
      ripple.setAttribute("aria-hidden", "true");
      ripple.style.left = `${event.clientX}px`;
      ripple.style.top = `${event.clientY}px`;
      ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
      document.body.appendChild(ripple);
    }
    function onUp() {
      if (!pressed) return;
      pressed = false;
      ring!.dataset.pressed = "false";
    }
    function onLeave() {
      hide();
    }
    function onVisibility() {
      if (document.hidden) {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      } else kick();
    }
    function onMedia() {
      enabled = fine.matches && !reducedMotion.matches;
      if (!enabled) hide();
      document.documentElement.dataset.cursorFx = enabled ? "on" : "off";
    }

    document.documentElement.dataset.cursorFx = enabled ? "on" : "off";
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onDown, { passive: true });
    window.addEventListener("pointerup", onUp, { passive: true });
    window.addEventListener("pointercancel", onUp, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", onVisibility);
    fine.addEventListener("change", onMedia);
    reducedMotion.addEventListener("change", onMedia);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      fine.removeEventListener("change", onMedia);
      reducedMotion.removeEventListener("change", onMedia);
      document.querySelectorAll(".fx-ripple").forEach((node) => node.remove());
      delete document.documentElement.dataset.cursorFx;
    };
  }, []);

  return <div ref={ringRef} className="fx-ring" aria-hidden="true" data-visible="false" data-link="false" data-pressed="false" />;
}

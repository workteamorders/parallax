"use client";

import { useEffect, useId, useRef } from "react";
import type * as Three from "three";
import { createRiftGeometry, riftSurfacePoint } from "../lib/rift-geometry";

type RiftSceneProps = {
  focus?: "balanced" | "event" | "market";
  selectionKey?: string;
  paused?: boolean;
  resetToken?: number;
};

export function RiftScene({
  focus = "balanced",
  selectionKey = "",
  paused = false,
  resetToken = 0,
}: RiftSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fallbackRef = useRef<SVGSVGElement>(null);
  const controls = useRef({ focus, selectionKey, paused, resetToken });
  const refreshRef = useRef<(() => void) | null>(null);
  const id = useId().replace(/:/g, "");

  useEffect(() => {
    controls.current = { focus, selectionKey, paused, resetToken };
    refreshRef.current?.();
  }, [focus, selectionKey, paused, resetToken]);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const fallback = fallbackRef.current;
    if (!root || !canvas || !fallback) return;

    let disposed = false;
    let failed = false;
    let frame = 0;
    let renderer: Three.WebGLRenderer | undefined;
    let resizeObserver: ResizeObserver | undefined;
    let intersectionObserver: IntersectionObserver | undefined;
    const geometries = new Set<Three.BufferGeometry>();
    const materials = new Set<Three.Material>();
    const textures = new Set<Three.Texture>();
    const listeners: (() => void)[] = [];
    const reducedMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarseMedia = window.matchMedia("(pointer: coarse)");
    let reduced = reducedMedia.matches || coarseMedia.matches;
    let visible = true;
    let width = 0;
    let height = 0;
    let lastFrame = 0;
    let renderedFrames = 0;
    let elapsed = 0;
    let previousReset = controls.current.resetToken;
    let yaw = 0;
    let pitch = 0;
    let dragYaw = 0;
    let dragPitch = 0;
    let hoverX = 0;
    let hoverY = 0;
    let drag: {
      id: number;
      x: number;
      y: number;
      yaw: number;
      pitch: number;
    } | null = null;
    let schedule = () => {};
    let resizeScene = () => {};

    function motionState() {
      root!.dataset.motion = reduced
        ? "reduced"
        : controls.current.paused
        ? "paused"
        : "active";
    }

    function showFallback() {
      root!.dataset.renderer = "fallback";
      canvas!.style.opacity = "0";
      fallback!.style.opacity = "1";
    }

    function disposeResources() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      schedule = () => {};
      resizeScene = () => {};
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      for (const remove of listeners) remove();
      listeners.length = 0;
      if (drag && root!.hasPointerCapture(drag.id))
        root!.releasePointerCapture(drag.id);
      drag = null;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      geometries.clear();
      materials.clear();
      textures.clear();
      renderer?.dispose();
      renderer = undefined;
    }

    function fail() {
      if (failed) return;
      failed = true;
      showFallback();
      disposeResources();
    }

    function invalidate() {
      schedule();
    }

    function onMediaChange() {
      reduced = reducedMedia.matches || coarseMedia.matches;
      lastFrame = 0;
      motionState();
      resizeScene();
      invalidate();
    }

    function onVisibilityChange() {
      lastFrame = 0;
      if (document.hidden && frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      } else invalidate();
    }

    function onContextLost(event: Event) {
      event.preventDefault();
      if (!disposed) fail();
    }

    motionState();
    showFallback();
    reducedMedia.addEventListener("change", onMediaChange);
    coarseMedia.addEventListener("change", onMediaChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    canvas.addEventListener("webglcontextlost", onContextLost);
    listeners.push(
      () => reducedMedia.removeEventListener("change", onMediaChange),
      () => coarseMedia.removeEventListener("change", onMediaChange),
      () =>
        document.removeEventListener("visibilitychange", onVisibilityChange),
      () => canvas.removeEventListener("webglcontextlost", onContextLost),
    );

    refreshRef.current = () => {
      if (controls.current.resetToken !== previousReset) {
        previousReset = controls.current.resetToken;
        dragYaw = 0;
        dragPitch = 0;
        hoverX = 0;
        hoverY = 0;
        if (drag && root.hasPointerCapture(drag.id))
          root.releasePointerCapture(drag.id);
        drag = null;
      }
      motionState();
      invalidate();
    };

    // WebGL is deliberately absent from SSR and the initial paint.
    void import("three")
      .then((THREE) => {
        if (disposed || failed) return;
        try {
          // Supply the context quietly and retain the surface when motion stops.
          const context = canvas.getContext("webgl2", {
            alpha: true,
            antialias: true,
            powerPreference: "low-power",
            premultipliedAlpha: true,
            preserveDrawingBuffer: true,
          });
          if (!context) {
            fail();
            return;
          }
          renderer = new THREE.WebGLRenderer({
            canvas,
            context,
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true,
          });
          let shaderFailed = false;
          renderer.debug.onShaderError = () => {
            shaderFailed = true;
          };
          renderer.setClearColor(0x0d0d0f, 0);
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 1.15;

          function geometry<T extends Three.BufferGeometry>(value: T): T {
            geometries.add(value);
            return value;
          }
          function material<T extends Three.Material>(value: T): T {
            materials.add(value);
            return value;
          }

          const scene = new THREE.Scene();
          scene.fog = new THREE.FogExp2(0x0d0d0f, 0.013);
          const camera = new THREE.PerspectiveCamera(39, 1, 0.1, 150);
          const world = new THREE.Group();
          scene.add(world);

          scene.add(new THREE.HemisphereLight(0xb6bdca, 0x49444a, 1.8));
          const key = new THREE.DirectionalLight(0xece9df, 2.6);
          key.position.set(-7, 14, 8);
          scene.add(key);
          const mineralRim = new THREE.DirectionalLight(0xe5edff, 2.7);
          mineralRim.position.set(-10, 5, -7);
          scene.add(mineralRim);
          const emberRim = new THREE.DirectionalLight(0xff783e, 3.8);
          emberRim.position.set(9, 4, -5);
          scene.add(emberRim);
          const faultLights = [-3.3, 0.2, 3.7].map((z) => {
            const light = new THREE.PointLight(0xff5b19, 38, 12, 2);
            light.position.set(0, 0.45, z);
            world.add(light);
            return light;
          });

          const stone = material(
            new THREE.MeshStandardMaterial({
              color: 0xa0a3a9,
              vertexColors: true,
              roughness: 0.98,
              metalness: 0.02,
              flatShading: true,
            }),
          );
          // Object-space strata stay attached to the rock and require no downloaded textures.
          stone.onBeforeCompile = (shader) => {
            shader.vertexShader = shader.vertexShader
              .replace(
                "#include <common>",
                "#include <common>\nvarying vec3 vRiftPosition;",
              )
              .replace(
                "#include <begin_vertex>",
                "#include <begin_vertex>\nvRiftPosition = position;",
              );
            shader.fragmentShader = shader.fragmentShader
              .replace(
                "#include <common>",
                `
            #include <common>
            varying vec3 vRiftPosition;
            float riftHash(vec3 p) { return fract(sin(dot(p, vec3(127.1,311.7,74.7))) * 43758.5453); }
            float riftNoise(vec3 p) {
              vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
              return mix(mix(mix(riftHash(i),riftHash(i+vec3(1,0,0)),f.x),
                mix(riftHash(i+vec3(0,1,0)),riftHash(i+vec3(1,1,0)),f.x),f.y),
                mix(mix(riftHash(i+vec3(0,0,1)),riftHash(i+vec3(1,0,1)),f.x),
                mix(riftHash(i+vec3(0,1,1)),riftHash(i+vec3(1,1,1)),f.x),f.y),f.z);
            }
          `,
              )
              .replace(
                "#include <color_fragment>",
                `
            #include <color_fragment>
            // Compress face-color contrast without flattening the sculpted normals.
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * vec3(0.145, 0.151, 0.162), 0.55);
            float coarse = riftNoise(vRiftPosition * 3.8);
            float grain = riftNoise(vRiftPosition * 32.0);
            float strata = riftNoise(vRiftPosition * vec3(1.7, 8.0, 1.7) + coarse * 0.8);
            diffuseColor.rgb *= (0.96 + grain * 0.08) * (0.96 + strata * 0.08);
            float seam = 1.0 - smoothstep(0.018, 0.06, abs(sin(vRiftPosition.y * 8.0 + coarse * 4.0)));
            diffuseColor.rgb += vec3(0.006,0.0065,0.007) * seam * coarse;
          `,
              );
          };

          const lands: Three.Group[] = [];
          const veinWhite = material(
            new THREE.LineBasicMaterial({
              color: 0xc6cbd1,
              transparent: true,
              opacity: 0.3,
            }),
          );
          const veinEmber = material(
            new THREE.LineBasicMaterial({
              color: 0xe78653,
              transparent: true,
              opacity: 0.43,
            }),
          );
          const hot = material(
            new THREE.MeshBasicMaterial({ color: 0xffa15b, toneMapped: false }),
          );
          const ember = material(
            new THREE.MeshBasicMaterial({
              color: 0xff4c0b,
              transparent: true,
              opacity: 0.2,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              toneMapped: false,
            }),
          );
          const floating: { mesh: Three.Mesh; y: number; phase: number }[] = [];

          const shardGeometry = geometry(new THREE.IcosahedronGeometry(1, 0));
          const shardPositions = shardGeometry.getAttribute("position");
          for (let i = 0; i < shardPositions.count; i++) {
            const x = shardPositions.getX(i);
            const y = shardPositions.getY(i);
            const z = shardPositions.getZ(i);
            const deform = 0.85 + Math.sin(x * 8 + y * 5 + z * 7) * 0.18;
            shardPositions.setXYZ(
              i,
              x * deform + y * 0.18,
              y * deform,
              z * deform,
            );
          }
          shardGeometry.computeVertexNormals();
          const shardStone = material(
            new THREE.MeshStandardMaterial({
              color: 0x45474d,
              roughness: 0.97,
              metalness: 0.04,
              flatShading: true,
            }),
          );

          for (const side of [-1, 1] as const) {
            const land = new THREE.Group();
            lands.push(land);
            world.add(land);
            const data = createRiftGeometry(side);
            const terrain = geometry(new THREE.BufferGeometry());
            terrain.setAttribute(
              "position",
              new THREE.BufferAttribute(data.positions, 3),
            );
            terrain.setAttribute(
              "normal",
              new THREE.BufferAttribute(data.normals, 3),
            );
            terrain.setAttribute(
              "color",
              new THREE.BufferAttribute(data.colors, 3),
            );
            land.add(new THREE.Mesh(terrain, stone));

            const edge = Array.from({ length: 65 }, (_, i) => {
              const point = riftSurfacePoint(
                side,
                0.004,
                0.035 + (i / 64) * 0.93,
              );
              return new THREE.Vector3(point[0], point[1] + 0.018, point[2]);
            });
            const fault = new THREE.CatmullRomCurve3(edge);
            land.add(
              new THREE.Mesh(
                geometry(new THREE.TubeGeometry(fault, 100, 0.019, 4, false)),
                hot,
              ),
            );
            land.add(
              new THREE.Mesh(
                geometry(new THREE.TubeGeometry(fault, 100, 0.105, 5, false)),
                ember,
              ),
            );

            for (let i = 0; i < 17; i++) {
              const t = 0.08 + (i / 18) * 0.85;
              const points: Three.Vector3[] = [];
              const reach =
                0.08 + (Math.sin(i * 17.1 + side) * 0.5 + 0.5) * 0.28;
              for (let j = 0; j <= 14; j++) {
                const u = 0.012 + (j / 14) * reach;
                const point = riftSurfacePoint(
                  side,
                  u,
                  t + Math.sin(j * 1.7 + i * 3) * 0.006 + j * 0.0015,
                );
                points.push(
                  new THREE.Vector3(point[0], point[1] + 0.028, point[2]),
                );
              }
              const vein = geometry(
                new THREE.BufferGeometry().setFromPoints(points),
              );
              land.add(
                new THREE.Line(vein, side === -1 ? veinWhite : veinEmber),
              );

              if (i % 3 === 1) {
                const origin = riftSurfacePoint(side, 0, t);
                const fracture = Array.from(
                  { length: 7 },
                  (_, j) =>
                    new THREE.Vector3(
                      origin[0] +
                        side * (j * 0.08 + Math.sin(j * 3 + i) * 0.05),
                      origin[1] - j * 0.35,
                      origin[2] + Math.sin(j * 2.3 + i) * 0.09,
                    ),
                );
                const curve = new THREE.CatmullRomCurve3(fracture);
                land.add(
                  new THREE.Mesh(
                    geometry(
                      new THREE.TubeGeometry(curve, 18, 0.009, 3, false),
                    ),
                    hot,
                  ),
                );
              }
            }

            for (let i = 0; i < 14; i++) {
              const u = 0.2 + ((Math.sin(i * 12.7 + side * 3) + 1) / 2) * 0.62;
              const t = 0.12 + (i / 16) * 0.77;
              const point = riftSurfacePoint(side, u, t);
              const outcrop = new THREE.Mesh(shardGeometry, shardStone);
              const size = 0.17 + (Math.sin(i * 5.3) * 0.5 + 0.5) * 0.23;
              outcrop.position.set(point[0], point[1] + size * 0.2, point[2]);
              outcrop.scale.set(
                size * 1.3,
                size * (i % 4 === 0 ? 2.5 : 0.8),
                size,
              );
              outcrop.rotation.set(i * 0.21, i * 2.3, side * 0.23);
              land.add(outcrop);
            }
          }

          const shardPlacements = [
            [-9.8, -0.1, 1.8, 0.38],
            [-8.4, -2.4, 3.8, 0.24],
            [-7.2, 2.8, -3.4, 0.19],
            [-2.0, -3.9, 4.8, 0.15],
            [8.7, 0.8, -2.9, 0.36],
            [9.6, -1.5, 0.8, 0.21],
            [6.5, -3.7, 3.4, 0.23],
            [1.5, -1.9, -4.8, 0.11],
          ];
          shardPlacements.forEach(([x, y, z, size], i) => {
            const mesh = new THREE.Mesh(shardGeometry, shardStone);
            mesh.position.set(x, y, z);
            mesh.scale.set(size, size * (1.2 + (i % 3) * 0.5), size * 0.8);
            mesh.rotation.set(i * 0.7, i * 1.4, i * 0.3);
            world.add(mesh);
            floating.push({ mesh, y, phase: i * 1.9 });
          });

          const haloSize = 64;
          const haloData = new Uint8Array(haloSize * haloSize * 4);
          for (let y = 0; y < haloSize; y++) {
            for (let x = 0; x < haloSize; x++) {
              const radius = Math.hypot(
                ((x + 0.5) / haloSize) * 2 - 1,
                ((y + 0.5) / haloSize) * 2 - 1,
              );
              const offset = (y * haloSize + x) * 4;
              haloData[offset] =
                haloData[offset + 1] =
                haloData[offset + 2] =
                  255;
              haloData[offset + 3] = Math.round(
                Math.pow(Math.max(0, 1 - radius), 3) * 255,
              );
            }
          }
          const haloTexture = new THREE.DataTexture(
            haloData,
            haloSize,
            haloSize,
          );
          haloTexture.needsUpdate = true;
          haloTexture.magFilter = THREE.LinearFilter;
          textures.add(haloTexture);
          const glowMaterial = material(
            new THREE.SpriteMaterial({
              map: haloTexture,
              color: 0xff571c,
              transparent: true,
              opacity: 0.43,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
              toneMapped: false,
            }),
          );
          for (const z of [-3.8, -1.7, 0.6, 2.8, 4.2]) {
            const glow = new THREE.Sprite(glowMaterial);
            glow.position.set(0, -0.9, z);
            glow.scale.set(3.7, 6.4, 1);
            world.add(glow);
          }
          const hazeMaterial = material(
            new THREE.SpriteMaterial({
              map: haloTexture,
              color: 0x7d7370,
              transparent: true,
              opacity: 0.065,
              depthWrite: false,
            }),
          );
          const haze = new THREE.Sprite(hazeMaterial);
          haze.position.set(0, -4.1, 1);
          haze.scale.set(27, 4.4, 1);
          world.add(haze);

          const motes = new Float32Array(32 * 3);
          for (let i = 0; i < 32; i++) {
            motes[i * 3] = Math.sin(i * 14.1) * (i % 3 === 0 ? 8 : 1.1);
            motes[i * 3 + 1] = -2.5 + (Math.sin(i * 7.3) * 0.5 + 0.5) * 6;
            motes[i * 3 + 2] = Math.cos(i * 3.8) * 6;
          }
          const dustGeometry = geometry(new THREE.BufferGeometry());
          dustGeometry.setAttribute(
            "position",
            new THREE.BufferAttribute(motes, 3),
          );
          const dust = new THREE.Points(
            dustGeometry,
            material(
              new THREE.PointsMaterial({
                color: 0xe5a479,
                size: 0.027,
                transparent: true,
                opacity: 0.5,
                depthWrite: false,
              }),
            ),
          );
          world.add(dust);

          function resize() {
            if (!renderer || disposed || failed) return;
            const bounds = root!.getBoundingClientRect();
            const nextWidth = Math.round(bounds.width);
            const nextHeight = Math.round(bounds.height);
            if (nextWidth === width && nextHeight === height) {
              invalidate();
              return;
            }
            width = nextWidth;
            height = nextHeight;
            if (width < 1 || height < 1) return;
            showFallback();
            const mobile = coarseMedia.matches || width < 768;
            renderer.setPixelRatio(
              Math.min(window.devicePixelRatio || 1, mobile ? 1.2 : 1.5),
            );
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            const distance = Math.max(
              17.8,
              11.8 / (Math.tan((39 * Math.PI) / 360) * camera.aspect),
            );
            camera.position.set(
              distance * 0.035,
              distance * 0.48 - 0.2,
              distance * 0.877,
            );
            camera.lookAt(0, -0.35, 0);
            camera.updateProjectionMatrix();
            invalidate();
          }

          function animate(timestamp: number) {
            frame = 0;
            if (
              disposed ||
              failed ||
              !renderer ||
              !visible ||
              document.hidden ||
              width < 1 ||
              height < 1
            )
              return;
            const active = !reduced && !controls.current.paused;
            const delta = lastFrame ? timestamp - lastFrame : 34;
            if (delta < 1000 / 30) {
              schedule();
              return;
            }
            lastFrame = timestamp;
            if (active) elapsed += Math.min(delta, 70) / 1000;
            const eventFocus = controls.current.focus === "event";
            const marketFocus = controls.current.focus === "market";
            const targetYaw =
              -0.15 +
              (eventFocus ? -0.15 : marketFocus ? 0.16 : 0) +
              dragYaw +
              (active ? hoverX * 0.035 : 0);
            const targetPitch = dragPitch + (active ? hoverY * 0.018 : 0);
            const easing = active ? 0.085 : 1;
            yaw += (targetYaw - yaw) * easing;
            pitch += (targetPitch - pitch) * easing;
            world.rotation.set(pitch, yaw, -0.025);
            lands[0].position.y = Math.sin(elapsed * 0.32) * 0.045;
            lands[1].position.y = 0.12 + Math.sin(elapsed * 0.29 + 1.8) * 0.055;
            for (const shard of floating)
              shard.mesh.position.y =
                shard.y + Math.sin(elapsed * 0.44 + shard.phase) * 0.1;
            dust.position.y = Math.sin(elapsed * 0.16) * 0.12;
            let selection = 0;
            for (let i = 0; i < controls.current.selectionKey.length; i++)
              selection =
                (selection * 31 + controls.current.selectionKey.charCodeAt(i)) |
                0;
            const accent = (Math.abs(selection) % 19) / 19;
            mineralRim.intensity = eventFocus ? 4.4 : 2.7;
            emberRim.intensity = marketFocus ? 5.0 : 3.8;
            glowMaterial.opacity =
              0.39 + accent * 0.055 + Math.sin(elapsed * 0.7) * 0.025;
            faultLights.forEach((light, i) => {
              light.intensity =
                35 + Math.sin(elapsed * 0.8 + i) * 3 + accent * 4;
            });
            try {
              renderer.render(scene, camera);
              if (shaderFailed || renderer.getContext().isContextLost()) {
                fail();
                return;
              }
              root!.dataset.renderer = "webgl";
              root!.dataset.frame = String(++renderedFrames);
              canvas!.style.opacity = "1";
              fallback!.style.opacity = "0";
            } catch {
              fail();
              return;
            }
            if (active) schedule();
          }

          schedule = () => {
            if (
              !frame &&
              !disposed &&
              !failed &&
              visible &&
              !document.hidden &&
              width > 0 &&
              height > 0
            ) {
              frame = requestAnimationFrame(animate);
            }
          };
          resizeScene = resize;

          function pointerDown(event: PointerEvent) {
            // Touch remains native pan-y; coarse devices never enter a drag gesture.
            if (event.pointerType !== "mouse" || event.button !== 0) return;
            drag = {
              id: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              yaw: dragYaw,
              pitch: dragPitch,
            };
            root!.setPointerCapture(event.pointerId);
            event.preventDefault();
          }
          function pointerMove(event: PointerEvent) {
            if (event.pointerType !== "mouse") return;
            const bounds = root!.getBoundingClientRect();
            if (drag && drag.id === event.pointerId) {
              dragYaw = THREE.MathUtils.clamp(
                drag.yaw + (event.clientX - drag.x) * 0.003,
                -0.38,
                0.38,
              );
              dragPitch = THREE.MathUtils.clamp(
                drag.pitch + (event.clientY - drag.y) * 0.0016,
                -0.12,
                0.12,
              );
            } else {
              if (reduced || controls.current.paused) return;
              hoverX =
                ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) *
                  2 -
                1;
              hoverY =
                ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) *
                  2 -
                1;
            }
            invalidate();
          }
          function pointerUp(event: PointerEvent) {
            if (drag?.id !== event.pointerId) return;
            drag = null;
            if (root!.hasPointerCapture(event.pointerId))
              root!.releasePointerCapture(event.pointerId);
          }
          function pointerLeave() {
            hoverX = 0;
            hoverY = 0;
            if (!drag && !reduced && !controls.current.paused) invalidate();
          }

          root.addEventListener("pointerdown", pointerDown);
          root.addEventListener("pointermove", pointerMove);
          root.addEventListener("pointerup", pointerUp);
          root.addEventListener("pointercancel", pointerUp);
          root.addEventListener("lostpointercapture", pointerUp);
          root.addEventListener("pointerleave", pointerLeave);
          window.addEventListener("resize", resize);
          listeners.push(
            () => root.removeEventListener("pointerdown", pointerDown),
            () => root.removeEventListener("pointermove", pointerMove),
            () => root.removeEventListener("pointerup", pointerUp),
            () => root.removeEventListener("pointercancel", pointerUp),
            () => root.removeEventListener("lostpointercapture", pointerUp),
            () => root.removeEventListener("pointerleave", pointerLeave),
            () => window.removeEventListener("resize", resize),
          );
          if (typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(root);
          }
          if (typeof IntersectionObserver !== "undefined") {
            intersectionObserver = new IntersectionObserver(
              ([entry]) => {
                visible = entry.isIntersecting;
                lastFrame = 0;
                if (!visible && frame) {
                  cancelAnimationFrame(frame);
                  frame = 0;
                } else invalidate();
              },
              { threshold: 0 },
            );
            intersectionObserver.observe(root);
          }
          resize();
        } catch {
          if (!disposed) fail();
        }
      })
      .catch(() => {
        if (!disposed) fail();
      });

    return () => {
      disposed = true;
      refreshRef.current = null;
      disposeResources();
      showFallback();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      className="rift-scene"
      aria-hidden="true"
      data-renderer="fallback"
      data-motion="reduced"
      style={{ position: "relative", touchAction: "pan-y", overflow: "hidden" }}
    >
      <canvas
        ref={canvasRef}
        className="rift-scene-canvas"
        style={{
          position: "absolute",
          inset: 0,
          display: "block",
          width: "100%",
          height: "100%",
          opacity: 0,
        }}
      />
      <svg
        ref={fallbackRef}
        className="rift-scene-fallback"
        viewBox="0 0 1400 620"
        fill="none"
        focusable="false"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
        }}
      >
        <defs>
          <linearGradient
            id={`${id}-top`}
            x1="300"
            y1="100"
            x2="650"
            y2="340"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#53565e" />
            <stop offset=".45" stopColor="#303138" />
            <stop offset="1" stopColor="#242429" />
          </linearGradient>
          <linearGradient
            id={`${id}-cliff`}
            x1="600"
            y1="270"
            x2="580"
            y2="534"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#444149" />
            <stop offset=".45" stopColor="#28262d" />
            <stop offset="1" stopColor="#111115" />
          </linearGradient>
          <linearGradient
            id={`${id}-warm`}
            x1="740"
            y1="180"
            x2="1150"
            y2="370"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#563b30" />
            <stop offset=".35" stopColor="#35353a" />
            <stop offset="1" stopColor="#27272d" />
          </linearGradient>
          <linearGradient
            id={`${id}-fault`}
            x1="620"
            y1="190"
            x2="730"
            y2="460"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#ffb17d" />
            <stop offset=".5" stopColor="#ff6629" />
            <stop offset="1" stopColor="#72240d" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${id}-halo`}>
            <stop stopColor="#ff682b" stopOpacity=".48" />
            <stop offset="1" stopColor="#ff4e15" stopOpacity="0" />
          </radialGradient>
          <filter
            id={`${id}-blur`}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="16" />
          </filter>
          <filter id={`${id}-stone`} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency=".48"
              numOctaves="3"
              seed="17"
              result="grain"
            />
            <feColorMatrix in="grain" type="saturate" values="0" />
            <feBlend in="SourceGraphic" mode="soft-light" />
          </filter>
          <clipPath id={`${id}-left`}>
            <path d="m164 283 63-63 108-56 116-26 83 21 76 42 36 38-19 40 16 35-33 40-57 29-122-4-127-28-95-33Z" />
          </clipPath>
          <clipPath id={`${id}-right`}>
            <path d="m703 226 37-47 89-26 108 17 119 47 122 81-52 43-132 26-110-5-115-41-47-41Z" />
          </clipPath>
        </defs>
        <ellipse
          cx="704"
          cy="356"
          rx="130"
          ry="210"
          fill={`url(#${id}-halo)`}
          opacity=".64"
        />
        <ellipse
          cx="697"
          cy="527"
          rx="410"
          ry="22"
          fill="#77717d"
          opacity=".055"
          filter={`url(#${id}-blur)`}
        />
        <g strokeLinejoin="round">
          <path
            d="m164 283 79 93 83 70 90 57 93 36 63-40 51-104 20-81-33 40-57 29-122-4-127-28-95-33Z"
            fill={`url(#${id}-cliff)`}
          />
          <path
            d="m229 316 41 68 56 62-15-90m70 11 35 136 22-119m66-2 5 157 39-119m-305-44 57 12-28-73m291 80-27 25-16-46m-143 3 62 65-12-62"
            stroke="#6c6673"
            strokeOpacity=".23"
          />
          <path
            d="m326 446 55-79 35 136-50-47m143 83-5-157 49 1-5 37m-320-44 72 12 26 58"
            fill="#0e0e13"
            fillOpacity=".4"
          />
          <path
            d="m164 283 63-63 108-56 116-26 83 21 76 42 36 38-19 40 16 35-33 40-57 29-122-4-127-28-95-33Z"
            fill={`url(#${id}-top)`}
          />
          <g
            clipPath={`url(#${id}-left)`}
            opacity=".16"
            filter={`url(#${id}-stone)`}
          >
            <path
              d="m174 282 170-73 63 62 105-86 91 58-68 62-132-34-79 80Z"
              fill="#919198"
            />
            <path
              d="m335 164 9 45 63 62 44-133 34 132 49-111 69 84-68 62 108 9-124 44-116-87-99 80-77-131Z"
              fill="#27272d"
            />
          </g>
          <path
            d="m181 274 47-48 109-57 112-27 75 19"
            stroke="#c6cbd3"
            strokeOpacity=".65"
            strokeWidth="1.4"
          />
          <path
            d="m626 279-51-12-24-24-35 4-21-20m114 104-60-7-30 15-32-11-27 6m100-132-24 15-18-4-37 25-18-3m-122-48 15 27-18 23 19 19-7 33"
            stroke="#cbc9c5"
            strokeOpacity=".35"
            strokeWidth=".8"
          />
          <path
            d="m703 226 19 54 47 41 115 41 110 5 132-26 52-43-30 109-96 65-114 57-96-34-89-93-30-118Z"
            fill={`url(#${id}-cliff)`}
          />
          <path
            d="m722 280 31 122 40-48 49 141 42-133 54 167 56-162 58 105 23-123m73 58-73-58 51-8m-332 13 52 58-7-81"
            stroke="#8a6352"
            strokeOpacity=".28"
          />
          <path
            d="m753 402 40-48 49 141-52-35m94-98 54 167 56-162-14 96m72 9 23-123 51-8"
            fill="#111115"
            fillOpacity=".5"
          />
          <path
            d="m703 226 37-47 89-26 108 17 119 47 122 81-52 43-132 26-110-5-115-41-47-41Z"
            fill={`url(#${id}-warm)`}
          />
          <g
            clipPath={`url(#${id}-right)`}
            opacity=".18"
            filter={`url(#${id}-stone)`}
          >
            <path
              d="m740 179 96 48 53-38 76 83 91-55 70 124-132 26-105-43-73 12-94-56Z"
              fill="#6b6261"
            />
            <path
              d="m829 153 7 74-67 94 120 3 76-52-76-83 48-19 119 47-62 150 132-26 52-43-86-8"
              fill="#24242a"
            />
          </g>
          <path
            d="m747 180 82-23 108 17 117 46"
            stroke="#d7926d"
            strokeOpacity=".5"
          />
          <path
            d="m719 244 52-7 29 18 30-7 37 16m-135 26 38-4 31 28 39-3 23 13m-99-135 42 12 10-10 25 11m26 62 42 15 7 20 32 15"
            stroke="#ed9462"
            strokeOpacity=".42"
            strokeWidth=".85"
          />
          <path
            d="m610 201 36 38-19 40 16 35-33 40m93-128 19 54 47 41"
            stroke="#ff5920"
            strokeWidth="8"
            opacity=".5"
            filter={`url(#${id}-blur)`}
          />
          <path
            d="m610 201 36 38-19 40 16 35-33 40m93-128 19 54 47 41"
            stroke={`url(#${id}-fault)`}
            strokeWidth="2.1"
          />
          <path
            d="m635 318-7 28-13 15-7 36m119-110 15 39 2 30 15 27m-123-144-5 21 7 21"
            stroke="#ff783c"
            strokeOpacity=".6"
          />
          <g fill="#55535a" stroke="#96939c" strokeOpacity=".27">
            <path d="m371 209 14-34 10 37-9 13Z" />
            <path d="m484 277 10-22 13 32-12 5Z" />
            <path d="m914 236 14-38 12 49-17 8Z" />
            <path d="m1034 291 8-25 16 37-14 7Z" />
            <path d="m126 332 10-15 13 25-11 27Z" />
            <path d="m223 408 8-12 9 19-5 16Z" />
            <path d="m1197 268 13-27 18 31-12 25Z" />
            <path d="m1149 430 9-15 14 22-10 14Z" />
            <path d="m553 471 7-10 6 17-8 9Z" />
          </g>
        </g>
        <g fill="#e8b18a" opacity=".55">
          <circle cx="664" cy="192" r="1" />
          <circle cx="682" cy="364" r="1.2" />
          <circle cx="702" cy="421" r=".7" />
          <circle cx="1190" cy="349" r=".8" />
          <circle cx="260" cy="179" r=".7" />
        </g>
      </svg>
    </div>
  );
}

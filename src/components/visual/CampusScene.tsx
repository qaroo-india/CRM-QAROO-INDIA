/**
 * "Campus network": a glowing globe of nodes (students, courses, companies)
 * joined by links, with orbit rings, travelling satellites, pulsing hubs and
 * drifting particles. Plain three.js, lazy-loaded, coloured from the theme
 * tokens so it follows light/dark.
 *
 * It costs nothing while nobody can see it: rendering stops when the scene is
 * off-screen or the tab is hidden, "reduce motion" gets a single still frame,
 * and without WebGL the component renders nothing (the page's own background
 * stays).
 */

import { useEffect, useRef } from 'react';
import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  WebGLRenderer,
  type Blending,
  type Material,
  type Object3D,
} from 'three';
import { cn } from '@/lib/cn';

type Variant = 'hero' | 'banner';

const SETTINGS: Record<Variant, { nodes: number; particles: number; cameraZ: number; offset: [number, number]; dot: number }> = {
  hero: { nodes: 280, particles: 420, cameraZ: 7.4, offset: [1.35, 1.05], dot: 0.08 },
  banner: { nodes: 170, particles: 160, cameraZ: 6.6, offset: [0, 0], dot: 0.09 },
};

/** Resolve a CSS colour token (oklch included) to sRGB through a 1x1 canvas. */
function tokenColor(name: string, fallback: string): Color {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return new Color(fallback);
  ctx.fillStyle = fallback;
  ctx.fillStyle = raw;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return new Color().setRGB(r! / 255, g! / 255, b! / 255, SRGBColorSpace);
}

/** Soft round dot, so points glow instead of rendering as squares. */
function dotTexture(): CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Evenly spread points on a sphere (Fibonacci lattice). */
function spherePoints(count: number, radius: number): number[] {
  const out: number[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    out.push(Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius);
  }
  return out;
}

/** Each node linked to its nearest neighbours: the "network" lines. */
function neighbourLinks(points: number[], perNode: number, maxDistance: number): number[] {
  const n = points.length / 3;
  const seen = new Set<string>();
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const near: { j: number; d: number }[] = [];
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const d = Math.hypot(points[i * 3]! - points[j * 3]!, points[i * 3 + 1]! - points[j * 3 + 1]!, points[i * 3 + 2]! - points[j * 3 + 2]!);
      if (d < maxDistance) near.push({ j, d });
    }
    near.sort((a, b) => a.d - b.d);
    for (const { j } of near.slice(0, perNode)) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(points[i * 3]!, points[i * 3 + 1]!, points[i * 3 + 2]!, points[j * 3]!, points[j * 3 + 1]!, points[j * 3 + 2]!);
    }
  }
  return out;
}

export default function CampusScene({ variant = 'hero', className }: { variant?: Variant; className?: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    const settings = SETTINGS[variant];
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return; // No WebGL: keep the page's own background.
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;opacity:0;transition:opacity 0.9s cubic-bezier(0.16,1,0.3,1);pointer-events:none';
    container.appendChild(canvas);

    const scene = new Scene();
    const camera = new PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, settings.cameraZ);

    const world = new Group();
    world.position.set(settings.offset[0], settings.offset[1], 0);
    scene.add(world);
    const globe = new Group();
    world.add(globe);

    const R = 1.7;
    const dot = dotTexture();

    // Nodes and their links.
    const nodePositions = spherePoints(settings.nodes, R);
    const nodeGeometry = new BufferGeometry();
    nodeGeometry.setAttribute('position', new Float32BufferAttribute(nodePositions, 3));
    const nodeMaterial = new PointsMaterial({ size: settings.dot, map: dot, transparent: true, depthWrite: false, sizeAttenuation: true });
    globe.add(new Points(nodeGeometry, nodeMaterial));

    const linkGeometry = new BufferGeometry();
    linkGeometry.setAttribute('position', new Float32BufferAttribute(neighbourLinks(nodePositions, 3, 0.62), 3));
    const linkMaterial = new LineBasicMaterial({ transparent: true, depthWrite: false });
    globe.add(new LineSegments(linkGeometry, linkMaterial));

    // A faint shell and body give the globe volume.
    const shellMaterial = new LineBasicMaterial({ transparent: true, depthWrite: false });
    globe.add(new LineSegments(new EdgesGeometry(new IcosahedronGeometry(R * 1.002, 2)), shellMaterial));
    const coreMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false });
    globe.add(new Mesh(new SphereGeometry(R * 0.97, 48, 48), coreMaterial));

    // Hubs that pulse: a few nodes drawn larger in the highlight colour.
    const hubPositions: number[] = [];
    for (let i = 0; i < settings.nodes; i += Math.round(settings.nodes / 16)) hubPositions.push(nodePositions[i * 3]!, nodePositions[i * 3 + 1]!, nodePositions[i * 3 + 2]!);
    const hubGeometry = new BufferGeometry();
    hubGeometry.setAttribute('position', new Float32BufferAttribute(hubPositions, 3));
    const hubMaterial = new PointsMaterial({ size: settings.dot * 2.6, map: dot, transparent: true, depthWrite: false });
    globe.add(new Points(hubGeometry, hubMaterial));

    // Orbit rings, each carrying a satellite.
    const rings = [
      { radius: 2.25, tilt: [1.2, 0.3], speed: 0.45 },
      { radius: 2.6, tilt: [1.75, -0.6], speed: -0.3 },
      { radius: 2.05, tilt: [0.35, 1.1], speed: 0.6 },
    ].map(({ radius, tilt, speed }) => {
      const pivot = new Group();
      pivot.rotation.set(tilt[0]!, tilt[1]!, 0);
      const ringMaterial = new MeshBasicMaterial({ transparent: true, depthWrite: false });
      pivot.add(new Mesh(new TorusGeometry(radius, 0.0055, 8, 200), ringMaterial));
      const satelliteMaterial = new PointsMaterial({ size: settings.dot * 3.2, map: dot, transparent: true, depthWrite: false });
      const satelliteGeometry = new BufferGeometry();
      satelliteGeometry.setAttribute('position', new Float32BufferAttribute([radius, 0, 0], 3));
      const satellite = new Points(satelliteGeometry, satelliteMaterial);
      pivot.add(satellite);
      world.add(pivot);
      return { radius, speed, angle: Math.random() * Math.PI * 2, satellite, ringMaterial, satelliteMaterial };
    });

    // Slow particles drifting upward through the whole scene.
    const particleCount = settings.particles;
    const particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i += 1) {
      particlePositions[i * 3] = (Math.random() - 0.5) * 12;
      particlePositions[i * 3 + 1] = (Math.random() - 0.5) * 8;
      particlePositions[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1;
    }
    const particleGeometry = new BufferGeometry();
    particleGeometry.setAttribute('position', new Float32BufferAttribute(particlePositions, 3));
    const particleMaterial = new PointsMaterial({ size: 0.035, map: dot, transparent: true, depthWrite: false });
    scene.add(new Points(particleGeometry, particleMaterial));

    // Colours come from the theme tokens and follow light/dark switches.
    const recolor = () => {
      const dark = document.documentElement.getAttribute('data-theme') !== 'light';
      const primary = tokenColor('--ims-primary', '#38bdf8');
      const violet = tokenColor('--ims-violet', '#a78bfa');
      const accent = tokenColor('--ims-accent', '#60a5fa');
      const blending: Blending = dark ? AdditiveBlending : NormalBlending;
      const set = (m: PointsMaterial | LineBasicMaterial | MeshBasicMaterial, color: Color, opacity: number) => {
        m.color.copy(color);
        m.opacity = opacity;
        m.blending = blending;
        m.needsUpdate = true;
      };
      set(nodeMaterial, primary, dark ? 0.95 : 0.85);
      set(linkMaterial, primary, dark ? 0.22 : 0.3);
      set(shellMaterial, violet, dark ? 0.07 : 0.1);
      set(coreMaterial, primary, dark ? 0.035 : 0.05);
      set(hubMaterial, violet, 0.9);
      rings.forEach((ring, i) => {
        const color = i === 0 ? violet : i === 1 ? accent : primary;
        set(ring.ringMaterial, color, dark ? 0.35 : 0.45);
        set(ring.satelliteMaterial, color, 1);
      });
      set(particleMaterial, primary, dark ? 0.4 : 0.35);
    };
    recolor();

    const resize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();

    // Gentle parallax towards the pointer, anywhere on the page.
    const pointer = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };
    const onPointer = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };

    let frame = 0;
    let last = performance.now();
    let time = 0;
    let shown = false;
    const draw = () => {
      renderer.render(scene, camera);
      if (!shown) {
        shown = true;
        canvas.style.opacity = '1';
      }
    };
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      time += dt;
      globe.rotation.y += dt * 0.12;
      eased.x += (pointer.x - eased.x) * 0.04;
      eased.y += (pointer.y - eased.y) * 0.04;
      world.rotation.x = eased.y * 0.22;
      world.rotation.y = eased.x * 0.32;
      for (const ring of rings) {
        ring.angle += dt * ring.speed;
        ring.satellite.position.set(Math.cos(ring.angle) * ring.radius - ring.radius, Math.sin(ring.angle) * ring.radius, 0);
      }
      hubMaterial.opacity = 0.55 + 0.45 * Math.sin(time * 2.2);
      const attr = particleGeometry.getAttribute('position') as Float32BufferAttribute;
      for (let i = 0; i < particleCount; i += 1) {
        let y = attr.getY(i) + dt * (0.08 + (i % 7) * 0.012);
        if (y > 4) y = -4;
        attr.setY(i, y);
      }
      attr.needsUpdate = true;
      draw();
      frame = requestAnimationFrame(tick);
    };

    let visible = true;
    const start = () => {
      if (frame || reduceMotion || !visible || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const visibility = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) start();
      else stop();
    });
    visibility.observe(container);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pointermove', onPointer, { passive: true });
    const sizer = new ResizeObserver(() => {
      resize();
      if (!frame) draw();
    });
    sizer.observe(container);
    const themeWatcher = new MutationObserver(() => {
      recolor();
      if (!frame) draw();
    });
    themeWatcher.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    draw();
    start();

    return () => {
      stop();
      visibility.disconnect();
      sizer.disconnect();
      themeWatcher.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
      scene.traverse((object: Object3D) => {
        const mesh = object as Mesh;
        mesh.geometry?.dispose();
        const material = mesh.material as Material | Material[] | undefined;
        (Array.isArray(material) ? material : material ? [material] : []).forEach((m) => m.dispose());
      });
      dot.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
  }, [variant]);

  return <div ref={host} aria-hidden className={cn('pointer-events-none', className)} />;
}

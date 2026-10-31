type Point = [number, number, number];
type Side = -1 | 1;

function hash(x: number, z: number) {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function noise(x: number, z: number) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  return (
    (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) +
    (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v
  );
}

function fbm(x: number, z: number) {
  return (
    noise(x, z) * 0.58 +
    noise(x * 2.07, z * 2.07) * 0.28 +
    noise(x * 4.17, z * 4.17) * 0.14
  );
}

// The two shores share a fault line, not a silhouette or a mirrored height field.
export function riftSurfacePoint(side: Side, u: number, t: number): Point {
  const angle = (t - 0.5) * Math.PI;
  const taper = Math.max(0, Math.cos(angle));
  const z = Math.sin(angle) * (side === -1 ? 5.5 : 5.05) + side * 0.28;
  const shore =
    0.76 + Math.sin(z * 1.13) * 0.14 + Math.sin(z * 2.8 + 1) * 0.065;
  const width = (8.15 + (fbm(t * 5.3 + side * 13, 3.2) - 0.5) * 2.8) * taper;
  const x = side * (shore + u * width);
  const ridge = Math.pow(Math.sin(u * Math.PI), 1.6) * taper;
  const mountains = ridge * (0.35 + fbm(x * 0.65 + side * 19, z * 0.65) * 1.6);
  const y = 0.9 + (fbm(x * 0.9 + side * 7, z * 0.9) - 0.4) * 0.65 + mountains;
  return [x, y, z + Math.sin(u * Math.PI) * taper * taper * side * 0.38];
}

export function createRiftGeometry(side: Side) {
  const across = 58;
  const along = 50;
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const grid: Point[][] = [];

  function triangle(a: Point, b: Point, c: Point, cliff = false) {
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = ab[1] * ac[2] - ab[2] * ac[1];
    let ny = ab[2] * ac[0] - ab[0] * ac[2];
    let nz = ab[0] * ac[1] - ab[1] * ac[0];
    const length = Math.hypot(nx, ny, nz);
    if (length < 0.000001) return;
    nx /= length;
    ny /= length;
    nz /= length;
    const cx = (a[0] + b[0] + c[0]) / 3;
    const cy = (a[1] + b[1] + c[1]) / 3;
    const cz = (a[2] + b[2] + c[2]) / 3;
    const grain = hash(cx * 9.8, cz * 7.6 + cy);
    const value = cliff
      ? 0.065 + grain * 0.055 + Math.max(0, cy + 3) * 0.012
      : 0.145 + grain * 0.075;
    for (const point of [a, b, c]) {
      positions.push(...point);
      normals.push(nx, ny, nz);
      const mineral = !cliff && grain > 0.89 ? 0.035 : 0;
      colors.push(
        value + mineral,
        value + mineral + 0.006,
        value + mineral + (side === -1 ? 0.018 : 0.008),
      );
    }
  }

  for (let j = 0; j <= along; j++) {
    grid[j] = [];
    for (let i = 0; i <= across; i++)
      grid[j][i] = riftSurfacePoint(side, i / across, j / along);
  }
  for (let j = 0; j < along; j++) {
    for (let i = 0; i < across; i++) {
      const a = grid[j][i];
      const b = grid[j][i + 1];
      const c = grid[j + 1][i];
      const d = grid[j + 1][i + 1];
      if (side === -1) {
        triangle(a, b, c);
        triangle(b, d, c);
      } else {
        triangle(a, c, b);
        triangle(b, c, d);
      }
    }
  }

  // Coarser cliff rings make long, geological fractures rather than a smooth bowl.
  const boundary: Point[] = [];
  for (let j = 0; j <= along; j++) boundary.push(grid[j][0]);
  for (let j = along - 1; j > 0; j--) boundary.push(grid[j][across]);
  if (side === -1) boundary.reverse();
  let previous = boundary;
  const centerX = side * (side === -1 ? 3.7 : 4.4);
  for (let ring = 1; ring <= 4; ring++) {
    const next = boundary.map(([x, y, z], index): Point => {
      const irregular = hash(index * 1.7 + side * 8, ring * 3.1);
      const shrink =
        [0, 0.98, 0.85, 0.59, 0.24][ring] + (irregular - 0.5) * 0.13;
      return [
        centerX + (x - centerX) * shrink,
        y - ring * 1.24 - irregular * (ring === 4 ? 1.1 : 0.65),
        (z - side * 0.3) * shrink + side * ring * 0.13,
      ];
    });
    for (let j = 0; j < boundary.length; j++) {
      const k = (j + 1) % boundary.length;
      triangle(previous[j], next[j], previous[k], true);
      triangle(previous[k], next[j], next[k], true);
    }
    previous = next;
  }
  const tip: Point = [centerX + side * 0.5, -5.1, side * 0.6];
  for (let j = 0; j < previous.length; j++)
    triangle(previous[j], tip, previous[(j + 1) % previous.length], true);

  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
  };
}

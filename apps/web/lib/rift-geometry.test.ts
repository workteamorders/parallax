import { describe, expect, it } from "vitest";
import { createRiftGeometry, riftSurfacePoint } from "./rift-geometry";

describe("procedural rift terrain", () => {
  it.each([-1, 1] as const)(
    "builds finite, non-degenerate, outward-facing terrain for side %i",
    (side) => {
      const geometry = createRiftGeometry(side);
      expect(geometry.positions.length).toBeGreaterThan(40_000);
      expect(geometry.positions.length % 9).toBe(0);
      expect(geometry.normals.length).toBe(geometry.positions.length);
      expect(geometry.colors.length).toBe(geometry.positions.length);
      expect(geometry.positions.every(Number.isFinite)).toBe(true);
      expect(
        geometry.colors.every(
          (value) => Number.isFinite(value) && value >= 0 && value <= 1,
        ),
      ).toBe(true);
      for (let i = 0; i < geometry.normals.length; i += 3) {
        expect(Math.hypot(...geometry.normals.subarray(i, i + 3))).toBeCloseTo(
          1,
          5,
        );
      }
      // The first triangles are the upward-facing top, not the hanging skirt.
      expect(geometry.normals[1]).toBeGreaterThan(0);
    },
  );

  it("is deterministic without making the shores mirror images", () => {
    expect(createRiftGeometry(-1)).toEqual(createRiftGeometry(-1));
    expect(createRiftGeometry(-1).positions).not.toEqual(
      createRiftGeometry(1).positions,
    );
    for (let step = 0; step <= 50; step++) {
      const left = riftSurfacePoint(-1, 0, step / 50);
      const right = riftSurfacePoint(1, 0, step / 50);
      expect(left[0]).toBeLessThan(-0.5);
      expect(right[0]).toBeGreaterThan(0.5);
    }
  });
});

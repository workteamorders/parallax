export const usd = (value: number | null | undefined, compact = false) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: compact ? 1 : 2,
        notation: compact ? "compact" : "standard",
      }).format(value);
export const pct = (value: number | null | undefined, digits = 1) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${(value * 100).toFixed(digits)}%`;
export const signed = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? "—"
    : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
export const number = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
export const shortDate = (value: string | null) =>
  value
    ? new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "Not specified";
export const time = (value: string | number) =>
  new Date(typeof value === "number" ? value * 1000 : value).toLocaleTimeString(
    "en-GB",
    { hour: "2-digit", minute: "2-digit", timeZone: "UTC" },
  );

export function linePath(
  values: { ts: number; value: number }[],
  width = 700,
  height = 150,
  domain?: [number, number],
  range?: [number, number],
) {
  const valid = values.filter(
    (v) => Number.isFinite(v.ts) && Number.isFinite(v.value),
  );
  if (!valid.length) return "";
  const [minX, maxX] = domain ?? [
    Math.min(...valid.map((v) => v.ts)),
    Math.max(...valid.map((v) => v.ts)),
  ];
  const [minY, maxY] = range ?? [
    Math.min(...valid.map((v) => v.value)),
    Math.max(...valid.map((v) => v.value)),
  ];
  return valid
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${(
          16 +
          ((v.ts - minX) / (maxX - minX || 1)) * (width - 32)
        ).toFixed(2)},${(
          height -
          18 -
          ((v.value - minY) / (maxY - minY || 1)) * (height - 36)
        ).toFixed(2)}`,
    )
    .join(" ");
}

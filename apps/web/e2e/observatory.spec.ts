import { expect, test } from "@playwright/test";

test("Rift world renders actual WebGL and verified research on desktop and mobile", async ({
  page,
  request,
}, info) => {
  const terminal = await (await request.get("/api/terminal")).json();
  // UI rendering must survive natural contract expiry; seed coverage is a separate gate.
  expect(
    terminal.themes.filter(
      (t: { reviewStatus: string }) => t.reviewStatus === "approved",
    ).length,
  ).toBeGreaterThan(0);
  expect(terminal.perps.length).toBeGreaterThan(0);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /ONE EVENT/ })).toBeVisible();
  await expect(page.locator('.rift-scene[data-renderer="webgl"]')).toBeVisible({
    timeout: 20000,
  });
  await expect(page.locator(".rift-selection-title h2")).toBeVisible();
  await expect(page.locator(".rift-analysis .perp-line")).toBeVisible();
  await page.getByRole("button", { name: "7D", exact: true }).click();
  await expect(page.locator(".chart-time-axis").first()).toContainText(
    /[A-Z][a-z]{2} \d/,
  );
  await page.getByRole("button", { name: "24H", exact: true }).click();
  await expect(page.locator(".rift-analysis .perp-line")).toBeVisible();
  await expect(page.locator(".rift-event")).toHaveCount(6);
  await page.getByRole("button", { name: "Data table", exact: true }).click();
  await expect(page.locator(".theme-cell")).toHaveCount(8);
  await page
    .locator(".rift-view-toggle")
    .getByRole("button", { name: "Explore", exact: true })
    .click();
  await expect(page.locator(".rift-event")).toHaveCount(6);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  const frameBefore = Number(
    await page.locator(".rift-scene").getAttribute("data-frame"),
  );
  await page.getByRole("button", { name: "Pause world motion" }).click();
  await page.getByRole("button", { name: "Reset world view" }).click();
  await expect
    .poll(async () =>
      Number(await page.locator(".rift-scene").getAttribute("data-frame")),
    )
    .toBeGreaterThan(frameBefore);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await expect(
    page.locator('.rift-scene[data-renderer="webgl"]'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.locator(".rift-scene canvas").evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const gl = canvas.getContext("webgl2");
        if (!gl) return 0;
        const pixels = new Uint8Array(canvas.width * canvas.height * 4);
        gl.readPixels(
          0,
          0,
          canvas.width,
          canvas.height,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          pixels,
        );
        let visible = 0;
        for (let i = 3; i < pixels.length; i += 4)
          if (pixels[i] > 10) visible++;
        return visible;
      }),
    )
    .toBeGreaterThan(1000);
  await page.screenshot({
    path: `test-results/overview-${info.project.name}.png`,
    fullPage: true,
  });
  await page
    .locator(".rift-world")
    .screenshot({ path: `test-results/rift-world-${info.project.name}.png` });
});

test("real event selection, world perspectives and watchlist filtering work", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Next event", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".rift-selection-title h2")).toBeVisible();
  const original = await page.locator(".rift-selection-title h2").innerText();
  await page.getByRole("button", { name: "Next event", exact: true }).click();
  await expect(page.locator(".rift-selection-title h2")).not.toHaveText(
    original,
  );
  await page.locator(".rift-world").focus();
  await page.locator(".rift-world").press("ArrowLeft");
  await expect(page.locator(".rift-selection-title h2")).toHaveText(original);
  await page.getByRole("button", { name: "Focus event perspective" }).click();
  await expect(
    page.getByRole("button", { name: "Focus event perspective" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Reset world view" }).click();
  await expect(
    page.getByRole("button", { name: "Focus event perspective" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Pause world motion" }).click();
  await expect(
    page.getByRole("button", { name: "Resume world motion" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .locator(".rift-event-filters")
    .getByRole("button", { name: "Watchlist", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your watchlist is quiet." }),
  ).toBeVisible();
  await page
    .locator(".rift-event-filters")
    .getByRole("button", { name: /All reviewed/ })
    .click();
  await page
    .getByRole("combobox", { name: "Filter atlas by linked asset" })
    .selectOption("SOL-PERP");
  const selected = await page.locator(".rift-event h3").first().innerText();
  await page.locator(".rift-event-select").first().click();
  await expect(page.locator(".rift-selection-title h2")).toHaveText(selected);
  await expect(page.locator(".rift-event").first()).toHaveClass(/selected/);
});

test("market search and real theme investigation retain clear execution limits", async ({
  page,
}, info) => {
  await page.goto("/markets");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await page.getByRole("textbox", { name: "Search themes" }).fill("Solana");
  await expect(page.locator("tbody tr").first()).toContainText("Solana");
  await page
    .getByRole("combobox", { name: "Filter by linked asset" })
    .selectOption("SOL-PERP");
  await page.locator(".theme-cell a").first().click();
  await expect(page.locator(".theme-heading h1")).toBeVisible();
  await expect(page.locator(".rules-text")).toContainText("Binance");
  await expect(page.getByText("No reviewed equivalent")).toBeVisible();
  await expect(page.getByText("Execution is locked.")).toBeVisible();
  await expect(page.locator(".perp-line")).toBeVisible();
  await page.locator(".trade-input input").first().fill("1");
  await page.getByRole("button", { name: "Inspect Reference" }).click();
  await expect(
    page.getByText("This is not an executable quote.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement)?.blur();
    window.scrollTo({ top: 0, behavior: "instant" });
  });
  await page.screenshot({
    path: `test-results/theme-${info.project.name}.png`,
    fullPage: true,
  });
});

test("signals, portfolio, alerts and legal states remain honest", async ({
  page,
}) => {
  await page.goto("/signals");
  await expect(
    page.getByRole("heading", { name: "When markets disagree." }),
  ).toBeVisible();
  await expect(page.locator(".signals-layout > .panel").first()).toContainText(
    /Nothing forced|ODDS_LEAD|PERP_LEAD/,
  );
  await page.goto("/portfolio");
  await expect(
    page.getByRole("heading", { name: "Your wallet is the starting point." }),
  ).toBeVisible();
  await page.goto("/alerts");
  await expect(page.getByText("Telegram is not connected")).toBeVisible();
  await page.goto("/legal/risk");
  await expect(
    page.getByRole("heading", { name: "Risk Disclosure", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("DRAFT · PENDING LEGAL REVIEW")).toBeVisible();
});

test("wallet dialog is dismissible without signing or transaction permissions", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect Wallet", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByText("A sign-in signature never authorizes a trade.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

test("API outage retains the artwork but never substitutes financial data", async ({
  page,
}) => {
  await page.route("**/api/terminal", (route) =>
    route.fulfill({ status: 503, json: { error: "Unavailable" } }),
  );
  await page.goto("/");
  await expect(page.locator(".error-banner[role=alert]")).toContainText(
    "data connection is unavailable",
  );
  await expect(page.getByRole("heading", { name: /ONE EVENT/ })).toBeVisible();
  await expect(page.locator(".rift-event")).toHaveCount(0);
  await expect(page.locator(".rift-realm-event strong")).toHaveText("—");
});

test("navigation works without hover and closes after selection", async ({
  page,
}) => {
  await page.goto("/");
  if ((page.viewportSize()?.width ?? 1000) <= 760)
    await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: /Markets/i })
    .click();
  await expect(page).toHaveURL("/markets");
  await expect(page.locator(".page-heading h1")).toContainText("Every market.");
  if ((page.viewportSize()?.width ?? 1000) <= 760)
    await expect(
      page.getByRole("button", { name: "Toggle navigation" }),
    ).toHaveAttribute("aria-expanded", "false");
});

test("reduced-motion and a narrow viewport keep controls usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Next event", exact: true }),
  ).toBeEnabled();
  await expect(
    page.locator('.rift-scene[data-motion="reduced"]'),
  ).toBeVisible();
  await expect(page.locator(".rift-selection-title h2")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const title = await page.locator(".rift-selection-title h2").innerText();
  await page.locator(".rift-world").focus();
  await page.locator(".rift-world").press("ArrowRight");
  await expect(page.locator(".rift-selection-title h2")).not.toHaveText(title);
});

test("WebGL-unavailable devices retain the illustrated world and research controls", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value: function (
        this: HTMLCanvasElement,
        type: string,
        ...args: unknown[]
      ) {
        if (
          type === "webgl2" ||
          type === "webgl" ||
          type === "experimental-webgl"
        )
          return null;
        return Reflect.apply(original, this, [type, ...args]);
      },
    });
  });
  await page.goto("/");
  await expect(
    page.locator('.rift-scene[data-renderer="fallback"]'),
  ).toBeVisible();
  await expect(page.locator(".rift-scene-fallback")).toBeVisible();
  await expect(page.locator(".rift-selection-title h2")).toBeVisible();
  await page
    .getByRole("button", { name: "Focus perpetual perspective" })
    .click();
  await expect(
    page.getByRole("button", { name: "Focus perpetual perspective" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: `test-results/rift-fallback-${info.project.name}.png`,
  });
});

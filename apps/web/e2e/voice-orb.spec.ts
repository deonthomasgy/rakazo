import { expect, test } from "@playwright/test";
import { captureScreenshot } from "./helpers";

test("voice avatar responds to volume and call states", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/e2e/fixtures/voice-orb.html");
  const orb = page.locator(".rakazo-voice-orb");
  await expect(orb).toHaveAttribute("data-voice-mode", "input");
  await expect
    .poll(() => orb.evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(0);
  const bodyPixels = () =>
    orb.evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! >= 230) count++;
      return count;
    });
  const quiet = await bodyPixels();
  await page.getByLabel("Volume").fill("0.9");
  await expect.poll(bodyPixels).toBeGreaterThan(quiet * 1.2);
  await captureScreenshot(page, testInfo, "voice-orb-listening");
  await page.getByRole("button", { name: "output", exact: true }).click();
  await expect(orb).toHaveAttribute("data-voice-mode", "output");
  await page.waitForTimeout(450);
  await captureScreenshot(page, testInfo, "voice-orb-speaking");
  await page.getByRole("button", { name: "muted", exact: true }).click();
  await expect(orb).toHaveAttribute("data-voice-mode", "muted");
  await expect.poll(bodyPixels).toBeLessThan(quiet * 1.05);
  expect(errors).toEqual([]);
});

test("reduced motion stays still while the audio level changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/e2e/fixtures/voice-orb.html");
  const orb = page.locator(".rakazo-voice-orb");
  const image = () => orb.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
  await expect
    .poll(() => orb.evaluate((canvas: HTMLCanvasElement) => canvas.width))
    .toBeGreaterThan(0);
  const first = await image();
  await page.getByLabel("Volume").fill("0.9");
  await page.waitForTimeout(250);
  expect(await image()).toBe(first);
});

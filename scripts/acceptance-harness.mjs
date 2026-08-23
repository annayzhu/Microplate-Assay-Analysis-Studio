import { chromium } from "playwright";
import { resolve } from "node:path";

export async function openAcceptanceBrowser(options = {}) {
  const launchOptions = { headless: true };
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({
    viewport: options.viewport ?? { width: 1440, height: 1100 },
    deviceScaleFactor: options.deviceScaleFactor ?? 1,
  });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  return { browser, page, consoleErrors };
}

export function manualPlateMatrix(plateName, offset, divisor = 1_000) {
  const rows = Array.from({ length: 8 }, (_, rowIndex) => {
    const values = Array.from({ length: 12 }, (_, columnIndex) => (offset + (rowIndex * 12 + columnIndex + 1) / divisor).toFixed(3));
    return `${String.fromCharCode(65 + rowIndex)}\t${values.join("\t")}`;
  });
  return [plateName, `吸光值\t${Array.from({ length: 12 }, (_, index) => index + 1).join("\t")}`, ...rows].join("\n");
}

export function assertSignals(text, signals, scenario) {
  for (const signal of signals) {
    if (!text.includes(signal)) throw new Error(`${scenario} is missing expected signal: ${signal}`);
  }
}

export async function dragBetweenWells(page, startWell, endWell, options = {}) {
  const start = await page.locator(`[data-well="${startWell}"]`).boundingBox();
  const end = await page.locator(`[data-well="${endWell}"]`).boundingBox();
  if (!start || !end) throw new Error(`Could not locate drag endpoints ${startWell} → ${endWell}`);
  if (options.additive) await page.keyboard.down(process.platform === "darwin" ? "Meta" : "Control");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
  if (options.screenshotPath) {
    await page.locator(".plate-selection-box").waitFor();
    await page.screenshot({ path: resolve(options.screenshotPath), fullPage: false });
  }
  await page.mouse.up();
  if (options.additive) await page.keyboard.up(process.platform === "darwin" ? "Meta" : "Control");
}

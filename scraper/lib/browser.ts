/**
 * Playwright 浏览器实例管理（动态页面爬取）
 * 复用单一 browser，按需创建独立 context（隔离 cookie）
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { randomUA } from './http';
import { log } from './logger';

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  log.info('browser', 'launching chromium...');
  _browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-dev-shm-usage',
    ],
  });
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
    log.info('browser', 'closed');
  }
}

/**
 * 创建一个隔离的浏览器上下文 + 反检测设置
 */
export async function newContext(): Promise<BrowserContext> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    userAgent: randomUA(),
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    // 屏蔽 webdriver 标记
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  // 注入反检测脚本
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // @ts-ignore
    window.chrome = { runtime: {} };
  });
  return ctx;
}

/**
 * 带超时的页面加载（goto 包装）
 * 默认等到 networkidle，便于动态站点采集
 */
export async function gotoSafe(
  page: Page,
  url: string,
  opts: { timeoutMs?: number; waitUntil?: 'load' | 'networkidle' | 'domcontentloaded' } = {}
) {
  const { timeoutMs = 45000, waitUntil = 'networkidle' } = opts;
  try {
    await page.goto(url, { waitUntil, timeout: timeoutMs });
  } catch (err) {
    log.warn('browser', `gotoSafe degrade to domcontentloaded for ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  }
}
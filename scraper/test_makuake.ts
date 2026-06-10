import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import fs from 'fs/promises';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto('https://www.makuake.com/discover/tags/8', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // 获取页面HTML
  const html = await page.content();
  await fs.writeFile('scraper/test_makuake_rendered.html', html);

  // 查找项目卡片
  const cards = await page.evaluate(() => {
    const results: any[] = [];
    const elements = document.querySelectorAll('a[href*="/project/"]');
    for (const el of Array.from(elements).slice(0, 5)) {
      const text = el.textContent?.trim() || '';
      const href = (el as HTMLAnchorElement).href;
      results.push({ text: text.slice(0, 200), href });
    }
    return results;
  });

  console.log('Found cards:', cards.length);
  for (const card of cards) {
    console.log('---');
    console.log('Text:', card.text);
    console.log('Href:', card.href);
  }

  await browser.close();
}

main().catch(console.error);
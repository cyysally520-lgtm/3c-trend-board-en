/**
 * 临时工具脚本：嗅探 YC 目录页用的 Algolia 真实查询 body
 * 用法: npx tsx scraper/sniff-yc.ts
 */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const algoliaRequests: { url: string; headers: Record<string, string>; body: string }[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('algolia.net') && req.method() === 'POST') {
      algoliaRequests.push({
        url,
        headers: req.headers(),
        body: req.postData() || '',
      });
    }
  });

  console.log('opening YC companies page...');
  await page.goto('https://www.ycombinator.com/companies?industry=Consumer+Electronics', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });

  console.log(`\nFound ${algoliaRequests.length} POST Algolia requests:`);
  for (const r of algoliaRequests.slice(0, 3)) {
    console.log('URL:', r.url);
    console.log('App-Id:', r.headers['x-algolia-application-id']);
    console.log('API-Key:', r.headers['x-algolia-api-key']);
    console.log('BODY:', r.body.slice(0, 1000));
    console.log('---');
  }

  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
/**
 * Makuake 调试 - Playwright 方式 v2
 */
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

async function main() {
  chromium.use(stealth());
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'ja-JP' });
  const page = await ctx.newPage();

  // 尝试 Makuake 的搜索/发现页面
  const urls = [
    'https://www.makuake.com/discover/tags/8?coming_soon=false&ongoing=true&in_store=false&sort=popular',
    'https://www.makuake.com/discover/ongoing/?sort=popular',
    'https://www.makuake.com/',
  ];

  for (const url of urls) {
    console.log(`\n=== Trying: ${url} ===`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(8000);
      
      // Scroll
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy(0, 800));
        await page.waitForTimeout(1500);
      }

      const result = await page.evaluate(() => {
        const allLinks = Array.from(document.querySelectorAll('a'));
        const projectLinks = allLinks.filter(a => a.href && a.href.includes('/project/'));
        
        // Also try other patterns
        const productLinks = allLinks.filter(a => a.href && (a.href.includes('/product/') || a.href.includes('/view/')));
        
        return {
          totalLinks: allLinks.length,
          projectLinks: projectLinks.length,
          productLinks: productLinks.length,
          sampleProjectHrefs: projectLinks.slice(0, 10).map(a => a.href),
          sampleProjectTexts: projectLinks.slice(0, 10).map(a => a.textContent?.trim()?.slice(0, 80)),
          // Check for any card-like structures
          allHrefs: allLinks.slice(0, 30).map(a => a.href).filter(h => h.includes('makuake')),
          bodyText: document.body?.innerText?.slice(0, 1000) || '',
        };
      });

      console.log('Total links:', result.totalLinks);
      console.log('Project links:', result.projectLinks);
      console.log('Product links:', result.productLinks);
      if (result.sampleProjectHrefs.length > 0) {
        console.log('Sample project hrefs:', result.sampleProjectHrefs);
        console.log('Sample project texts:', result.sampleProjectTexts);
      }
      console.log('Makuake hrefs:', result.allHrefs);
      console.log('Body text (first 500):', result.bodyText.slice(0, 500));
    } catch (e: any) {
      console.log('Error:', e.message?.slice(0, 200));
    }
  }

  await browser.close();
}

main().catch(console.error);
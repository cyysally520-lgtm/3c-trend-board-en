import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://www.makuake.com/discover/tags/8', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3000);

  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);
  }

  const projects = await page.evaluate(() => {
    const items: any[] = [];
    const links = document.querySelectorAll('a[href*="/project/"]');
    links.forEach(link => {
      const href = (link as HTMLAnchorElement).href;
      const img = link.querySelector('img');
      const imgSrc = img ? (img as HTMLImageElement).src : '';
      const text = link.textContent?.trim() || '';
      items.push({ href, imgSrc, text: text.substring(0, 80) });
    });
    return items;
  });

  console.log('Found projects:', projects.length);
  projects.slice(0, 20).forEach((p, i) => {
    console.log(`${i + 1}. ${p.text}`);
    console.log(`   Image: ${p.imgSrc}`);
    console.log(`   URL: ${p.href}`);
  });

  await browser.close();
})();
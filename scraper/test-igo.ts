/**
 * Indiegogo 调试脚本 - 分析卡片结构 v2
 */
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';

async function main() {
  chromium.use(stealth());
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ locale: 'en-US' });
  const page = await ctx.newPage();

  const url = 'https://www.indiegogo.com/explore/technology?project_type=all&project_timing=all&sort=trending';
  console.log('Loading:', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, 1200));
    await page.waitForTimeout(2500);
  }

  // Extract data from cards using page.evaluate
  const result = await page.evaluate(() => {
    // Find all gfu-card elements that look like project cards
    const cards = document.querySelectorAll('.gfu-card');
    const items: any[] = [];
    
    for (const card of cards) {
      const links = Array.from(card.querySelectorAll('a'));
      const igoLink = links.find(a => a.href && a.href.includes('indiegogo.com') && a.href.includes('/projects/'));
      const gfLink = links.find(a => a.href && a.href.includes('gamefound.com'));
      const mainLink = igoLink || gfLink || links[0];
      
      if (!mainLink) continue;
      
      const href = mainLink.href;
      const isIGO = href.includes('indiegogo.com');
      const isGF = href.includes('gamefound.com');
      
      // Extract text segments from the card
      const allText = card.textContent?.trim() || '';
      
      // Image
      const img = card.querySelector('img');
      const imgSrc = img ? (img as HTMLImageElement).src : '';
      
      // Try to get structured data from the card
      // Look for the title link
      const titleLink = links.find(a => {
        const t = a.textContent?.trim() || '';
        return t.length > 5 && !/^\d/.test(t) && !t.includes('backers') && !t.includes('funded');
      });
      const name = titleLink?.textContent?.trim() || '';
      
      items.push({
        href,
        isIGO,
        isGF,
        name,
        imgSrc: imgSrc?.slice(0, 100),
        allText: allText.slice(0, 400),
      });
    }
    
    return {
      totalCards: cards.length,
      igoCards: items.filter(i => i.isIGO).length,
      gfCards: items.filter(i => i.isGF).length,
      items: items.slice(0, 15),
    };
  });

  console.log('\n=== Card Analysis ===');
  console.log('Total cards:', result.totalCards);
  console.log('Indiegogo cards:', result.igoCards);
  console.log('Gamefound cards:', result.gfCards);
  
  for (const item of result.items) {
    console.log('\n--- Item ---');
    console.log('Type:', item.isIGO ? 'IGO' : item.isGF ? 'GF' : 'OTHER');
    console.log('Name:', item.name);
    console.log('Href:', item.href?.slice(0, 100));
    console.log('Img:', item.imgSrc);
    console.log('Text:', item.allText);
  }

  await browser.close();
}

main().catch(console.error);
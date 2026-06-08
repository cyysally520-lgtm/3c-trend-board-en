import { newContext, gotoSafe } from './lib/browser';
import * as cheerio from 'cheerio';

async function main() {
  const ctx = await newContext();
  const page = await ctx.newPage();
  
  console.log('Loading Indiegogo...');
  await gotoSafe(page, 'https://www.indiegogo.com/explore/technology?project_type=all&project_timing=all&sort=trending', { timeoutMs: 60000 });
  
  // Scroll to load more
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 1000));
    await page.waitForTimeout(2000);
  }
  
  const html = await page.content();
  console.log('HTML length:', html.length);
  
  const $ = cheerio.load(html);
  
  // Debug: find all links with /projects/
  const projectLinks = $('a[href*="/projects/"]').toArray();
  console.log('Links with /projects/:', projectLinks.length);
  
  // Debug: find all elements with common card patterns
  const allDivs = $('div').toArray();
  console.log('Total divs:', allDivs.length);
  
  // Look for data attributes
  const dataAttrs = $('[data-testid]').toArray();
  console.log('Elements with data-testid:', dataAttrs.length);
  dataAttrs.slice(0, 10).forEach(el => {
    console.log('  testid:', $(el).attr('data-testid'), 'tag:', el.tagName);
  });
  
  // Try to find project cards by looking at href patterns
  const allLinks = $('a[href]').toArray();
  const projectHrefs = allLinks.filter(a => {
    const href = $(a).attr('href') || '';
    return href.includes('/projects/');
  });
  console.log('Project hrefs found:', projectHrefs.length);
  projectHrefs.slice(0, 5).forEach(a => {
    console.log('  href:', $(a).attr('href'), 'text:', $(a).text().slice(0, 50));
  });
  
  await page.close();
  await ctx.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
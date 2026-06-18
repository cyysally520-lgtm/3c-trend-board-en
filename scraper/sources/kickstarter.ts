/**
 * Kickstarter 爬虫
 * 入口：https://www.kickstarter.com/discover/advanced?category_id=16&sort=popular
 * 策略：Playwright 动态渲染 + data-project JSON 提取（主要）+ cheerio DOM 解析（回退）
 * 分类：Technology (id=16)
 * 
 * 关键发现：KS 列表页的 .js-react-proj-card[data-project] 属性包含完整项目 JSON，
 * 包含 pledged、backers_count、percent_funded、creator、location 等所有需要的字段。
 * Cloudflare 会间歇性拦截，需要等待验证通过后提取。
 */
import * as cheerio from 'cheerio';
import { newContext, gotoSafe, waitForCloudflare } from '../lib/browser';
import { log } from '../lib/logger';
import type { RawCrowdfundingItem, ScrapeResult } from '../lib/types';

const DISCOVER_URL = 'https://www.kickstarter.com/discover/advanced?category_id=16&sort=popular&seed=2846981&page=1';

interface KSProject {
  id: number;
  name: string;
  slug: string;
  blurb: string;
  goal: { amount: number; currency: string; currency_symbol: string } | number;
  pledged: { amount: number; currency: string; currency_symbol: string } | number;
  backers_count: number;
  percent_funded: number;
  currency: string;
  currency_symbol?: string;
  deadline: number;
  launched_at: number;
  state: string;
  creator?: { id: number; name: string; slug: string };
  location?: { id: number; name: string; displayable_name: string; country: string };
  category?: { id: number; name: string; slug: string; parent_id?: number };
  photo?: { key: string; full: string; ed: string; med: string; little: string; small: string; thumb: string };
  urls?: { web?: { project: string }; api?: { project: string } };
}

export async function scrapeKickstarter(maxItems = 30): Promise<ScrapeResult<RawCrowdfundingItem>> {
  const t0 = Date.now();
  const result: ScrapeResult<RawCrowdfundingItem> = {
    source: 'Kickstarter',
    ok: false,
    items: [],
    errors: [],
    durationMs: 0,
  };

  const ctx = await newContext();
  const page = await ctx.newPage();

  try {
    log.info('kickstarter', `loading: ${DISCOVER_URL}`);
    await gotoSafe(page, DISCOVER_URL, { timeoutMs: 45000, waitUntil: 'load' });

    let cloudflareOk = await waitForCloudflare(page);
    if (!cloudflareOk) {
      log.warn('kickstarter', 'Cloudflare challenge not passed, retrying with page reload...');
      await page.reload({ waitUntil: 'load', timeout: 45000 }).catch(() => {});
      cloudflareOk = await waitForCloudflare(page, 30);
    }
    if (!cloudflareOk) {
      log.warn('kickstarter', 'Cloudflare challenge did not pass after retry, attempting anyway');
    }

    await page.waitForSelector('.js-react-proj-card', { timeout: 30000 }).catch(() => {
      log.warn('kickstarter', 'project card selector timeout, trying anyway');
    });
    await page.waitForTimeout(3000);

    // ===== 策略 1：从 data-project 属性提取完整 JSON =====
    const jsonItems = await extractFromDataProject(page, maxItems);
    if (jsonItems.length > 0) {
      log.ok('kickstarter', `extracted ${jsonItems.length} items from data-project JSON`);
      // 从详情页抓取起步价
      await scrapePricesFromDetailPages(jsonItems, ctx);
      result.items = jsonItems;
      result.ok = true;
      result.durationMs = Date.now() - t0;
      await page.close();
      await ctx.close();
      return result;
    }

    // ===== 策略 2：cheerio DOM 解析（回退） =====
    log.info('kickstarter', 'data-project JSON extraction failed, falling back to DOM parsing');
    const html = await page.content();
    const $ = cheerio.load(html);
    const cards = $('[data-testid="project-card"], .js-react-proj-card, div[class*="project-card"], a[class*="project_"]').toArray();
    log.info('kickstarter', `found ${cards.length} project cards via DOM`);
    const seenIds = new Set<string>();
    let extracted = 0;

    for (const el of cards) {
      if (extracted >= maxItems) break;
      try {
        const $card = $(el);
        const href = $card.find('a[href*="/projects/"]').first().attr('href') || $card.attr('href') || '';
        const campaignUrl = href.startsWith('http') ? href : `https://www.kickstarter.com${href}`;
        if (!href || seenIds.has(campaignUrl)) continue;
        const name = $card.find('h3, [class*="title"], [class*="project-title"]').first().text().trim()
          || $card.find('a[href*="/projects/"]').first().text().trim();
        if (!name) continue;
        const imgSrc = $card.find('img').first().attr('src') || '';
        const image = imgSrc.startsWith('//') ? 'https:' + imgSrc
          : imgSrc.startsWith('/') ? 'https://www.kickstarter.com' + imgSrc : imgSrc;
        const blurb = $card.find('p[class*="blurb"], [class*="description"], p').first().text().trim();
        const pledgedText = $card.find('[class*="pledged"], [class*="amount"]').text();
        const pledgedMatch = pledgedText.match(/[\$€£¥]?([\d,]+\.?\d*)/);
        const raised = pledgedMatch ? parseFloat(pledgedMatch[1].replace(/,/g, '')) : 0;
        const backersText = $card.find('[class*="backer"], [class*="supporter"]').text();
        const backersMatch = backersText.match(/([\d,]+)/);
        const backers = backersMatch ? parseInt(backersMatch[1].replace(/,/g, ''), 10) : 0;
        const pctText = $card.find('[class*="percent"], [class*="progress"], [class*="funded"]').text();
        const pctMatch = pctText.match(/(\d+)%/);
        const progress_pct = pctMatch ? parseInt(pctMatch[1], 10) : (raised > 0 ? 100 : 0);
        const founder = $card.find('[class*="creator"], [class*="author"], [class*="by"]').text().trim().replace(/^by\s+/i, '') || 'Unknown';
        const location = $card.find('[class*="location"]').text().trim() || 'Unknown';
        // slug：去 query string 再用，否则会变成 "creator-slug?ref=..." 跟主路径产生 id 冲突 → 重复卡片
        const cleanHref = href.split('?')[0].split('#')[0];
        const slug = cleanHref.split('/projects/')[1]?.replace(/\/+$/, '').replace(/\//g, '-') || name.toLowerCase().replace(/\s+/g, '-');
        seenIds.add(campaignUrl);
        result.items.push({
          id: `ks-${slug}`, platform: 'Kickstarter', image, name, name_zh: name,
          founder, location, raised, currency: 'USD', currencySymbol: '$',
          progress_pct, backers, price: '', campaign_url: campaignUrl,
          category_tag_zh: '#科技', summary_zh: blurb ? [blurb.slice(0, 200)] : [],
          scrapedAt: new Date().toISOString(),
        });
        extracted++;
      } catch (err) {
        result.errors.push(`card parse: ${err instanceof Error ? err.message : err}`);
      }
    }
    result.ok = result.items.length > 0;
    log.ok('kickstarter', `extracted ${result.items.length} items via DOM fallback`);
  } catch (err) {
    log.err('kickstarter', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await page.close();
    await ctx.close();
  }
  result.durationMs = Date.now() - t0;
  return result;
}

async function extractFromDataProject(page: import('playwright').Page, maxItems: number): Promise<RawCrowdfundingItem[]> {
  const rawItems = await page.evaluate((max) => {
    const cards = document.querySelectorAll('.js-react-proj-card[data-project]');
    const items: any[] = [];
    for (let i = 0; i < Math.min(max, cards.length); i++) {
      const card = cards[i];
      const rawJson = card.getAttribute('data-project');
      if (!rawJson) continue;
      try {
        const p = JSON.parse(rawJson);
        // 关键修复：KS 列表 JSON 里 `p.currency` 是项目**原始币种**（如 SGD/USD/EUR）
        // `p.pledged` 字段：
        //   - 数字 → 原币种已筹金额（例如 5,919,596 SGD）
        //   - 对象 → 按访客 IP 折算后的（`{amount, currency, currency_symbol}`，amount 是 USD/欧元等折算值）
        // 想显示"原网址数字"必须用顶层 p.currency + 反算原币金额：
        //   原币金额 = p.usd_pledged / p.static_usd_rate（如 SGD = USD / 0.78）
        // 优先 p.usd_pledged + p.static_usd_rate 反算；失败再退到 pledged.amount
        const projectCurrency = p.currency || 'USD';                     // 原币种代码
        // currency_symbol 修正：KS API 给的 "$" 不区分 USD/HKD/SGD/CAD/AUD/MXN 等
        // 按 currency 字符串映射成专用前缀符号（HKD → HK$）
        const symbolMap: Record<string, string> = {
          USD: '$',
          HKD: 'HK$',
          SGD: 'S$',
          CAD: 'CA$',
          AUD: 'A$',
          NZD: 'NZ$',
          MXN: 'MX$',
          EUR: '€',
          GBP: '£',
          JPY: '¥',
          CNY: '¥',
        };
        const projectSymbol = symbolMap[projectCurrency] || p.currency_symbol || '$';

        let pledgedAmount: number;
        if (typeof p.usd_pledged === 'number' && typeof p.static_usd_rate === 'number' && p.static_usd_rate > 0) {
          // 反算原币 = USD 总额 / 汇率（static_usd_rate = "1 项目币 = X USD"）
          pledgedAmount = Math.round(p.usd_pledged / p.static_usd_rate);
        } else if (typeof p.pledged === 'number') {
          // p.pledged 是数字 = 原币种值，直接用
          pledgedAmount = p.pledged;
        } else if (p.pledged?.amount !== undefined && p.pledged?.currency === projectCurrency) {
          // pledged 对象的 currency 跟项目原币相同 → 也是原币值
          pledgedAmount = p.pledged.amount;
        } else if (p.pledged?.amount !== undefined) {
          // 兜底：用 pledged 对象（虽然可能是折算后）
          pledgedAmount = p.pledged.amount;
        } else {
          pledgedAmount = 0;
        }

        const pledgedCurrency = projectCurrency;
        const pledgedSymbol = projectSymbol;
        const goalAmount = typeof p.goal === 'object' ? p.goal.amount : p.goal;
        const rawPct = p.percent_funded || (goalAmount && goalAmount > 0 ? (pledgedAmount / goalAmount) * 100 : 0);
        // 剩余天数：deadline 是 unix 秒。用 floor 取真实剩余整天数（22.x → 22）
        let daysLeft = 0;
        if (typeof p.deadline === 'number' && p.deadline > 0) {
          const diffSec = p.deadline - Math.floor(Date.now() / 1000);
          daysLeft = Math.max(0, Math.floor(diffSec / 86400));
        }
        // 起始价格：尝试从 KS list JSON 提取最低 reward 价
        // p.reward 字段在 list payload 里通常不存在；只有从 DOM 上 .ksr-card__data 等元素抓的卡片有
        // 所以这里如果 p.minimum_pledge_amount / p.lowest_reward_amount 存在就用，否则空
        let priceStr = '';
        const minRaw = p.minimum_pledge_amount ?? p.lowest_reward_amount ?? p.minimum_pledge ?? null;
        if (typeof minRaw === 'number' && minRaw > 0) {
          priceStr = pledgedSymbol + Math.round(minRaw).toLocaleString();
        }
        items.push({
          slug: p.slug || p.id, name: p.name, blurb: p.blurb,
          campaignUrl: p.urls?.web?.project || 'https://www.kickstarter.com/projects/' + (p.creator?.slug || '') + '/' + p.slug,
          image: p.photo?.ed || p.photo?.full || p.photo?.med || '',
          pledgedAmount, pledgedCurrency, pledgedSymbol, goalAmount,
          progressPct: Math.round(rawPct), backers: p.backers_count || 0,
          daysLeft,
          price: priceStr,
          founder: p.creator?.name || 'Unknown',
          rawLocation: p.location?.displayable_name || p.location?.name || 'Unknown',
          locationCountry: p.location?.country || '', catSlug: p.category?.slug || '',
        });
      } catch (e) { /* skip */ }
    }
    return items;
  }, maxItems);

  return rawItems.map(r => ({
    id: 'ks-' + r.slug, platform: 'Kickstarter', image: r.image, name: r.name, name_zh: r.name,
    founder: r.founder, location: simplifyLocation(r.rawLocation, r.locationCountry),
    raised: r.pledgedAmount || 0, currency: r.pledgedCurrency || 'USD', currencySymbol: r.pledgedSymbol || '$',
    progress_pct: r.progressPct, backers: r.backers, price: r.price || '', campaign_url: r.campaignUrl,
    daysLeft: r.daysLeft,
    category_tag_zh: r.catSlug.includes('tech') || r.catSlug.includes('hardware') ? '#科技' : r.catSlug.includes('design') || r.catSlug.includes('product') ? '#设计' : '#科技',
    summary_zh: r.blurb ? [r.blurb.slice(0, 200)] : [], scrapedAt: new Date().toISOString(),
  }));
}

function simplifyLocation(displayName: string, country: string): string {
  if (!displayName || displayName === 'Unknown') return 'Unknown';
  const parts = displayName.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length <= 1) return displayName;
  const city = parts[0];
  const lastPart = parts[parts.length - 1];
  if (/^[A-Z]{2}$/.test(lastPart)) {
    const countryName = country === 'US' ? 'USA' : country;
    return countryName ? city + ', ' + countryName : city + ', USA';
  }
  if (lastPart.length > 2) return city + ', ' + lastPart;
  if (country) { const cn = country === 'US' ? 'USA' : country; return city + ', ' + cn; }
  return displayName;
}

async function scrapePricesFromDetailPages(items: RawCrowdfundingItem[], ctx: import('playwright').BrowserContext): Promise<void> {
  const itemsNeedingPrice = items.filter(it => !it.price);
  if (itemsNeedingPrice.length === 0) return;
  log.info('kickstarter', 'scraping prices from ' + itemsNeedingPrice.length + ' detail pages...');
  const detailPage = await ctx.newPage();
  let fetched = 0;
  try {
    for (const item of itemsNeedingPrice) {
      try {
        const url = item.campaign_url;
        if (!url) continue;
        log.info('kickstarter', 'fetching price: ' + item.name.slice(0, 40) + '...');
        await gotoSafe(detailPage, url, { timeoutMs: 30000, waitUntil: 'domcontentloaded' });
        await detailPage.waitForTimeout(2000);
        const price = await detailPage.evaluate(() => {
          const allText = document.body?.innerText || '';
          let minPrice = Infinity;
          const pledgeMatches = allText.matchAll(/Pledge\s+(?:\$|€|£|¥)([\d,]+(?:\.\d+)?)\s+or\s+more/gi);
          for (const m of pledgeMatches) { const a = parseFloat(m[1].replace(/,/g, '')); if (a >= 5 && a < minPrice) minPrice = a; }
          if (minPrice === Infinity) {
            const tierElements = document.querySelectorAll('[class*="pledge"], [class*="tier"], [class*="reward"]');
            for (const el of tierElements) { const t = el.textContent || ''; const match = t.match(/(?:\$|€|£|¥)([\d,]+(?:\.\d+)?)/); if (match) { const a = parseFloat(match[1].replace(/,/g, '')); if (a >= 5 && a < minPrice) minPrice = a; } }
          }
          if (minPrice === Infinity) {
            const aboutMatches = allText.matchAll(/About\s+(?:\$|€|£|¥)([\d,]+(?:\.\d+)?)/gi);
            for (const m of aboutMatches) { const a = parseFloat(m[1].replace(/,/g, '')); if (a >= 5 && a < minPrice) minPrice = a; }
          }
          if (minPrice === Infinity) {
            const allMatches = allText.matchAll(/(?:\$|€|£|¥)([\d,]+(?:\.\d+)?)/g);
            for (const m of allMatches) { const a = parseFloat(m[1].replace(/,/g, '')); if (a >= 10 && a < 5000 && a < minPrice) minPrice = a; }
          }
          if (minPrice === Infinity) return '';
          const formatted = minPrice % 1 === 0 ? minPrice.toLocaleString('en-US') : minPrice.toFixed(2);
          return String.fromCharCode(36) + formatted;
        });
        if (price) { item.price = price; fetched++; log.ok('kickstarter', '  price: ' + price + ' for ' + item.name.slice(0, 40)); }
        else { log.warn('kickstarter', '  no price found for ' + item.name.slice(0, 40)); }
        await detailPage.waitForTimeout(1000 + Math.random() * 1000);
      } catch (err) { log.warn('kickstarter', 'detail page failed for ' + item.name.slice(0, 30) + ': ' + (err instanceof Error ? err.message : err)); }
    }
  } finally { await detailPage.close(); }
  log.ok('kickstarter', 'scraped prices for ' + fetched + '/' + itemsNeedingPrice.length + ' items');
}

if (process.argv[1]?.includes('kickstarter')) {
  scrapeKickstarter(12).then(result => {
    console.log('\n=== Kickstarter Scrape Result ===');
    console.log('OK:', result.ok);
    console.log('Items:', result.items.length);
    console.log('Errors:', result.errors);
    console.log('Duration:', result.durationMs, 'ms');
    for (const item of result.items.slice(0, 3)) {
      console.log('\n---', item.name, '---');
      console.log('  raised:', item.raised, item.currencySymbol);
      console.log('  backers:', item.backers);
      console.log('  progress:', item.progress_pct + '%');
      console.log('  price:', item.price || '(empty)');
      console.log('  founder:', item.founder);
      console.log('  location:', item.location);
    }
  }).catch(e => { console.error('Scrape failed:', e); process.exit(1); });
}
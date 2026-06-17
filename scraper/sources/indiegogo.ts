/**
 * Indiegogo 爬虫
 * 入口：https://www.indiegogo.com/explore/technology
 * 策略：Playwright 动态渲染 + page.evaluate 从 .gfu-card 卡片提取 + 详情页补充
 * 分类：Technology & Innovation
 * 
 * 关键发现：Indiegogo explore 页面现在混合了 gamefound.com（桌游）和
 * 真正的 indiegogo.com 项目。需要过滤只保留 indiegogo.com 链接的项目。
 * 卡片结构：.gfu-card 包含项目名称、创始人、金额、支持者数等信息。
 */
import { newContext, gotoSafe } from '../lib/browser';
import { log } from '../lib/logger';
import type { RawCrowdfundingItem, ScrapeResult } from '../lib/types';

const EXPLORE_URL = 'https://www.indiegogo.com/explore/technology?project_type=all&project_timing=all&sort=trending';

export async function scrapeIndiegogo(maxItems = 30): Promise<ScrapeResult<RawCrowdfundingItem>> {
  const t0 = Date.now();
  const result: ScrapeResult<RawCrowdfundingItem> = {
    source: 'Indiegogo',
    ok: false,
    items: [],
    errors: [],
    durationMs: 0,
  };

  const ctx = await newContext();
  const page = await ctx.newPage();

  try {
    log.info('indiegogo', `loading: ${EXPLORE_URL}`);
    await gotoSafe(page, EXPLORE_URL, { timeoutMs: 60000 });

    // 等待页面 JS 渲染完成（Indiegogo 是重度 SPA）
    await page.waitForTimeout(8000);

    // 滚动加载更多项目
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(2500);
    }

    // 等待卡片出现
    await page.waitForSelector('.gfu-card', { timeout: 30000 }).catch(() => {
      log.warn('indiegogo', 'gfu-card selector timeout, trying anyway');
    });
    await page.waitForTimeout(3000);

    // ===== 使用 page.evaluate 从 .gfu-card 卡片提取数据 =====
    const rawItems = await extractFromCards(page, maxItems);
    log.info('indiegogo', `extracted ${rawItems.length} items from gfu-card`);

    if (rawItems.length === 0) {
      log.warn('indiegogo', 'no items extracted from cards');
      result.ok = false;
      result.durationMs = Date.now() - t0;
      await page.close();
      await ctx.close();
      return result;
    }

    result.items = rawItems;

    // ===== 第二阶段：从详情页补充 founder/location/price =====
    await scrapeDetailsFromPages(result.items, ctx);

    result.ok = result.items.length > 0;
    log.ok('indiegogo', `extracted ${result.items.length} items`);
  } catch (err) {
    log.err('indiegogo', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await page.close();
    await ctx.close();
  }

  result.durationMs = Date.now() - t0;
  return result;
}

/**
 * 从 .gfu-card 卡片提取项目数据
 * 只保留链接到 indiegogo.com 的项目（过滤掉 gamefound.com 桌游）
 */
async function extractFromCards(page: import('playwright').Page, maxItems: number): Promise<RawCrowdfundingItem[]> {
  const rawItems = await page.evaluate((max) => {
    const cards = document.querySelectorAll('.gfu-card');
    const items: any[] = [];
    const seenUrls = new Set<string>();

    for (const card of cards) {
      if (items.length >= max) break;
      try {
        // 找到卡片内的所有链接
        const links = Array.from(card.querySelectorAll('a'));
        
        // 只保留 indiegogo.com 的项目链接（过滤 gamefound.com）
        const igoLink = links.find(a => 
          a.href && a.href.includes('indiegogo.com') && a.href.includes('/projects/')
        );
        if (!igoLink) continue;

        const href = igoLink.href
          .replace(':443', '')
          .replace(/[\?&]ref=[^&]+/, '')
          .replace(/\/$/, '');
        
        if (seenUrls.has(href)) continue;
        seenUrls.add(href);

        // 提取卡片文本内容
        const allText = card.textContent?.trim() || '';
        
        // 图片
        const img = card.querySelector('img');
        const imgSrc = img ? (img as HTMLImageElement).src : '';
        
        // 从卡片文本解析结构化数据
        // 格式示例:
        //   476 238
        //   Crowdfunding
        //   16 days left
        //   SKWHEEL : Ski Anywhere. All Year Long. by  SKWHEEL
        //   €399,974
        //   goal reached in 5 minutes
        
        const lines = allText.split('\n').map(l => l.trim()).filter(Boolean);
        
        // 项目名称：找到 "by" 前面的文本
        let name = '';
        let founder = '';
        const skipPatterns = /^(Ending\s+soon|Crowdfunding|Express|pledged|goal\s+reached|funded|\d+\s*(days?|hours?|minutes?)\s+left)/i;
        for (const line of lines) {
          const byIdx = line.indexOf(' by ');
          if (byIdx > 5 && !skipPatterns.test(line)) {
            name = line.slice(0, byIdx).trim();
            founder = line.slice(byIdx + 4).trim();
            break;
          }
        }
        
        // 如果没找到 "by" 模式，尝试找最长的文本行作为名称
        if (!name) {
          const longLines = lines.filter(l => 
            l.length > 10 && 
            !/^\d/.test(l) && 
            !skipPatterns.test(l) &&
            !l.includes('left') && 
            !l.includes('Crowdfunding') && 
            !l.includes('pledged')
          );
          if (longLines.length > 0) {
            name = longLines[0];
          }
        }

        // 金额：找到包含货币符号的行
        let raised = 0;
        let currency = 'USD';
        let currencySymbol = '$';
        for (const line of lines) {
          const currMatch = line.match(/([€£¥$])\s*([\d,]+(?:\.\d+)?)/);
          if (currMatch) {
            const sym = currMatch[1];
            const amount = parseFloat(currMatch[2].replace(/,/g, ''));
            if (amount > raised) {
              raised = amount;
              currencySymbol = sym;
              if (sym === '€') { currency = 'EUR'; currencySymbol = '€'; }
              else if (sym === '£') { currency = 'GBP'; currencySymbol = '£'; }
              else if (sym === '¥') { currency = 'JPY'; currencySymbol = '¥'; }
              else { currency = 'USD'; currencySymbol = '$'; }
            }
          }
        }

        // 支持者数：第一行通常是 "backers comments" 格式
        let backers = 0;
        const firstLine = lines[0] || '';
        const backersMatch = firstLine.match(/^([\d,.]+[kK]?)\s*([\d,.]+[kK]?)/);
        if (backersMatch) {
          let s = backersMatch[1].replace(/,/g, '');
          if (s.endsWith('k') || s.endsWith('K')) {
            backers = Math.round(parseFloat(s.slice(0, -1)) * 1000);
          } else {
            backers = parseInt(s, 10) || 0;
          }
        }
        // backers 兜底：扫所有行找含 "backers" / "backer" / "supporters" 的
        if (backers === 0) {
          for (const line of lines) {
            const m = line.match(/([\d,.]+[kK]?)\s*(?:backers?|supporters?|funders?)/i);
            if (m) {
              let s = m[1].replace(/,/g, '');
              backers = s.endsWith('k') || s.endsWith('K')
                ? Math.round(parseFloat(s.slice(0, -1)) * 1000)
                : parseInt(s, 10) || 0;
              if (backers > 0) break;
            }
          }
        }

        // progress %：从所有行扫，找形如 "100% funded" / "7298% funded" / "raised XXX%"
        let progressPct = 0;
        for (const line of lines) {
          const m = line.match(/(\d{1,5})\s*%\s*(?:funded|raised)?/i);
          if (m) {
            const v = parseInt(m[1], 10);
            if (v > 0 && v <= 99999) { progressPct = v; break; }
          }
        }

        // slug
        const slugMatch = href.match(/\/projects\/([^?/]+\/[^?/]+)/);
        const slug = slugMatch ? slugMatch[1].replace(/\//g, '-') : name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        items.push({
          name,
          founder: founder || '',
          campaignUrl: href,
          image: imgSrc,
          raised,
          currency,
          currencySymbol,
          backers,
          progressPct,
          slug,
        });
      } catch (e) {
        // skip this card
      }
    }
    return items;
  }, maxItems);

  return rawItems.map(r => ({
    id: `igo-${r.slug}`,
    platform: 'Indiegogo' as const,
    image: r.image || '',
    name: r.name || 'Unknown',
    name_zh: r.name || 'Unknown',
    founder: r.founder || 'Unknown',
    location: 'Unknown',
    raised: r.raised || 0,
    currency: r.currency || 'USD',
    currencySymbol: r.currencySymbol || '$',
    progress_pct: r.progressPct ?? 0,
    backers: r.backers || 0,
    price: '',
    campaign_url: r.campaignUrl,
    category_tag_zh: '#科技',
    summary_zh: [],
    scrapedAt: new Date().toISOString(),
  }));
}

/**
 * 从详情页补充 founder/location/price
 */
async function scrapeDetailsFromPages(items: RawCrowdfundingItem[], ctx: import('playwright').BrowserContext): Promise<void> {
  // 所有 Indiegogo 条目都跑详情页：列表卡的金额是 USD 折算/backers 不准/缺 days_left
  // 详情页才有原货币真实金额、真实 backers、剩余天数
  const itemsNeedingDetail = items.slice();
  if (itemsNeedingDetail.length === 0) return;

  log.info('indiegogo', `fetching detail pages for ${itemsNeedingDetail.length} projects...`);
  const detailPage = await ctx.newPage();
  let fetched = 0;

  try {
    for (const item of itemsNeedingDetail) {
      try {
        const url = item.campaign_url;
        if (!url) continue;
        log.info('indiegogo', `detail [${fetched + 1}/${itemsNeedingDetail.length}]: ${item.name.slice(0, 40)}...`);
        // Indiegogo 详情页会做重定向，使用 domcontentloaded + 额外等待
        try {
          await detailPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        } catch {
          // 重定向页面可能抛出 "interrupted" 错误，但页面可能已加载
          log.warn('indiegogo', `  navigation interrupted for ${item.name.slice(0, 30)}, waiting for page...`);
        }
        await detailPage.waitForTimeout(4000);

        const detail = await detailPage.evaluate(() => {
          const allText = document.body?.innerText || '';
          let founder = '';
          let location = '';
          let price = '';
          let raised = 0;
          let currencySymbol = '';
          let backers = 0;
          let daysLeft = 0;
          let progressPct = 0;

          // 创始人：查找 "by" 模式或 creator 元素
          const creatorEl = document.querySelector('[class*="creator"], [class*="owner"], [class*="campaigner"], a[href*="/people/"]');
          if (creatorEl) {
            founder = creatorEl.textContent?.trim().replace(/^by\s+/i, '') || '';
          }
          if (!founder) {
            const byMatch = allText.match(/by\s+([A-Z][A-Za-z\s&.]+?)(?:\s*[·|,\n]|\s{3,})/);
            if (byMatch) founder = byMatch[1].trim();
          }

          // 位置
          const locEl = document.querySelector('[class*="location"], [class*="city"]');
          if (locEl) location = locEl.textContent?.trim() || '';
          if (!location) {
            const locMatch = allText.match(/([A-Z][a-z]+(?:\s*,\s*[A-Z][a-z]+)+)/);
            if (locMatch) location = locMatch[1].trim();
          }

          // === 关键金额字段（按行尝试多种模式）===
          // Indiegogo 详情页关键字符串通常是：
          //   "HK$ 2,942,977 raised" / "HK$2,942,977"
          //   "USD $ 376,847 USD raised"
          //   "145 backers"
          //   "23 days left"
          // 先找带 "raised" 的金额，提取货币 + 数值
          const raisedMatch = allText.match(/((?:HK\$|S\$|A\$|CA\$|NZ\$|US\$|USD|EUR|GBP|JPY|CNY|HKD|SGD|AUD)?\s*[€£¥$]?)\s*([\d,]+(?:\.\d+)?)\s*(?:raised|of\s+\$|funded)/i);
          if (raisedMatch) {
            const symRaw = raisedMatch[1].trim().toUpperCase().replace(/\s+/g, '');
            currencySymbol = symRaw || '$';
            raised = parseFloat(raisedMatch[2].replace(/,/g, '')) || 0;
          }

          // backers：找 "X backers"
          const backersMatch = allText.match(/([\d,]+)\s+backers/i);
          if (backersMatch) backers = parseInt(backersMatch[1].replace(/,/g, ''), 10) || 0;

          // days left
          const daysMatch = allText.match(/(\d+)\s+days?\s+left/i);
          if (daysMatch) daysLeft = parseInt(daysMatch[1], 10) || 0;
          const hoursMatch = allText.match(/(\d+)\s+hours?\s+left/i);
          if (!daysLeft && hoursMatch) daysLeft = 0; // 不到 1 天

          // progress %
          const pctMatch = allText.match(/(\d{1,5})\s*%\s*(?:funded|raised|of\s+goal)/i);
          if (pctMatch) progressPct = parseInt(pctMatch[1], 10) || 0;

          // 价格：从 perk/reward 区域提取最低价格
          let minPrice = Infinity;
          // Strategy 1: "Pledge $X" or "Contribute $X" patterns
          const pledgeMatches = allText.matchAll(/(?:Pledge|Contribute|Perk)\s+(?:\$|€|£|¥)([\d,]+(?:\.\d+)?)/gi);
          for (const m of pledgeMatches) {
            const a = parseFloat(m[1].replace(/,/g, ''));
            if (a >= 5 && a < minPrice) minPrice = a;
          }
          // Strategy 2: perk/tier elements
          if (minPrice === Infinity) {
            const perkEls = document.querySelectorAll('[class*="perk"], [class*="reward"], [class*="tier"], [class*="pledge"]');
            for (const el of perkEls) {
              const t = el.textContent || '';
              const match = t.match(/(?:\$|€|£|¥)([\d,]+(?:\.\d+)?)/);
              if (match) {
                const a = parseFloat(match[1].replace(/,/g, ''));
                if (a >= 5 && a < minPrice) minPrice = a;
              }
            }
          }
          // Strategy 3: "About $X" for non-US
          if (minPrice === Infinity) {
            const aboutMatches = allText.matchAll(/About\s+(?:\$|€|£|¥)([\d,]+(?:\.\d+)?)/gi);
            for (const m of aboutMatches) {
              const a = parseFloat(m[1].replace(/,/g, ''));
              if (a >= 5 && a < minPrice) minPrice = a;
            }
          }
          // Strategy 4: global search (min $10)
          if (minPrice === Infinity) {
            const allMatches = allText.matchAll(/(?:\$|€|£|¥)([\d,]+(?:\.\d+)?)/g);
            for (const m of allMatches) {
              const a = parseFloat(m[1].replace(/,/g, ''));
              if (a >= 10 && a < 5000 && a < minPrice) minPrice = a;
            }
          }

          if (minPrice !== Infinity) {
            const formatted = minPrice % 1 === 0 ? minPrice.toLocaleString('en-US') : minPrice.toFixed(2);
            price = String.fromCharCode(36) + formatted; // "$" + formatted
          }

          return { founder, location, price, raised, currencySymbol, backers, daysLeft, progressPct };
        });

        if (detail.founder && item.founder === 'Unknown') item.founder = detail.founder;
        if (detail.location && item.location === 'Unknown') item.location = detail.location;
        if (detail.price) item.price = detail.price;
        // 用详情页的真实数字覆盖列表页的 USD 折算值
        if (detail.raised > 0) {
          item.raised = detail.raised;
          // 货币符号映射：HK$ → HK$，US$ → $，等等
          const sym = detail.currencySymbol;
          if (sym) {
            if (/HK\$|HKD/i.test(sym)) { item.currency = 'HKD'; item.currencySymbol = 'HK$'; }
            else if (/S\$|SGD/i.test(sym)) { item.currency = 'SGD'; item.currencySymbol = 'S$'; }
            else if (/A\$|AUD/i.test(sym)) { item.currency = 'AUD'; item.currencySymbol = 'A$'; }
            else if (/CA\$|CAD/i.test(sym)) { item.currency = 'CAD'; item.currencySymbol = 'CA$'; }
            else if (/€|EUR/i.test(sym)) { item.currency = 'EUR'; item.currencySymbol = '€'; }
            else if (/£|GBP/i.test(sym)) { item.currency = 'GBP'; item.currencySymbol = '£'; }
            else if (/¥|JPY|CNY/i.test(sym)) { item.currency = 'JPY'; item.currencySymbol = '¥'; }
            else { item.currency = 'USD'; item.currencySymbol = '$'; }
          }
        }
        if (detail.backers > 0) item.backers = detail.backers;
        if (detail.daysLeft > 0) (item as any).daysLeft = detail.daysLeft;
        if (detail.progressPct > 0) item.progress_pct = detail.progressPct;
        if (detail.founder || detail.location || detail.price) fetched++;
        log.info('indiegogo', `  founder=${detail.founder || item.founder}, loc=${detail.location || item.location}, price=${detail.price || 'N/A'}`);

        await detailPage.waitForTimeout(1000 + Math.random() * 1000);
      } catch (err) {
        log.warn('indiegogo', `detail failed for ${item.name.slice(0, 30)}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await detailPage.close();
  }
  log.ok('indiegogo', `scraped details for ${fetched}/${itemsNeedingDetail.length} items`);
}

if (process.argv[1]?.includes('indiegogo')) {
  scrapeIndiegogo(15).then(result => {
    console.log('\n=== Indiegogo Scrape Result ===');
    console.log('OK:', result.ok);
    console.log('Items:', result.items.length);
    console.log('Errors:', result.errors);
    for (const item of result.items) {
      console.log(`  ${item.name.slice(0, 50).padEnd(50)} raised=${item.currencySymbol}${item.raised.toLocaleString()} backers=${item.backers} price=${item.price} founder=${item.founder}`);
    }
  });
}
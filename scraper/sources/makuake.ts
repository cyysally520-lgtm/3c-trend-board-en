/**
 * Makuake 爬虫
 * 入口：https://www.makuake.com/ (首页有项目列表)
 * 策略：Playwright 动态渲染 + page.evaluate 从项目链接提取 + 3C数码关键词筛选 + 详情页补充
 * 
 * 关键发现：Makuake 是 Vue.js SPA，静态 HTML 无项目数据。
 * 首页渲染后有项目链接，文本格式：
 *   "描述｜项目名￥金額 日数 達成率%"
 * 需要用 3C 数码关键词筛选相关产品。
 */
import { newContext, gotoSafe } from '../lib/browser';
import { log } from '../lib/logger';
import type { RawCrowdfundingItem, ScrapeResult } from '../lib/types';

const HOME_URL = 'https://www.makuake.com/';
const BASE = 'https://www.makuake.com';

// 3C数码相关关键词（日文+英文+中文）
const TECH_KEYWORDS = [
  // 日文
  'ガジェット', 'テクノロジー', '家電', 'スマホ', 'PC', 'イヤホン', 'ヘッドホン',
  '充電', 'バッテリー', 'モニター', 'ディスプレイ', 'カメラ', 'ドローン', 'ロボット',
  'AI', 'Bluetooth', 'Wi-Fi', 'USB', 'プロジェクター', 'スピーカー', 'キーボード',
  'マウス', 'タブレット', 'ノートPC', 'デスクトップ', 'SSD', 'HDD', 'メモリ',
  'ルーター', 'ハブ', 'ケーブル', 'スタンド', 'ケース', 'フィルム',
  '電子', 'デジタル', 'スマート', 'ワイヤレス', 'ポータブル',
  '眼鏡', 'サングラス', '時計', 'ライト', 'LED', 'センサー',
  'Flip', 'Elfin', 'SABERA', 'Gatebox', 'Dnsys', 'GLIDIC',
  // English
  'gadget', 'tech', 'digital', 'smart', 'wireless', 'portable', 'electric',
  'projector', 'speaker', 'keyboard', 'mouse', 'monitor', 'camera', 'drone',
  'robot', 'charger', 'battery', 'earphone', 'headphone', 'laptop', 'tablet',
  'fan', 'cooler', 'vacuum', 'cleaner', 'oven', 'cook',
  // 中文
  '数码', '电子', '智能', '无线', '充电',
];

function isTechProject(text: string): boolean {
  const lower = text.toLowerCase();
  return TECH_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

export async function scrapeMakuake(maxItems = 30): Promise<ScrapeResult<RawCrowdfundingItem>> {
  const t0 = Date.now();
  const result: ScrapeResult<RawCrowdfundingItem> = {
    source: 'Makuake',
    ok: false,
    items: [],
    errors: [],
    durationMs: 0,
  };

  const ctx = await newContext();
  const page = await ctx.newPage();

  try {
    log.info('makuake', `loading: ${HOME_URL}`);
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(8000);

    // 滚动加载更多项目
    for (let i = 0; i < 10; i++) {
      await page.evaluate(() => window.scrollBy(0, 1200));
      await page.waitForTimeout(2000);
    }

    await page.waitForSelector('a[href*="/project/"]', { timeout: 30000 }).catch(() => {
      log.warn('makuake', 'project links selector timeout');
    });
    await page.waitForTimeout(3000);

    // 提取项目数据
    const rawItems = await extractFromPage(page, maxItems * 3); // 多取一些再筛选
    log.info('makuake', `extracted ${rawItems.length} raw items from page`);

    // 3C数码筛选
    const techItems = rawItems.filter(item => isTechProject(item.name + ' ' + item.campaignUrl));
    log.info('makuake', `filtered to ${techItems.length} tech items`);

    // 映射到 RawCrowdfundingItem
    result.items = techItems.slice(0, maxItems).map(r => ({
      id: `mk-${r.slug}`,
      platform: 'Makuake' as const,
      image: r.image || '',
      name: r.name,
      name_zh: r.name,
      founder: 'Unknown',
      location: 'Japan',
      raised: r.raised || 0,
      currency: 'JPY',
      currencySymbol: '￥',
      progress_pct: r.progressPct || 0,
      backers: r.backers || 0,
      price: '',
      campaign_url: r.campaignUrl,
      category_tag_zh: '#科技',
      summary_zh: [],
      scrapedAt: new Date().toISOString(),
    }));

    // 详情页补充 founder/location/price（最多5个，避免太慢）
    const itemsForDetail = result.items.slice(0, 5);
    await scrapeDetailsFromPages(itemsForDetail, ctx);

    result.ok = result.items.length > 0;
    log.ok('makuake', `extracted ${result.items.length} items`);
  } catch (err) {
    log.err('makuake', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await page.close();
    await ctx.close();
  }

  result.durationMs = Date.now() - t0;
  return result;
}

interface RawMakuakeItem {
  name: string;
  campaignUrl: string;
  image: string;
  raised: number;
  backers: number;
  progressPct: number;
  slug: string;
}

async function extractFromPage(page: import('playwright').Page, maxItems: number): Promise<RawMakuakeItem[]> {
  return page.evaluate((max) => {
    const links = Array.from(document.querySelectorAll('a[href*="/project/"]'));
    const seenUrls = new Set<string>();
    const items: RawMakuakeItem[] = [];

    for (const link of links) {
      if (items.length >= max) break;
      try {
        const href = (link as HTMLAnchorElement).href;
        const cleanUrl = href.split('?')[0].replace(/\/$/, '');
        if (seenUrls.has(cleanUrl)) continue;
        seenUrls.add(cleanUrl);

        const text = link.textContent?.trim() || '';
        if (!text || text.length < 5) continue;

        const img = link.querySelector('img');
        const imgSrc = img ? (img as HTMLImageElement).src : '';

        let name = '';
        let raised = 0;
        let backers = 0;
        let progressPct = 0;

        // 名称：在 ｜ 后面、￥ 前面
        const pipeIdx = text.indexOf('｜');
        if (pipeIdx > -1) {
          name = text.slice(pipeIdx + 1).split('￥')[0].trim();
        } else {
          const yenIdx = text.indexOf('￥');
          name = yenIdx > -1 ? text.slice(0, yenIdx).trim() : text.slice(0, 80).trim();
        }
        // 去掉名称前面的数字序号（如 "1", "2" 等）
        name = name.replace(/^\d+/, '').trim();

        // 金额 ￥XXX,XXX,XXX - 取第一个出现的金额
        const yenMatch = text.match(/￥([\d,]+)/);
        if (yenMatch) raised = parseInt(yenMatch[1].replace(/,/g, ''), 10) || 0;
        // 如果金额超过10亿日元，可能是多个数字拼接，尝试截取合理范围
        if (raised > 1000000000) {
          const s = yenMatch![1].replace(/,/g, '');
          // 尝试不同长度截取，找到最合理的金额（1万-10亿日元）
          for (let len = 6; len <= 9; len++) {
            const v = parseInt(s.slice(0, len), 10);
            if (v >= 10000 && v <= 1000000000) { raised = v; break; }
          }
        }

        // 达成率
        const pctMatches = text.match(/(\d+)%/g);
        if (pctMatches && pctMatches.length > 0) {
          progressPct = parseInt(pctMatches[pctMatches.length - 1], 10) || 0;
        }

        // 支持者数
        const supporterMatch = text.match(/(\d[\d,]*)\s*人/);
        if (supporterMatch) backers = parseInt(supporterMatch[1].replace(/,/g, ''), 10) || 0;

        const slugMatch = cleanUrl.match(/\/project\/([^/]+)/);
        const slug = slugMatch ? slugMatch[1] : '';

        if (name && name.length > 1) {
          items.push({ name: name.slice(0, 100), campaignUrl: cleanUrl, image: imgSrc, raised, backers, progressPct, slug });
        }
      } catch (e) { /* skip */ }
    }
    return items;
  }, maxItems as any) as Promise<RawMakuakeItem[]>;
}

async function scrapeDetailsFromPages(items: RawCrowdfundingItem[], ctx: import('playwright').BrowserContext): Promise<void> {
  const itemsNeedingDetail = items.filter(it => !it.founder || it.founder === 'Unknown' || !it.price);
  if (itemsNeedingDetail.length === 0) return;

  log.info('makuake', `fetching detail pages for ${itemsNeedingDetail.length} projects...`);
  const detailPage = await ctx.newPage();
  let fetched = 0;

  try {
    for (const item of itemsNeedingDetail) {
      try {
        if (!item.campaign_url) continue;
        log.info('makuake', `detail [${fetched + 1}/${itemsNeedingDetail.length}]: ${item.name.slice(0, 40)}...`);
        await detailPage.goto(item.campaign_url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await detailPage.waitForTimeout(2000);

        const detail = await detailPage.evaluate(() => {
          const allText = document.body?.innerText || '';
          let founder = '';
          let location = '';
          let price = '';

          // 创始人 - Makuake 用 "実行者" 标签
          const creatorMatch = allText.match(/実行者\s*\n\s*([^\n]{2,50})/);
          if (creatorMatch) founder = creatorMatch[1].trim();
          if (!founder) {
            // 尝试从页面上的用户名链接提取
            const userLink = document.querySelector('a[href*="/user/"]');
            if (userLink) founder = userLink.textContent?.trim() || '';
          }
          if (!founder) {
            const byMatch = allText.match(/by\s+([^\n]{2,50})/);
            if (byMatch) founder = byMatch[1].trim();
          }

          // 位置 - 日本都道府县
          const prefectures = '東京都|北海道|京都府|大阪府|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県';
          const locMatch = allText.match(new RegExp('(' + prefectures + ')[^\\n]{0,30}'));
          if (locMatch) location = locMatch[1].trim();

          // 价格：最低回报金额
          let minPrice = Infinity;
          const yenMatches = allText.matchAll(/￥([\d,]+(?:\.\d+)?)/g);
          for (const m of yenMatches) {
            const a = parseInt(m[1].replace(/,/g, ''), 10);
            if (a >= 500 && a < minPrice) minPrice = a; // 最低500日元
          }
          if (minPrice === Infinity) {
            const yenMatches2 = allText.matchAll(/¥([\d,]+(?:\.\d+)?)/g);
            for (const m of yenMatches2) {
              const a = parseInt(m[1].replace(/,/g, ''), 10);
              if (a >= 500 && a < minPrice) minPrice = a;
            }
          }
          if (minPrice !== Infinity) {
            price = '￥' + minPrice.toLocaleString();
          }

          return { founder, location, price };
        });

        if (detail.founder && item.founder === 'Unknown') item.founder = detail.founder;
        if (detail.location && item.location === 'Unknown') item.location = detail.location;
        if (detail.price) item.price = detail.price;
        if (detail.founder || detail.location || detail.price) fetched++;
        log.info('makuake', `  founder=${detail.founder || item.founder}, loc=${detail.location || item.location}, price=${detail.price || 'N/A'}`);

        await detailPage.waitForTimeout(1000 + Math.random() * 1000);
      } catch (err) {
        log.warn('makuake', `detail failed for ${item.name.slice(0, 30)}: ${err instanceof Error ? err.message : err}`);
      }
    }
  } finally {
    await detailPage.close();
  }
  log.ok('makuake', `scraped details for ${fetched}/${itemsNeedingDetail.length} items`);
}

if (process.argv[1]?.includes('makuake')) {
  scrapeMakuake(15).then(result => {
    console.log('\n=== Makuake Scrape Result ===');
    console.log('OK:', result.ok);
    console.log('Items:', result.items.length);
    console.log('Errors:', result.errors);
    for (const item of result.items) {
      console.log(`  ${item.name.slice(0, 50).padEnd(50)} raised=￥${item.raised.toLocaleString()} backers=${item.backers} price=${item.price} founder=${item.founder}`);
    }
  });
}
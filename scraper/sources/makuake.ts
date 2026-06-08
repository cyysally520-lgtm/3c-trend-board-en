/**
 * Makuake 爬虫
 * 入口：https://www.makuake.com
 * 策略：静态 HTML + cheerio 解析（Makuake 服务端渲染）
 * 分类：科技・ガジェット (Technology & Gadgets)
 */
import * as cheerio from 'cheerio';
import { fetchText, sleep } from '../lib/http';
import { log } from '../lib/logger';
import type { RawCrowdfundingItem, ScrapeResult } from '../lib/types';

const BASE = 'https://www.makuake.com';
// ガジェット(Gadgets) 标签页 + プロダクト(Product) 分类页
const LIST_URL = `${BASE}/discover/tags/8?coming_soon=false&ongoing=true&in_store=false&sort=popular`;

export async function scrapeMakuake(maxItems = 30): Promise<ScrapeResult<RawCrowdfundingItem>> {
  const t0 = Date.now();
  const result: ScrapeResult<RawCrowdfundingItem> = {
    source: 'Makuake',
    ok: false,
    items: [],
    errors: [],
    durationMs: 0,
  };

  try {
    log.info('makuake', `fetching: ${LIST_URL}`);
    const html = await fetchText(LIST_URL);
    const $ = cheerio.load(html);

    // Makuake 项目卡片 - 使用项目链接选择器
    const cards = $('a[href*="/project/"]').toArray();
    log.info('makuake', `found ${cards.length} project links on page 1`);

    const seenIds = new Set<string>();
    let extracted = 0;

    for (const el of cards) {
      if (extracted >= maxItems) break;
      try {
        const $card = $(el);

        // 项目链接
        const href = $card.attr('href') || $card.find('a').first().attr('href') || '';
        const campaignUrl = href.startsWith('http') ? href : BASE + href;
        if (!href || seenIds.has(campaignUrl)) continue;

        // 项目名称
        const name = $card.find('h3, [class*="title"], [class*="Title"]').first().text().trim();
        if (!name) continue;

        // 图片
        const imgSrc = $card.find('img').first().attr('src') || $card.find('img').first().attr('data-src') || '';
        const image = imgSrc.startsWith('//') ? 'https:' + imgSrc
          : imgSrc.startsWith('/') ? BASE + imgSrc
          : imgSrc;

        // 描述
        const blurb = $card.find('p, [class*="description"], [class*="desc"]').first().text().trim();

        // 筹集金额 - 日元格式 "¥1,234,567"
        const amountText = $card.find('[class*="amount"], [class*="money"], [class*="price"], [class*="collected"]').text();
        const amountMatch = amountText.match(/¥?([\d,]+)/);
        const raised = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ''), 10) : 0;

        // 支持者数 - "123 supporters" / "サポーター 123人"
        const backersText = $card.find('[class*="supporter"], [class*="backer"]').text();
        const backersMatch = backersText.match(/([\d,]+)/);
        const backers = backersMatch ? parseInt(backersMatch[1].replace(/,/g, ''), 10) : 0;

        // 进度百分比
        const pctText = $card.find('[class*="percent"], [class*="progress"], [class*="achievement"]').text();
        const pctMatch = pctText.match(/(\d+)%/);
        const progress_pct = pctMatch ? parseInt(pctMatch[1], 10) : (raised > 0 ? 100 : 0);

        // 发起人
        const founder = $card.find('[class*="owner"], [class*="creator"]').text().trim() || 'Unknown';

        // 位置
        const location = $card.find('[class*="location"], [class*="area"]').text().trim() || 'Japan';

        // 价格
        const priceText = $card.find('[class*="price"], [class*="reward"]').first().text().trim();

        const slug = href.split('/project/')[1]?.replace(/\//g, '') || name.toLowerCase().replace(/\s+/g, '-');
        seenIds.add(campaignUrl);

        const item: RawCrowdfundingItem = {
          id: `mk-${slug}`,
          platform: 'Makuake',
          image,
          name,
          name_zh: name,
          founder,
          location,
          raised,
          currency: 'JPY',
          currencySymbol: '¥',
          progress_pct,
          backers,
          price: priceText || '',
          campaign_url: campaignUrl,
          category_tag_zh: '#科技',
          summary_zh: blurb ? [blurb.slice(0, 200)] : [],
          scrapedAt: new Date().toISOString(),
        };
        result.items.push(item);
        extracted++;
      } catch (err) {
        result.errors.push(`card parse: ${err instanceof Error ? err.message : err}`);
      }
    }

    // 如果第一页数据不够，尝试第2页
    if (result.items.length < maxItems && result.items.length > 0) {
      const page2Url = `${LIST_URL}&page=2`;
      log.info('makuake', `fetching page 2: ${page2Url}`);
      await sleep(1500);
      try {
        const html2 = await fetchText(page2Url);
        const $2 = cheerio.load(html2);
        const cards2 = $2('a[href*="/project/"]').toArray();

        for (const el of cards2) {
          if (extracted >= maxItems) break;
          try {
            const $card = $2(el);
            const href = $card.attr('href') || $card.find('a').first().attr('href') || '';
            const campaignUrl = href.startsWith('http') ? href : BASE + href;
            if (!href || seenIds.has(campaignUrl)) continue;

            const name = $card.find('h3, [class*="title"], [class*="Title"]').first().text().trim();
            if (!name) continue;

            const imgSrc = $card.find('img').first().attr('src') || $card.find('img').first().attr('data-src') || '';
            const image = imgSrc.startsWith('//') ? 'https:' + imgSrc
              : imgSrc.startsWith('/') ? BASE + imgSrc
              : imgSrc;

            const blurb = $card.find('p, [class*="description"], [class*="desc"]').first().text().trim();
            const amountText = $card.find('[class*="amount"], [class*="money"], [class*="price"], [class*="collected"]').text();
            const amountMatch = amountText.match(/¥?([\d,]+)/);
            const raised = amountMatch ? parseInt(amountMatch[1].replace(/,/g, ''), 10) : 0;

            const backersText = $card.find('[class*="supporter"], [class*="backer"]').text();
            const backersMatch = backersText.match(/([\d,]+)/);
            const backers = backersMatch ? parseInt(backersMatch[1].replace(/,/g, ''), 10) : 0;

            const pctText = $card.find('[class*="percent"], [class*="progress"], [class*="achievement"]').text();
            const pctMatch = pctText.match(/(\d+)%/);
            const progress_pct = pctMatch ? parseInt(pctMatch[1], 10) : (raised > 0 ? 100 : 0);

            const founder = $card.find('[class*="owner"], [class*="creator"]').text().trim() || 'Unknown';
            const location = $card.find('[class*="location"], [class*="area"]').text().trim() || 'Japan';
            const priceText = $card.find('[class*="price"], [class*="reward"]').first().text().trim();

            const slug = href.split('/project/')[1]?.replace(/\//g, '') || name.toLowerCase().replace(/\s+/g, '-');
            seenIds.add(campaignUrl);

            result.items.push({
              id: `mk-${slug}`,
              platform: 'Makuake',
              image,
              name,
              name_zh: name,
              founder,
              location,
              raised,
              currency: 'JPY',
              currencySymbol: '¥',
              progress_pct,
              backers,
              price: priceText || '',
              campaign_url: campaignUrl,
              category_tag_zh: '#科技',
              summary_zh: blurb ? [blurb.slice(0, 200)] : [],
              scrapedAt: new Date().toISOString(),
            });
            extracted++;
          } catch (err) {
            result.errors.push(`card parse p2: ${err instanceof Error ? err.message : err}`);
          }
        }
      } catch (pageErr) {
        log.warn('makuake', `page 2 fetch failed: ${pageErr instanceof Error ? pageErr.message : pageErr}`);
      }
    }

    result.ok = result.items.length > 0;
    log.ok('makuake', `extracted ${result.items.length} items`);
  } catch (err) {
    log.err('makuake', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  result.durationMs = Date.now() - t0;
  return result;
}
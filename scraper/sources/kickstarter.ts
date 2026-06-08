/**
 * Kickstarter 爬虫
 * 入口：https://www.kickstarter.com/discover/advanced?category_id=16&sort=popular
 * 策略：Playwright 动态渲染 + cheerio 解析
 * 分类：Technology (id=16)
 */
import * as cheerio from 'cheerio';
import { newContext, gotoSafe } from '../lib/browser';
import { log } from '../lib/logger';
import type { RawCrowdfundingItem, ScrapeResult } from '../lib/types';

const DISCOVER_URL = 'https://www.kickstarter.com/discover/advanced?category_id=16&sort=popular&seed=2846981&page=1';

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
    await gotoSafe(page, DISCOVER_URL, { timeoutMs: 60000 });

    // 等待项目卡片加载
    await page.waitForSelector('[data-testid="project-card"], .js-react-proj-card, div[class*="project_"]', { timeout: 30000 }).catch(() => {
      log.warn('kickstarter', 'project card selector timeout, trying anyway');
    });

    // 额外等待让数据渲染完
    await page.waitForTimeout(3000);

    const html = await page.content();
    const $ = cheerio.load(html);

    // Kickstarter 多种页面结构，尝试多种选择器
    const cards = $('[data-testid="project-card"], .js-react-proj-card, div[class*="project-card"], a[class*="project_"]').toArray();
    log.info('kickstarter', `found ${cards.length} project cards`);

    const seenIds = new Set<string>();
    let extracted = 0;

    for (const el of cards) {
      if (extracted >= maxItems) break;
      try {
        const $card = $(el);

        // 项目链接
        const href = $card.find('a[href*="/projects/"]').first().attr('href') || $card.attr('href') || '';
        const campaignUrl = href.startsWith('http') ? href : `https://www.kickstarter.com${href}`;
        if (!href || seenIds.has(campaignUrl)) continue;

        // 项目名称
        const name = $card.find('h3, [class*="title"], [class*="project-title"]').first().text().trim()
          || $card.find('a[href*="/projects/"]').first().text().trim();
        if (!name) continue;

        // 图片
        const imgSrc = $card.find('img').first().attr('src') || '';
        const image = imgSrc.startsWith('//') ? 'https:' + imgSrc
          : imgSrc.startsWith('/') ? 'https://www.kickstarter.com' + imgSrc
          : imgSrc;

        // 描述
        const blurb = $card.find('p[class*="blurb"], [class*="description"], p').first().text().trim();

        // 筹集金额 - 解析 "$123,456 pledged" 格式
        const pledgedText = $card.find('[class*="pledged"], [class*="amount"]').text();
        const pledgedMatch = pledgedText.match(/[\$€£¥]?([\d,]+\.?\d*)/);
        const raised = pledgedMatch ? parseFloat(pledgedMatch[1].replace(/,/g, '')) : 0;

        // 支持者数
        const backersText = $card.find('[class*="backer"], [class*="supporter"]').text();
        const backersMatch = backersText.match(/([\d,]+)/);
        const backers = backersMatch ? parseInt(backersMatch[1].replace(/,/g, ''), 10) : 0;

        // 进度百分比
        const pctText = $card.find('[class*="percent"], [class*="progress"], [class*="funded"]').text();
        const pctMatch = pctText.match(/(\d+)%/);
        const progress_pct = pctMatch ? parseInt(pctMatch[1], 10) : (raised > 0 ? 100 : 0);

        // 发起人
        const founder = $card.find('[class*="creator"], [class*="author"], [class*="by"]').text().trim().replace(/^by\s+/i, '') || 'Unknown';

        // 位置
        const location = $card.find('[class*="location"]').text().trim() || 'Unknown';

        // 价格
        const priceText = $card.find('[class*="price"], [class*="reward"]').first().text().trim();

        const slug = href.split('/projects/')[1]?.replace(/\//g, '-') || name.toLowerCase().replace(/\s+/g, '-');
        seenIds.add(campaignUrl);

        const item: RawCrowdfundingItem = {
          id: `ks-${slug}`,
          platform: 'Kickstarter',
          image,
          name,
          name_zh: name,
          founder,
          location,
          raised,
          currency: 'USD',
          currencySymbol: '$',
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

    // 如果第一页没抓到足够数据，尝试 API 方式
    if (result.items.length < 5) {
      log.info('kickstarter', 'DOM parsing got few results, trying API endpoint...');
      try {
        const apiUrl = 'https://www.kickstarter.com/services/search/graphql?query=%7B%22category_id%22%3A16%2C%22sort%22%3A%22popular%22%2C%22page%22%3A1%7D';
        const apiPage = await ctx.newPage();
        await gotoSafe(apiPage, apiUrl, { timeoutMs: 30000, waitUntil: 'domcontentloaded' });
        const apiText = await apiPage.locator('body').textContent().catch(() => '');
        await apiPage.close();

        if (apiText) {
          try {
            const apiData = JSON.parse(apiText);
            const projects = apiData?.data?.projects?.edges || apiData?.projects || [];
            for (const edge of projects) {
              if (extracted >= maxItems) break;
              const p = edge.node || edge;
              if (!p.name || seenIds.has(p.url)) continue;
              seenIds.add(p.url);
              result.items.push({
                id: `ks-${p.slug || p.pid}`,
                platform: 'Kickstarter',
                image: p.image?.full || p.imageUrl || '',
                name: p.name,
                name_zh: p.name,
                founder: p.creator?.name || 'Unknown',
                location: p.location?.displayable_name || 'Unknown',
                raised: p.pledged?.amount || p.pledged_amount || 0,
                currency: p.pledged?.currency || p.currency || 'USD',
                currencySymbol: p.pledged?.currency_symbol || '$',
                progress_pct: p.percent_funded || Math.round(((p.pledged?.amount || p.pledged_amount || 0) / (p.goal?.amount || p.goal || 1)) * 100),
                backers: p.backers_count || p.backers || 0,
                price: '',
                campaign_url: p.url || `https://www.kickstarter.com/projects/${p.creator?.slug}/${p.slug}`,
                category_tag_zh: '#科技',
                summary_zh: p.blurb ? [p.blurb.slice(0, 200)] : [],
                scrapedAt: new Date().toISOString(),
              });
              extracted++;
            }
          } catch {
            log.warn('kickstarter', 'API response parse failed');
          }
        }
      } catch (apiErr) {
        log.warn('kickstarter', `API fallback failed: ${apiErr instanceof Error ? apiErr.message : apiErr}`);
      }
    }

    result.ok = result.items.length > 0;
    log.ok('kickstarter', `extracted ${result.items.length} items`);
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
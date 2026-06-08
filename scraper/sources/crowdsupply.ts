/**
 * Crowd Supply 爬虫
 * 入口：https://www.crowdsupply.com （首页展示所有活跃项目）
 * 策略：静态 HTML + cheerio 解析
 * DOM 结构（来自真实页面分析）：
 *   <a class="project-tile" href="/creator/project">
 *     <img alt="Name" src="...">
 *     <div class="project-tile-overview"><h3>Name</h3><p>blurb</p></div>
 *     <div class="project-metadata">
 *       <div class="stats">
 *         <div class="status-bar">...</div>
 *         <div class="factoids">
 *           <div class="fact"><span class="fact-number">$97,040</span> raised</div>
 *           <div class="fact"><span class="fact-number">463</span> backers</div>
 *         </div>
 *       </div>
 *     </div>
 *   </a>
 */
import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http';
import { log } from '../lib/logger';
import type { RawCrowdfundingItem, ScrapeResult } from '../lib/types';

const LIST_URL = 'https://www.crowdsupply.com';
const BASE = 'https://www.crowdsupply.com';

export async function scrapeCrowdSupply(maxItems = 20): Promise<ScrapeResult<RawCrowdfundingItem>> {
  const t0 = Date.now();
  const result: ScrapeResult<RawCrowdfundingItem> = {
    source: 'Crowd Supply',
    ok: false,
    items: [],
    errors: [],
    durationMs: 0,
  };

  try {
    log.info('crowdsupply', `fetching homepage: ${LIST_URL}`);
    const html = await fetchText(LIST_URL);
    const $ = cheerio.load(html);

    const cards = $('a.project-tile').toArray();
    log.info('crowdsupply', `found ${cards.length} project-tile cards`);

    const targets = cards.slice(0, maxItems);
    for (const el of targets) {
      try {
        const $card = $(el);
        const href = $card.attr('href') || '';
        const url = href.startsWith('http') ? href : BASE + href;
        if (!href) continue;

        // 项目名称
        const name = $card.find('h3').first().text().trim();
        if (!name) continue;

        // 图片（直接在 <a> 下的 img）
        const imgSrc = $card.children('img').first().attr('src') || '';
        const image = imgSrc.startsWith('//') ? 'https:' + imgSrc
          : imgSrc.startsWith('/') ? BASE + imgSrc
          : imgSrc;

        // 简介
        const blurb = $card.find('.project-tile-overview p').first().text().trim();

        // 资金状态数据
        const facts = $card.find('.factoids .fact').toArray();
        let raised = 0;
        let backers = 0;
        for (const fact of facts) {
          const label = $(fact).find('.fact-label').text().trim().toLowerCase();
          const numText = $(fact).find('.fact-number').text().replace(/[^0-9.]/g, '').trim();
          const num = parseFloat(numText) || 0;
          if (label === 'raised') raised = num;
          if (label === 'backers') backers = Math.round(num);
        }

        // 进度百分比（从 status-bar 文字里解析）
        const statusText = $card.find('.status-bar').first().text().trim();
        const pctMatch = statusText.match(/(\d[\d,]*)\s*%/);
        const progress_pct = pctMatch ? parseInt(pctMatch[1].replace(/,/g, ''), 10) : (raised > 0 ? 100 : 0);

        const slug = href.split('/').filter(Boolean).join('-') || name.toLowerCase().replace(/\s+/g, '-');

        const item: RawCrowdfundingItem = {
          id: `cs-${slug}`,
          platform: 'Crowd Supply',
          image,
          name,
          name_zh: name,
          founder: 'Unknown',
          location: 'Unknown',
          raised,
          currency: 'USD',
          currencySymbol: '$',
          progress_pct,
          backers,
          price: '',
          campaign_url: url,
          category_tag_zh: '#硬件',
          summary_zh: blurb ? [blurb.slice(0, 200)] : [],
          scrapedAt: new Date().toISOString(),
        };
        result.items.push(item);
      } catch (err) {
        result.errors.push(`card parse: ${err instanceof Error ? err.message : err}`);
      }
    }

    result.ok = result.items.length > 0;
    log.ok('crowdsupply', `extracted ${result.items.length} items`);
  } catch (err) {
    log.err('crowdsupply', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  result.durationMs = Date.now() - t0;
  return result;
}
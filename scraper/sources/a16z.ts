/**
 * a16z Infra "Investing in" 公告爬虫（仅 EN 站）
 * 入口：https://a16z.com/infra/
 * 策略：cheerio 静态 HTML 解析（SSR）+ 每篇详情页拿公司 logo SVG
 *
 * 字段映射 → RawStartupItem (source: 'a16z')：
 *   id        : a16z-{slug}
 *   name      : 文章标题去掉 "Investing in " 前缀（如 "Glif"）
 *   intro     : 文章列表页的描述（一句话）
 *   intro_zh  : 跟 intro 一样占位，会被 translateStartupsToEn 重写为差异化分析
 *   logo      : 详情页第一张 <img> （SVG 公司 logo）
 *   founders  : 作者名（a16z 合伙人）
 *   batch     : 'Active'（a16z 投后活跃，跟 YC batch 字段对齐）
 *   url       : 文章 URL
 *   location  : Unknown（a16z 不一定标）
 *   team_size : ''
 *
 * 卡片渲染时 source==='a16z' 走蓝色徽章逻辑，已经在 StartupCard 实现。
 */
import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http';
import { log } from '../lib/logger';
import type { RawStartupItem, ScrapeResult } from '../lib/types';

const INDEX_URL = 'https://a16z.com/infra/';

interface ListEntry {
  url: string;       // 完整 URL
  slug: string;      // investing-in-glif
  name: string;      // Glif（标题去掉 "Investing in "）
  intro: string;     // 描述
  founders: string;  // 作者
}

export async function scrapeA16z(maxItems = 30): Promise<ScrapeResult<RawStartupItem>> {
  const t0 = Date.now();
  const result: ScrapeResult<RawStartupItem> = {
    source: 'a16z',
    ok: false,
    items: [],
    errors: [],
    durationMs: 0,
  };

  try {
    log.info('a16z', `fetching index: ${INDEX_URL}`);
    const indexHtml = await fetchText(INDEX_URL, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const $ = cheerio.load(indexHtml);

    // 找所有 a[href*="/announcement/investing-in-"] 链接，去重
    const seen = new Set<string>();
    const entries: ListEntry[] = [];
    $('a[href*="/announcement/investing-in-"]').each((_, el) => {
      const href = $(el).attr('href') || '';
      const m = href.match(/\/announcement\/(investing-in-[a-z0-9-]+)\/?/);
      if (!m) return;
      const slug = m[1];
      if (seen.has(slug)) return;
      seen.add(slug);

      // 标题：找最近的 h2/h3 / 链接文字本身
      const fullTitle = ($(el).find('h2, h3').first().text() || $(el).text()).trim();
      // 去掉 "Investing in " 前缀
      const name = fullTitle.replace(/^Investing\s+in\s+/i, '').trim();
      if (!name) return;

      // 找紧邻的描述段落和作者：往父容器上溯
      const parent = $(el).parent().parent();
      const blockText = parent.text().replace(/\s+/g, ' ').trim();
      // 在父块里找该文章相关段落
      const idx = blockText.indexOf(fullTitle);
      const after = idx >= 0 ? blockText.slice(idx + fullTitle.length).slice(0, 600) : blockText.slice(0, 600);

      // 作者：通常是 "Sarah Wang, Jennifer Li, ..." 紧跟标题后
      // 找包含名字逗号格式的部分（前 200 字符）
      let founders = '';
      let intro = '';
      // 简化：把 after 按句号切，前面是作者，后面是 intro
      // 但实际格式是 "AuthorList\n描述"，cheerio 文字平铺后可能没有换行
      // 先让 founders 留空，下面详情页 fallback 抓更稳
      const authorMatch = after.match(/^(\s*[A-Z][a-zA-Z. ,]+(?:,\s*and\s+[A-Z][a-zA-Z. ]+|,\s*[A-Z][a-zA-Z. ]+)*)/);
      if (authorMatch) {
        founders = authorMatch[1].trim();
        intro = after.slice(authorMatch[0].length).trim().slice(0, 280);
      } else {
        intro = after.slice(0, 280);
      }

      const fullUrl = href.startsWith('http') ? href : `https://a16z.com${href}`;
      entries.push({ url: fullUrl, slug, name, intro, founders });
    });

    log.info('a16z', `found ${entries.length} announcements on index`);

    // 限制条数
    const targets = entries.slice(0, maxItems);

    // 每篇文章详情页拿 og:description（更准）+ 公司 logo
    for (const e of targets) {
      try {
        const detailHtml = await fetchText(e.url, {
          headers: { 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
        });
        const $$ = cheerio.load(detailHtml);

        // og:description 比列表页文字更稳；某些只有「a16z leads X's Series C」太短
        // 短时取详情页正文第一段（去 HTML 标签）当 intro 兜底
        let ogDesc = $$('meta[property="og:description"]').attr('content') || '';
        if (ogDesc.length < 60) {
          // 找文章正文第一段
          const articleText = $$('.entry-content p, article p, main p').first().text().trim();
          if (articleText.length > ogDesc.length) ogDesc = articleText;
        }
        const intro = (ogDesc || e.intro || '').trim().slice(0, 500);

        // 公司 logo + 公司官网：详情页里 <a href="{company_url}"><img src="{logo_xxx.svg}">
        // 用 cheerio 找含 logo_ 的 svg img + 它的父 a 链接
        let logo = '';
        let companyUrl = '';
        $$('img').each((_, img) => {
          if (logo) return;
          const src = $$(img).attr('src') || '';
          if (src.includes('/uploads/') && /logo_/.test(src)) {
            logo = src;
            // 父链接
            const parentA = $$(img).closest('a');
            const href = parentA.attr('href') || '';
            if (href && /^https?:\/\//.test(href) && !href.includes('a16z.com')) {
              companyUrl = href;
            }
          }
        });
        // fallback logo: og:image
        if (!logo) {
          logo = $$('meta[property="og:image"]').attr('content') || '';
        }

        // Feature 分类：a16z 顶部小标签 <span class="component-hero--subtitle">
        const feature = $$('span.component-hero--subtitle').first().text().trim();

        // 发布年份：JSON-LD datePublished 优先，回退到 meta，再回退到 "Posted XXX, YYYY" 文本
        let postedYear = '';
        const jsonLdMatch = detailHtml.match(/"datePublished"\s*:\s*"(\d{4})/);
        if (jsonLdMatch) postedYear = jsonLdMatch[1];
        if (!postedYear) {
          const ogDate = $$('meta[property="article:published_time"]').attr('content') || '';
          const m = ogDate.match(/^(\d{4})/);
          if (m) postedYear = m[1];
        }
        if (!postedYear) {
          const postedMatch = detailHtml.match(/Posted\s+[A-Z][a-z]+\s+\d{1,2},?\s+(\d{4})/);
          if (postedMatch) postedYear = postedMatch[1];
        }

        result.items.push({
          id: `a16z-${e.slug.replace(/^investing-in-/, '')}`,
          source: 'a16z',
          name: e.name,
          name_zh: e.name,
          intro,
          intro_zh: intro ? [intro] : [],
          logo,
          company_url: companyUrl,
          // 列表页解析作者太脆弱，固定写 "a16z" 避免脏数据；卡片有 source 徽章足矣
          founders: 'a16z',
          team_size: postedYear,    // 复用字段：装"Posted year"，前端 label 改为 Posted
          location: feature,         // 复用字段：装"Feature 分类"，前端 label 改为 Feature
          batch: 'Active',
          url: e.url,
          scrapedAt: new Date().toISOString(),
        });
      } catch (err) {
        result.errors.push(`detail ${e.slug}: ${err instanceof Error ? err.message : err}`);
      }
    }

    result.ok = result.items.length > 0;
    log.ok('a16z', `extracted ${result.items.length} a16z investments`);
  } catch (err) {
    log.err('a16z', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  result.durationMs = Date.now() - t0;
  return result;
}

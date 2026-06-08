/**
 * Gizchina 爬虫
 * 入口：https://www.gizchina.com/sitemap.xml → 解析最近文章
 * 策略：Sitemap XML 取最新 URL → 抓文章页面 cheerio 解析
 * 注：Gizchina 已关闭 RSS，改用 Sitemap
 */
import * as cheerio from 'cheerio';
import { fetchText, sleep } from '../lib/http';
import { log } from '../lib/logger';
import type { RawNewsItem, ScrapeResult } from '../lib/types';

const SITEMAP_URL = 'https://www.gizchina.com/sitemap/news-latest.xml';

export async function scrapeGizchina(maxItems = 20): Promise<ScrapeResult<RawNewsItem>> {
  const t0 = Date.now();
  const result: ScrapeResult<RawNewsItem> = {
    source: 'Gizchina',
    ok: false,
    items: [],
    errors: [],
    durationMs: 0,
  };

  try {
    // Step 1: 获取 Sitemap，提取最新文章 URL
    log.info('gizchina', `fetching sitemap: ${SITEMAP_URL}`);
    const sitemapXml = await fetchText(SITEMAP_URL, {
      headers: { Accept: 'application/xml, text/xml, */*' },
    });
    const $sm = cheerio.load(sitemapXml, { xmlMode: true });

    // WordPress sitemap 格式：<url><loc>...</loc><lastmod>...</lastmod></url>
    const urlNodes = $sm('url').toArray();
    log.info('gizchina', `sitemap has ${urlNodes.length} urls`);

    // Gizchina URL 格式：https://www.gizchina.com/{category}/{article-slug}
    // 过滤掉：首页、分类首页（只有一段路径）、特殊页面
    const articles = urlNodes
      .map((el) => ({
        url: $sm(el).find('loc').text().trim(),
        lastmod: $sm(el).find('lastmod').text().trim(),
      }))
      .filter((u) => {
        const path = u.url.replace('https://www.gizchina.com', '');
        const segments = path.split('/').filter(Boolean);
        // 文章 URL 有 2 段：/category/slug
        return segments.length === 2;
      })
      .sort((a, b) => b.lastmod.localeCompare(a.lastmod))
      .slice(0, maxItems);

    log.info('gizchina', `will scrape ${articles.length} article pages`);

    // Step 2: 逐篇抓取文章页
    for (const { url, lastmod } of articles) {
      try {
        await sleep(1500); // 友好间隔
        const html = await fetchText(url);
        const $ = cheerio.load(html);

        const title = $('h1.entry-title, h1.post-title, h1').first().text().trim();
        if (!title) continue;

        const image =
          $('meta[property="og:image"]').attr('content') ||
          $('article img, .post-thumbnail img').first().attr('src') ||
          '';

        const snippet = (
          $('meta[name="description"]').attr('content') ||
          $('article p').first().text()
        ).trim().slice(0, 240);

        const categories = $('a[rel="category tag"], .cat-links a').toArray()
          .map((el) => $(el).text().trim())
          .filter(Boolean);
        const categoryTag = categories[0] ? `#${categories[0]}` : '#科技';

        const item: RawNewsItem = {
          id: `giz-${hashUrl(url)}`,
          source: 'Gizchina',
          image,
          title,
          title_zh: title,
          publishedAt: lastmod ? new Date(lastmod).toISOString() : new Date().toISOString(),
          snippet,
          snippet_zh: [snippet],
          url,
          category_tag_zh: categoryTag,
          scrapedAt: new Date().toISOString(),
        };
        result.items.push(item);
      } catch (err) {
        result.errors.push(`article[${url}]: ${err instanceof Error ? err.message : err}`);
      }
    }

    result.ok = result.items.length > 0;
    log.ok('gizchina', `extracted ${result.items.length} items`);
  } catch (err) {
    log.err('gizchina', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  result.durationMs = Date.now() - t0;
  return result;
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function hashUrl(u: string): string {
  // 简单 hash：取 URL 末段 slug
  return u.split('/').filter(Boolean).pop()?.slice(0, 50) || Math.random().toString(36).slice(2, 8);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  scrapeGizchina(5).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
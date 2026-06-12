/**
 * NextBanker 爬虫
 * 入口：https://nextbanker.cn/  （多板块）
 * 策略：Playwright 渲染（HTML 静态阶段缺项目卡，需要 hydrate 后才出现）
 *
 * 页面结构（渲染后）：
 *   <h3>板块名</h3>          ← 顶级板块标题
 *   <div class="rh-sub">     ← 板块描述（无项目）
 *   <h4>项目名 tagline</h4>  ← 项目卡片标题
 *   <p>**技术：** ... **商业：** ... ...</p>
 *   <h4>下一个项目</h4>
 *   ...
 *   <h3>下一个板块</h3>
 *
 * h3 / h4 是兄弟节点（不是父子）。按 sibling 链遍历，遇到 h3 切换板块状态。
 */
import { newContext, gotoSafe } from '../lib/browser';
import { log } from '../lib/logger';
import type { RawInvestItem, ScrapeResult } from '../lib/types';

const BASE_URL = 'https://nextbanker.cn/';

// 白名单：只爬这些板块（对齐目标站「AI 高潜」tab 用到的赛道）
// 注意：nextbanker 上"银发科技"= 目标站口径"银发经济"
const ALLOWED_SECTIONS = [
  'AI硬件',
  '具身智能',
  'AI Agent',
  'AI教育',
  '银发科技',
  'AI医疗',
];

interface RawNbCard {
  section: string;
  name: string;
  tagline: string;
  contentText: string;
}

export async function scrapeNextbanker(maxItems = 1000): Promise<ScrapeResult<RawInvestItem>> {
  const t0 = Date.now();
  const result: ScrapeResult<RawInvestItem> = {
    source: 'NextBanker',
    ok: false,
    items: [],
    errors: [],
    durationMs: 0,
  };

  const ctx = await newContext();
  const page = await ctx.newPage();

  try {
    log.info('nextbanker', `loading: ${BASE_URL}`);
    await gotoSafe(page, BASE_URL, { timeoutMs: 60000, waitUntil: 'networkidle' });
    // 给前端一点 hydrate 时间
    await page.waitForTimeout(2500);

    // 在浏览器侧用 sibling 链遍历，按板块归类项目
    const cards = await page.evaluate((allowedSections: string[]) => {
      const out: Array<{ section: string; name: string; tagline: string; contentText: string }> = [];
      const all = Array.from(document.querySelectorAll('h3, h4, p, div'));
      let inAllowed = false;
      let currentSection = '';
      let pendingName = '';
      let pendingTagline = '';
      let pendingParts: string[] = [];

      const sourceMarkers = /(XHS|GitHub|HF|Twitter|HN|YC|TC|VCx?|清华|北大|新闻|发现|官网|抖音|B站|HuggingFace|校长杯)/;

      for (const el of all) {
        const tag = el.tagName.toLowerCase();
        if (tag === 'h3') {
          // flush pending
          if (pendingName && currentSection) {
            out.push({ section: currentSection, name: pendingName, tagline: pendingTagline, contentText: pendingParts.join('\n') });
          }
          pendingName = ''; pendingTagline = ''; pendingParts = [];

          const text = (el.textContent || '').trim();
          const matched = allowedSections.find((s) => text === s || text.startsWith(s));
          inAllowed = !!matched;
          currentSection = matched ?? text;
        } else if (tag === 'h4') {
          // flush pending
          if (pendingName && currentSection) {
            out.push({ section: currentSection, name: pendingName, tagline: pendingTagline, contentText: pendingParts.join('\n') });
          }
          pendingName = ''; pendingTagline = ''; pendingParts = [];

          if (!inAllowed) continue;
          const fullText = (el.textContent || '').trim().replace(/^\d+\s*/, '');
          const m = fullText.match(new RegExp(`^(.+?)\\s+(${sourceMarkers.source}.*)$`));
          if (m) {
            pendingName = m[1].trim();
            pendingTagline = m[2].trim();
          } else {
            pendingName = fullText;
            pendingTagline = '';
          }
        } else if (tag === 'p') {
          if (pendingName) {
            pendingParts.push((el.textContent || '').trim());
          }
        }
      }
      // final flush
      if (pendingName && currentSection) {
        out.push({ section: currentSection, name: pendingName, tagline: pendingTagline, contentText: pendingParts.join('\n') });
      }
      return out;
    }, ALLOWED_SECTIONS);

    log.info('nextbanker', `extracted ${cards.length} raw cards from rendered DOM`);

    // 转成 RawInvestItem
    let rank = 0;
    for (const c of cards) {
      if (result.items.length >= maxItems) break;
      if (!c.name) continue;
      rank++;
      try {
        const tech = extractField(c.contentText, '技术');
        const business = extractField(c.contentText, '商业');
        const team = extractField(c.contentText, '团队');
        const operations = extractField(c.contentText, '运营');
        const funding = extractField(c.contentText, '融资');

        const daysMatch = c.contentText.match(/(\d+)\s*天前/);
        const hoursMatch = c.contentText.match(/(\d+)\s*小时前/);
        const daysAgo = daysMatch ? parseInt(daysMatch[1], 10) : hoursMatch ? 0 : 0;

        // 把 nextbanker "银发科技" 归一成目标站口径的 "银发经济"
        const category = c.section === '银发科技' ? '银发经济' : c.section;

        result.items.push({
          id: `nb-${rank}-${c.name.slice(0, 20).replace(/\s+/g, '-')}`,
          rank,
          name: c.name,
          tagline: c.tagline,
          category,
          tech: tech.slice(0, 500),
          business: business.slice(0, 500),
          team: team.slice(0, 300),
          operations: operations.slice(0, 300),
          funding: funding.slice(0, 200),
          daysAgo,
          source_url: BASE_URL,
          scrapedAt: new Date().toISOString(),
        });
      } catch (err) {
        result.errors.push(`card[${rank}] ${c.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    result.ok = result.items.length > 0;
    // 统计每个板块抓到多少
    const bySection: Record<string, number> = {};
    for (const it of result.items) bySection[it.category] = (bySection[it.category] ?? 0) + 1;
    log.ok('nextbanker', `extracted ${result.items.length} invest items: ${Object.entries(bySection).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  } catch (err) {
    log.err('nextbanker', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await ctx.close().catch(() => {});
  }

  result.durationMs = Date.now() - t0;
  return result;
}

function extractField(text: string, field: string): string {
  const re = new RegExp(
    `\\*{0,2}${field}[：:]\\*{0,2}\\s*([\\s\\S]*?)(?=\\*{0,2}(?:技术|商业|团队|运营|融资|信号)[：:]|$)`,
  );
  const m = text.match(re);
  return m ? m[1].trim().replace(/\n+/g, ' ').replace(/\s+/g, ' ') : '';
}

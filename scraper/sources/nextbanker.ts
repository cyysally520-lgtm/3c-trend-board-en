/**
 * NextBanker 爬虫
 * 入口：https://nextbanker.cn/
 * 策略：Playwright 渲染（项目卡片是 <project-card> Web Component，需要 hydrate）
 *
 * 渲染后页面结构：
 *   <h3>板块名</h3>          ← 顶级板块标题（AI硬件/具身智能/AI Agent/...）
 *   <div class="rh-sub">     ← 板块描述
 *   <project-card>           ← 该板块下的项目卡（多个）
 *     <div class="pc">
 *       <div class="pc-main">
 *         <div class="pc-body">
 *           <div><h4>项目名 <span class="stag">来源徽章</span></h4></div>
 *           <div class="tl">简介 <span class="pc-time">N天前</span></div>
 *           <div class="fd"><strong>技术</strong><span>内容</span></div>
 *           <div class="fd"><strong>商业</strong><span>内容</span></div>
 *           <div class="fd"><strong>团队</strong><span>内容</span></div>
 *           <div class="fd"><strong>运营</strong><span>内容</span></div>
 *           <div class="fd"><strong>融资</strong><span>内容</span></div>
 *           <div class="pc-stamp">来源 | 日期</div>
 *
 * 板块归属：用「文档顺序中卡片之前最近的 h3」做映射。
 */
import { newContext, gotoSafe } from '../lib/browser';
import { log } from '../lib/logger';
import type { RawInvestItem, ScrapeResult } from '../lib/types';

const BASE_URL = 'https://nextbanker.cn/';

// 白名单：只保留这些 nextbanker 板块（对齐目标站「AI 高潜」赛道）
// 注意 nextbanker 上是"银发科技"，会归一为"银发经济"
const ALLOWED_SECTIONS = [
  'AI硬件',
  '具身智能',
  'AI Agent',
  'AI教育',
  '银发科技',
  'AI医疗',
];

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
    await page.waitForTimeout(2500);

    // 页面侧解析：每张 project-card 抓 name / tagline / 5 字段，并通过文档顺序找最近的 h3 当 section
    const cards = await page.evaluate((allowedSections: string[]) => {
      const out: Array<{
        section: string;
        name: string;
        sourceBadge: string;
        summary: string;
        time: string;
        tech: string;
        business: string;
        team: string;
        operations: string;
        funding: string;
        stamp: string;
        projectId: string;
      }> = [];

      // 把 h3 和 project-card 按文档顺序拉出来
      const all = Array.from(document.querySelectorAll('h3, project-card'));
      let currentSection = '';
      let inAllowed = false;

      for (const el of all) {
        if (el.tagName === 'H3') {
          const t = (el.textContent || '').trim();
          const matched = allowedSections.find((s) => t === s || t.startsWith(s));
          inAllowed = !!matched;
          currentSection = matched ?? t;
          continue;
        }
        // project-card
        if (!inAllowed) continue;

        const pc = el.querySelector('.pc');
        if (!pc) continue;
        const pcBody = pc.querySelector('.pc-body');
        if (!pcBody) continue;

        const h4 = pcBody.querySelector('h4');
        const nameEl = h4?.querySelector('.pc-name-link') || h4;
        const stagEl = h4?.querySelector('.stag');
        const tlEl = pcBody.querySelector('.tl');
        const timeEl = tlEl?.querySelector('.pc-time');
        const stampEl = pcBody.querySelector('.pc-stamp');

        // .tl 的简介：克隆一份去掉 .pc-time 拿剩下纯文本
        let summary = '';
        if (tlEl) {
          const clone = tlEl.cloneNode(true) as Element;
          clone.querySelectorAll('.pc-time').forEach((x) => x.remove());
          summary = (clone.textContent || '').trim();
        }

        const fields: Record<string, string> = {};
        pcBody.querySelectorAll('.fd').forEach((fd) => {
          const label = fd.querySelector('strong')?.textContent?.trim() || '';
          const span = fd.querySelector(':scope > span');
          if (label && span) {
            // 去掉 .ind-tip（hover 提示），保留主体
            const cl = span.cloneNode(true) as Element;
            cl.querySelectorAll('.ind-tip').forEach((x) => x.remove());
            fields[label] = (cl.textContent || '').trim();
          }
        });

        const name = (nameEl?.textContent || '').trim();
        if (!name) continue;

        out.push({
          section: currentSection,
          name,
          sourceBadge: (stagEl?.textContent || '').trim(),
          summary,
          time: (timeEl?.textContent || '').trim(),
          tech: fields['技术'] || '',
          business: fields['商业'] || '',
          team: fields['团队'] || '',
          operations: fields['运营'] || '',
          funding: fields['融资'] || '',
          stamp: (stampEl?.textContent || '').trim(),
          projectId: pc.getAttribute('data-project-id') || '',
        });
      }
      return out;
    }, ALLOWED_SECTIONS);

    log.info('nextbanker', `extracted ${cards.length} cards from rendered DOM`);

    // 转成 RawInvestItem
    let rank = 0;
    let droppedNonGithub = 0;

    // EN 站独有过滤：「海外用户友好来源」白名单
    // 保留 GitHub / 开源 / arXiv / HuggingFace / Reddit / Kickstarter (KS) /
    // Indiegogo / Product Hunt (PH) / CES / iF Design / 顶会论文 (ICRA/CoRL/T-RO/
    // NeurIPS/ICLR/ICML/ACL) 等海外用户能找到对应英文资料的来源
    // 丢弃：XHS / 小红书 / B站 / 抖音 等中文社交，「招聘中」「极早期」等无来源标签
    const EN_FRIENDLY_RE = /(github|开源|arxiv|hugging\s*face|\bhf\b|reddit|\bks\b|kickstarter|indiegogo|product\s*hunt|\bph\b|\bces\b|if\s*design|icra|corl|t-ro|neurips|iclr|icml|\bacl\b|顶会|顶刊)/i;
    for (const c of cards) {
      if (result.items.length >= maxItems) break;

      // 只保留 EN-friendly 来源
      if (!EN_FRIENDLY_RE.test(c.sourceBadge)) {
        droppedNonGithub++;
        continue;
      }

      rank++;
      try {
        // daysAgo 解析
        const daysMatch = c.time.match(/(\d+)\s*天前/);
        const hoursMatch = c.time.match(/(\d+)\s*小时前/);
        const daysAgo = daysMatch ? parseInt(daysMatch[1], 10) : hoursMatch ? 0 : 0;

        // category 归一：nextbanker "银发科技" → "银发经济"
        const category = c.section === '银发科技' ? '银发经济' : c.section;

        result.items.push({
          // 用站点自带 projectId 当 id 后缀，比 rank+name 更稳（重跑保 id 一致，便于合并）
          id: c.projectId ? `nb-${c.projectId}` : `nb-${rank}-${c.name.slice(0, 20).replace(/\s+/g, '-')}`,
          rank,
          name: c.name,
          tagline: c.sourceBadge || c.summary.slice(0, 80) || '',
          category,
          tech: c.tech.slice(0, 500),
          business: c.business.slice(0, 500),
          team: c.team.slice(0, 300),
          operations: c.operations.slice(0, 300),
          funding: c.funding.slice(0, 200),
          daysAgo,
          source_url: BASE_URL,
          scrapedAt: new Date().toISOString(),
        });
      } catch (err) {
        result.errors.push(`card[${rank}] ${c.name}: ${err instanceof Error ? err.message : err}`);
      }
    }

    result.ok = result.items.length > 0;
    const bySection: Record<string, number> = {};
    for (const it of result.items) bySection[it.category] = (bySection[it.category] ?? 0) + 1;
    log.ok(
      'nextbanker',
      `extracted ${result.items.length} invest items (GitHub-only, dropped ${droppedNonGithub} non-GitHub): ${Object.entries(bySection).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    );
  } catch (err) {
    log.err('nextbanker', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    await ctx.close().catch(() => {});
  }

  result.durationMs = Date.now() - t0;
  return result;
}

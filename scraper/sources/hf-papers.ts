/**
 * Hugging Face Trending Papers 爬虫（仅 EN 站使用）
 * 入口：https://huggingface.co/papers/trending（Daily 默认视图）
 *
 * 策略：cheerio 静态 HTML 解析（HF 是 SSR，无需 Playwright）
 *
 * 字段映射 → InvestItem：
 *   id        : hf-${arxivId}
 *   name      : paper title
 *   tagline   : "HF · ★N" / "HF · ↑N votes"
 *   category  : 按 abstract+title 关键词匹配 5 个目标板块（命中 0 则丢弃）
 *   tech      : abstract（截 500 字）
 *   business  : 留空（论文无商业内容）
 *   team      : "{org} — {first author}" 或 "Submitted by {user}"
 *   operations: "GitHub {stars}★ · HF {votes}↑"
 *   funding   : 留空
 *   daysAgo   : 从 publication date 推算
 *
 * 板块过滤：白名单关键词，不命中即丢
 */
import * as cheerio from 'cheerio';
import { fetchText } from '../lib/http';
import { log } from '../lib/logger';
import type { RawInvestItem, ScrapeResult } from '../lib/types';

const BASE_URL = 'https://huggingface.co/papers/trending';

// 5 个板块的关键词白名单（abstract+title 命中任一即归入该板块）
// 优先级从上到下，第一个命中胜出
const SECTION_KEYWORDS: Array<{ name: string; patterns: RegExp[] }> = [
  {
    name: 'Embodied AI',
    patterns: [
      /\b(robot|robotic|robotics|manipulation|dexterous|locomotion|sim2real|sim-to-real|embodied|world model|VLA|vision[- ]language[- ]action|grasp|navigation|SLAM|drone|quadruped|humanoid)\b/i,
    ],
  },
  {
    name: 'AI Healthcare',
    patterns: [
      /\b(medical|medicine|clinical|healthcare|diagnosis|diagnostic|patient|EHR|radiology|pathology|drug|disease|biomarker|protein|genomic|genome|surgery|surgical|electrocardio|biomedi)/i,
    ],
  },
  {
    name: 'AI Education',
    patterns: [
      /\b(education|tutoring|tutor|student|learner|classroom|curriculum|teaching|MOOC|pedagog|EdTech|exam|grading)\b/i,
    ],
  },
  {
    name: 'AI Hardware',
    patterns: [
      /\b(edge inference|neural accelerator|NPU|FPGA|on-device|on device|embedded AI|chip design|TinyML|hardware-aware|hardware aware|silicon|memory bandwidth|kernel optimization|CUDA kernel|low[- ]power|energy efficient|quantiz)\b/i,
    ],
  },
  {
    name: 'AI Agent',
    patterns: [
      /\b(agent|autonomous|multi[- ]agent|orchestration|tool[- ]use|tool[- ]calling|LLM agent|reasoning agent|MCP|workflow|coding agent|web agent|computer use|browser agent|self-evolv|planning|task decomposition)\b/i,
    ],
  },
];

function classify(text: string): string | null {
  for (const { name, patterns } of SECTION_KEYWORDS) {
    if (patterns.some((p) => p.test(text))) return name;
  }
  return null;
}

function parseDaysAgo(dateStr: string): number {
  // dateStr 形如 "Published on May 22, 2026"
  const m = dateStr.match(/(\w+)\s+(\d{1,2}),\s+(\d{4})/);
  if (!m) return 0;
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6,
    aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const month = months[m[1].slice(0, 3).toLowerCase()];
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month === undefined) return 0;
  const published = new Date(year, month, day).getTime();
  const diffMs = Date.now() - published;
  return Math.max(0, Math.floor(diffMs / 86400000));
}

export async function scrapeHFPapers(maxItems = 100): Promise<ScrapeResult<RawInvestItem>> {
  const t0 = Date.now();
  const result: ScrapeResult<RawInvestItem> = {
    source: 'HFPapers',
    ok: false,
    items: [],
    errors: [],
    durationMs: 0,
  };

  try {
    log.info('hfpapers', `fetching: ${BASE_URL}`);
    const html = await fetchText(BASE_URL, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const $ = cheerio.load(html);

    let droppedNoCategory = 0;
    let rank = 0;
    const seen = new Set<string>();

    // HF 的 article 包含主条目和缩略图重复块——用 paperId 去重
    $('article').each((_, el) => {
      if (result.items.length >= maxItems) return false;
      try {
        const $el = $(el);
        // paperId 从 a[href^="/papers/"] 提取
        const paperHref = $el.find('a[href^="/papers/"]').first().attr('href') || '';
        const paperIdMatch = paperHref.match(/\/papers\/([\w.-]+)/);
        if (!paperIdMatch) return;
        const paperId = paperIdMatch[1];
        if (seen.has(paperId)) return;
        seen.add(paperId);

        const title = $el.find('h3 a').first().text().trim();
        if (!title) return;

        // abstract 在 h3 之后第一个 div p
        const abstract = $el.find('h3').nextAll('div').find('p').first().text().trim();

        // org（如 Microsoft Research）+ submitter
        const org = $el.find('a[href^="/"]:not([href^="/papers"]):not([href^="/login"]) span').first().text().trim();
        const submitter = $el.find('div:contains("Submitted by")').last().text().replace(/^.*Submitted by\s*/, '').trim();

        // 发布日期
        const dateText = ($el.find('span:contains("Published on")').first().text() || '').trim();

        // upvotes（"Upvote 233"）
        const upvoteText = $el.find('a[href*="/login?next"] div:contains("Upvote")').first().text() || '';
        const upvoteMatch = upvoteText.match(/(\d+)/);
        const votes = upvoteMatch ? parseInt(upvoteMatch[1], 10) : 0;

        // GitHub link + stars（"7.69k"）
        const ghLink = $el.find('a[href*="github.com"]').first().attr('href') || '';
        const ghStarsText = $el.find('a[href*="github.com"] span span').last().text().trim();

        // arXiv link
        const arxivLink = $el.find('a[href*="arxiv.org"]').first().attr('href') || '';

        // 分类：按 title + abstract 关键词匹配
        const text = `${title}\n${abstract}`;
        const category = classify(text);
        if (!category) {
          droppedNoCategory++;
          return;
        }

        // 拼装 tagline
        const tagParts: string[] = ['HF Papers'];
        if (ghStarsText) tagParts.push(`GitHub ${ghStarsText}★`);
        else if (votes > 0) tagParts.push(`↑${votes}`);
        const tagline = tagParts.join(' · ');

        // team 字段
        const teamParts: string[] = [];
        if (org) teamParts.push(org);
        if (submitter) teamParts.push(`submitted by ${submitter}`);
        const team = teamParts.join(' — ');

        // operations
        const opsParts: string[] = [];
        if (ghStarsText) opsParts.push(`GitHub ${ghStarsText}★`);
        if (votes > 0) opsParts.push(`HF ↑${votes}`);
        if (arxivLink) opsParts.push('arXiv');
        const operations = opsParts.join(' · ');

        rank++;
        result.items.push({
          id: `hf-${paperId}`,
          rank,
          name: title,
          tagline,
          category,
          tech: abstract.slice(0, 500),
          business: '',
          team: team.slice(0, 300),
          operations: operations.slice(0, 300),
          funding: '',
          daysAgo: parseDaysAgo(dateText),
          source_url: arxivLink || `https://huggingface.co${paperHref}`,
          scrapedAt: new Date().toISOString(),
        });
      } catch (err) {
        result.errors.push(`paper card: ${err instanceof Error ? err.message : err}`);
      }
    });

    result.ok = result.items.length > 0;

    const bySection: Record<string, number> = {};
    for (const it of result.items) bySection[it.category] = (bySection[it.category] ?? 0) + 1;
    log.ok(
      'hfpapers',
      `extracted ${result.items.length} papers (dropped ${droppedNoCategory} off-topic): ${Object.entries(bySection).map(([k, v]) => `${k}=${v}`).join(', ')}`,
    );
  } catch (err) {
    log.err('hfpapers', 'scrape failed', err);
    result.errors.push(err instanceof Error ? err.message : String(err));
  }

  result.durationMs = Date.now() - t0;
  return result;
}

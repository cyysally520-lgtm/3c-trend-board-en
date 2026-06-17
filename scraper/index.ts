/**
 * 爬虫总调度入口
 * 用法：
 *   npx tsx scraper/index.ts           # 跑所有
 *   npx tsx scraper/index.ts crowdsupply gizchina  # 仅跑指定的
 *
 * 流程：
 *   1. 并行（带限速）跑所有 source
 *   2. 按 kind 聚合（crowdfunding / news / startups）
 *   3. 按日期写盘
 *   4. 更新 manifest
 *   5. 清理 30 天前历史
 */
import pLimit from 'p-limit';
import { log } from './lib/logger';
import { saveSnapshot, updateManifest, pruneOldSnapshots } from './lib/storage';
import { closeBrowser } from './lib/browser';
import { translateCrowdToEn, translateNewsToEn, translateStartupsToEn, translateInvestsToEn } from './lib/translate';
import { scrapeCrowdSupply } from './sources/crowdsupply';
import { scrapeKickstarter } from './sources/kickstarter';
import { scrapeIndiegogo } from './sources/indiegogo';
import { scrapeMakuake } from './sources/makuake';
import { scrapeGizchina } from './sources/gizchina';
import { scrapeTechCrunch } from './sources/techcrunch';
import { scrapeVentureburn } from './sources/ventureburn';
import { scrapeTheVerge } from './sources/theverge';
import { scrapeYCombinator } from './sources/ycombinator';
import { scrapeNextbanker } from './sources/nextbanker';
import { scrapeHFPapers } from './sources/hf-papers';
import type { ScrapeResult } from './lib/types';

type Runner = () => Promise<ScrapeResult<any>>;

// 各源默认上限 200 条；nextbanker 不限（多板块需要全量）
const PER_SOURCE_LIMIT = 200;
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

// 注册表：name → (kind, runner)
const REGISTRY: Record<string, { kind: 'crowdfunding' | 'news' | 'startups' | 'investments'; run: Runner }> = {
  crowdsupply: { kind: 'crowdfunding',  run: () => scrapeCrowdSupply(PER_SOURCE_LIMIT) },
  kickstarter: { kind: 'crowdfunding',  run: () => scrapeKickstarter(PER_SOURCE_LIMIT) },
  indiegogo:   { kind: 'crowdfunding',  run: () => scrapeIndiegogo(PER_SOURCE_LIMIT) },
  makuake:     { kind: 'crowdfunding',  run: () => scrapeMakuake(PER_SOURCE_LIMIT) },
  gizchina:    { kind: 'news',          run: () => scrapeGizchina(PER_SOURCE_LIMIT) },
  techcrunch:  { kind: 'news',          run: () => scrapeTechCrunch(PER_SOURCE_LIMIT) },
  ventureburn: { kind: 'news',          run: () => scrapeVentureburn(PER_SOURCE_LIMIT) },
  theverge:    { kind: 'news',          run: () => scrapeTheVerge(PER_SOURCE_LIMIT) },
  ycombinator: { kind: 'startups',      run: () => scrapeYCombinator(PER_SOURCE_LIMIT) },
  nextbanker:  { kind: 'investments',   run: () => scrapeNextbanker(NO_LIMIT) },
  hfpapers:    { kind: 'investments',   run: () => scrapeHFPapers(100) },
};

async function main() {
  const argv = process.argv.slice(2).map((s) => s.toLowerCase());
  const selected = argv.length > 0 ? argv : Object.keys(REGISTRY);
  log.info('main', `will scrape: ${selected.join(', ')}`);

  const limit = pLimit(2); // 同时最多 2 个 source 在跑，避免本机 / GH runner 过载

  const results: Array<{ name: string; kind: string; result: ScrapeResult<any> }> = [];
  await Promise.all(
    selected.map((name) =>
      limit(async () => {
        const reg = REGISTRY[name];
        if (!reg) {
          log.warn('main', `unknown source: ${name} (available: ${Object.keys(REGISTRY).join(', ')})`);
          return;
        }
        const r = await reg.run();
        results.push({ name, kind: reg.kind, result: r });
      }),
    ),
  );

  // 按 kind 聚合（同一 kind 多 source 的可能合并，目前一对一）
  const byKind: Record<string, any[]> = { crowdfunding: [], news: [], startups: [], investments: [] };
  for (const { kind, result } of results) {
    byKind[kind].push(...result.items);
  }

  // ==== EN 站 AI 翻译流水线：把已有/新增的中文字段反向译为英文 ====
  // 顺序优先级：crowd > startup > invest > news（按用户要求 + Gemini 限流时的容错性）

  // 1. 众筹：category_tag_zh → category_tag_en，summary_zh → summary_en
  //    name 本来是英文（KS/CrowdSupply 数据），无需译
  if (byKind.crowdfunding.length > 0) {
    log.info('translate', 'translating crowdfunding tags + summaries to EN...');
    await translateCrowdToEn(byKind.crowdfunding);
  }

  // 2. 海外孵化（startups）：intro_zh → intro_en
  //    name / intro 本来是英文（YC/a16z 数据）
  if (byKind.startups.length > 0) {
    log.info('translate', 'translating startup intros to EN...');
    await translateStartupsToEn(byKind.startups);
  }

  // 3. AI 高潜（investments，nextbanker 中文源）：所有字段 → *_en
  //    最大 Gemini 消耗，放在前面以便用户重视
  if (byKind.investments.length > 0) {
    log.info('translate', 'translating invest items to EN (heavy)...');
    await translateInvestsToEn(byKind.investments);
  }

  // 4. 新闻：category_tag_zh → category_tag_en
  //    title / snippet 本来是英文，title_zh / snippet_zh 不需要回译
  if (byKind.news.length > 0) {
    log.info('translate', 'translating news category tags to EN...');
    await translateNewsToEn(byKind.news);
  }

  // 新闻：丢弃没图片或图片是占位的条目（Ventureburn/TheVerge 懒加载占位 SVG）
  if (byKind.news.length > 0) {
    const before = byKind.news.length;
    const isValid = (s: any) => {
      if (!s) return false;
      const v = String(s).trim();
      if (!v) return false;
      if (v.startsWith('data:image/svg')) return false;
      if (v.includes('placeholder')) return false;
      if (v.length < 20) return false;
      return true;
    };
    byKind.news = byKind.news.filter((it: any) => isValid(it.image));
    const dropped = before - byKind.news.length;
    if (dropped > 0) {
      log.info('main', `news: dropped ${dropped} item(s) without valid image, ${byKind.news.length} remaining`);
    }
  }

  // 写盘（即使本次某 kind 无新数据也调用 saveSnapshot，触发合并保留旧数据）
  for (const kind of ['crowdfunding', 'news', 'startups', 'investments'] as const) {
    await saveSnapshot(kind, byKind[kind]);
  }

  await updateManifest();
  await pruneOldSnapshots(30);

  await closeBrowser();

  // 打印总结
  log.ok('main', '=== Scrape Summary ===');
  for (const { name, result } of results) {
    log.ok('main', `  ${name}: ${result.ok ? 'OK' : 'FAIL'}, items=${result.items.length}, errors=${result.errors.length}, ${result.durationMs}ms`);
  }

  // 任意一个完全失败就以 1 退出（CI 友好）
  // 改为：只要有至少一个成功就退出码 0，避免部分失败阻断整个流程
  const successCount = results.filter((r) => r.result.ok).length;
  const failCount = results.filter((r) => !r.result.ok).length;
  if (failCount > 0) {
    log.warn('main', `${failCount} scraper(s) failed, but ${successCount} succeeded - data saved`);
  }
  process.exit(successCount > 0 ? 0 : 1);
}

main().catch((err) => {
  log.err('main', 'fatal', err);
  process.exit(2);
});
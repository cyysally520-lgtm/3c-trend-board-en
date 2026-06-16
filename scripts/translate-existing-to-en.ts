/**
 * EN 站一次性脚本：直接读 data/latest/*.json 调 Gemini 反向翻译为英文
 * 写回 *_en 字段，写回原文件 + 同步今日归档
 *
 * 用法: npx tsx scripts/translate-existing-to-en.ts
 *
 * 优先级：crowd > startups > invests > news（按用户保留下来的优先级，
 * 再考虑 invests 量大耗 API 配额，把它放后面）
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { promises as fs } from 'fs';
import path from 'path';
import {
  translateCrowdToEn,
  translateStartupsToEn,
  translateInvestsToEn,
  translateNewsToEn,
} from '../scraper/lib/translate';

async function processFile(rel: string, fn: (items: any[]) => Promise<void>): Promise<void> {
  const fp = path.resolve('data/latest', rel);
  const raw = await fs.readFile(fp, 'utf8');
  const obj = JSON.parse(raw);
  if (!Array.isArray(obj.items)) return;
  console.log(`\n=== ${rel} (${obj.items.length} items) ===`);
  await fn(obj.items);
  await fs.writeFile(fp, JSON.stringify(obj, null, 2), 'utf8');

  const today = new Date().toISOString().slice(0, 10);
  const archive = path.resolve(`data/${today}`, rel);
  try {
    await fs.access(archive);
    await fs.writeFile(archive, JSON.stringify(obj, null, 2), 'utf8');
    console.log(`  also wrote ${path.relative(process.cwd(), archive)}`);
  } catch {}
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY not set (.env.local)');
    process.exit(1);
  }
  // 顺序：crowd → startups → news → invests（重的最后）
  await processFile('crowdfunding.json', translateCrowdToEn);
  await processFile('startups.json', translateStartupsToEn);
  await processFile('news.json', translateNewsToEn);
  await processFile('investments.json', translateInvestsToEn);
  console.log('\ndone.');
}

main().catch((e) => { console.error(e); process.exit(1); });

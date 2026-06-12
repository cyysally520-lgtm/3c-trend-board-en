/**
 * 一次性脚本：直接读 data/latest/{startups,crowdfunding,news}.json
 * 调用 Gemini 翻译已有数据，写回原文件
 *
 * 用法: npx tsx scripts/translate-existing.ts
 */
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config(); // 兜底：再加载 .env

import { promises as fs } from 'fs';
import path from 'path';
import { translateCrowdNames, translateStartupIntros, translateNewsTitles } from '../scraper/lib/translate';

async function processFile(rel: string, kind: 'crowdfunding' | 'startups' | 'news'): Promise<void> {
  const fp = path.resolve('data/latest', rel);
  const raw = await fs.readFile(fp, 'utf8');
  const obj = JSON.parse(raw);
  if (!Array.isArray(obj.items)) return;

  console.log(`\n=== ${rel} (${obj.items.length} items) ===`);
  if (kind === 'crowdfunding') {
    await translateCrowdNames(obj.items);
  } else if (kind === 'startups') {
    await translateStartupIntros(obj.items);
  } else if (kind === 'news') {
    await translateNewsTitles(obj.items);
  }
  await fs.writeFile(fp, JSON.stringify(obj, null, 2), 'utf8');

  // 同步把 latest/ 内容写回今天的归档（保持 manifest 一致）
  const today = new Date().toISOString().slice(0, 10);
  const archivePath = path.resolve(`data/${today}`, rel);
  try {
    await fs.access(archivePath);
    await fs.writeFile(archivePath, JSON.stringify(obj, null, 2), 'utf8');
    console.log(`  also wrote ${path.relative(process.cwd(), archivePath)}`);
  } catch {
    // 今天还没归档，跳过
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error('GEMINI_API_KEY 未设置（.env.local 检查一下）');
    process.exit(1);
  }
  await processFile('startups.json', 'startups');
  await processFile('crowdfunding.json', 'crowdfunding');
  await processFile('news.json', 'news');
  console.log('\ndone.');
}

main().catch((e) => { console.error(e); process.exit(1); });

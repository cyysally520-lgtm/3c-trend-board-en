/**
 * 一次性清洗：把 EN 站数据里被污染的 *_en 字段（实际是中文原文）删掉
 * 这种污染来自上一版 translateBatchToEn 失败时返回原文写进了 _en。
 *
 * 用法：npx tsx scripts/clean-fake-en.ts
 */
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'data');

const isMostlyChinese = (s: string): boolean => {
  if (!s) return false;
  const han = (s.match(/[一-龥]/g) || []).length;
  return han / s.length > 0.3;
};

const isMostlyChineseList = (arr: any): boolean => {
  if (!Array.isArray(arr) || arr.length === 0) return false;
  return arr.every((x) => typeof x === 'string' && isMostlyChinese(x));
};

function cleanItem(it: any, kind: string): boolean {
  let changed = false;

  // 字符串字段
  const strFields: Record<string, string[]> = {
    investments: ['name_en', 'category_en', 'tech_en', 'business_en', 'team_en', 'operations_en', 'funding_en'],
    crowdfunding: ['category_tag_en'],
    news: ['category_tag_en'],
    startups: [],
  };
  for (const f of strFields[kind] || []) {
    const v = it[f];
    if (typeof v === 'string' && isMostlyChinese(v)) {
      delete it[f];
      changed = true;
    }
  }

  // 数组字段（summary_en / intro_en）
  const arrFields: Record<string, string[]> = {
    investments: [],
    crowdfunding: ['summary_en'],
    news: [],
    startups: ['intro_en'],
  };
  for (const f of arrFields[kind] || []) {
    if (isMostlyChineseList(it[f])) {
      delete it[f];
      changed = true;
    }
  }

  return changed;
}

async function cleanFile(filePath: string, kind: string): Promise<{ before: number; cleaned: number } | null> {
  let raw: string;
  try { raw = await fs.readFile(filePath, 'utf8'); } catch { return null; }
  let obj: any;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(obj?.items)) return null;

  let cleaned = 0;
  for (const it of obj.items) {
    if (cleanItem(it, kind)) cleaned++;
  }
  if (cleaned === 0) return { before: obj.items.length, cleaned: 0 };

  await fs.writeFile(filePath, JSON.stringify(obj, null, 2), 'utf8');
  return { before: obj.items.length, cleaned };
}

async function main() {
  const KINDS: Array<[string, string]> = [
    ['crowdfunding.json', 'crowdfunding'],
    ['news.json', 'news'],
    ['startups.json', 'startups'],
    ['investments.json', 'investments'],
  ];

  // latest + 各日期
  const dirs = ['latest'];
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name)) dirs.push(e.name);
  }

  console.log(`scanning ${dirs.length} dirs × ${KINDS.length} kinds...\n`);
  let total = 0;
  for (const dir of dirs) {
    for (const [name, kind] of KINDS) {
      const fp = path.join(ROOT, dir, name);
      const r = await cleanFile(fp, kind);
      if (r && r.cleaned > 0) {
        console.log(`  [clean] ${dir}/${name}: ${r.cleaned} item(s) had Chinese in *_en, removed`);
        total += r.cleaned;
      }
    }
  }
  console.log(`\nsummary: removed Chinese pollution from ${total} item(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

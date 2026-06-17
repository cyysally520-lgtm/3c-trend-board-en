/**
 * EN 站一次性清洗：data/{latest,YYYY-MM-DD}/investments.json
 *
 * 移除三类条目：
 *   1. 「视觉空白」卡片：tech/business/team/operations/funding 5 字段中有内容的少于 2 个
 *   2. 银发经济板块（用户决定不要这个 tab 的数据）
 *   3. 中文社交来源 (XHS / 小红书 / B站 / 抖音) —— EN 站对海外用户无意义
 *
 * 用法：npx tsx scripts/clean-en-invest.ts
 */
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'data');

const CORE_FIELDS = ['tech', 'business', 'team', 'operations', 'funding'];

function isVisuallyBlank(it: any): boolean {
  let count = 0;
  for (const f of CORE_FIELDS) {
    const v = String(it[f] ?? '').trim();
    const en = String(it[f + '_en'] ?? '').trim();
    if (v || en) count++;
  }
  return count < 2; // 少于 2 个字段有内容 = 视觉空白
}

function isSeniorEconomy(it: any): boolean {
  const cat = String(it.category ?? '') + ' ' + String(it.category_en ?? '');
  return cat.includes('银发') || /silver\s*economy/i.test(cat) || cat.includes('老年');
}

function isChineseSocialOnly(it: any): boolean {
  const tag = String(it.tagline ?? '');
  // 黑名单（硬规则）：B 站 / XHS / 小红书 / 抖音等，即使含"开源"/GitHub 也删
  return /(B\s*站|bilibili|XHS|小红书|抖音|tiktok|kuaishou|快手)/i.test(tag);
}

async function cleanFile(filePath: string): Promise<{ before: number; after: number; reasons: Record<string, number> } | null> {
  let raw: string;
  try { raw = await fs.readFile(filePath, 'utf8'); } catch { return null; }
  let obj: any;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(obj?.items)) return null;

  const before = obj.items.length;
  const reasons = { blank: 0, senior: 0, social: 0 };
  obj.items = obj.items.filter((it: any) => {
    if (isVisuallyBlank(it)) { reasons.blank++; return false; }
    if (isSeniorEconomy(it)) { reasons.senior++; return false; }
    if (isChineseSocialOnly(it)) { reasons.social++; return false; }
    return true;
  });
  obj.count = obj.items.length;
  const after = obj.items.length;

  if (after === before) return { before, after, reasons };
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2), 'utf8');
  return { before, after, reasons };
}

async function main() {
  const targets: string[] = [path.join(ROOT, 'latest', 'investments.json')];
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name)) {
      targets.push(path.join(ROOT, e.name, 'investments.json'));
    }
  }

  console.log(`scanning ${targets.length} investments.json file(s)...\n`);
  let totalBefore = 0, totalAfter = 0, changed = 0;
  for (const t of targets) {
    const r = await cleanFile(t);
    if (!r) { console.log(`  [skip] ${path.relative(ROOT, t)}`); continue; }
    const dropped = r.before - r.after;
    const rel = path.relative(ROOT, t);
    if (dropped > 0) {
      console.log(`  [clean] ${rel}: ${r.before} → ${r.after} (-${dropped})  blank=${r.reasons.blank} senior=${r.reasons.senior} social=${r.reasons.social}`);
      changed++;
    } else {
      console.log(`  [ok]    ${rel}: ${r.before}`);
    }
    totalBefore += r.before;
    totalAfter += r.after;
  }
  console.log(`\nsummary: ${totalBefore} → ${totalAfter} (-${totalBefore - totalAfter}) across ${changed} file(s)`);
}

main().catch((e) => { console.error(e); process.exit(1); });

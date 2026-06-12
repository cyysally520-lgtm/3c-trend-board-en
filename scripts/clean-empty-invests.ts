/**
 * 一次性清洗：删除 investments 中所有"骨架"条目
 * 即 tech/business/team/funding 4 个核心字段全空的 nextbanker 条目
 * 这种条目是早期解析逻辑不全留下的，前端渲染几乎空白
 *
 * 用法: npx tsx scripts/clean-empty-invests.ts
 * 修改: data/latest/investments.json + data/YYYY-MM-DD/investments.json
 */
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'data');

function isSkeleton(it: any): boolean {
  if (!it) return true;
  const t = (it.tech || '').trim();
  const b = (it.business || '').trim();
  const m = (it.team || '').trim();
  const f = (it.funding || '').trim();
  return !t && !b && !m && !f;
}

async function cleanFile(filePath: string): Promise<{ before: number; after: number } | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(obj?.items)) return null;

  const before = obj.items.length;
  obj.items = obj.items.filter((it: any) => !isSkeleton(it));
  obj.count = obj.items.length;
  const after = obj.items.length;

  if (after === before) return { before, after };
  await fs.writeFile(filePath, JSON.stringify(obj, null, 2), 'utf8');
  return { before, after };
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
    if (!r) {
      console.log(`  [skip] ${path.relative(ROOT, t)}`);
      continue;
    }
    const dropped = r.before - r.after;
    const rel = path.relative(ROOT, t);
    if (dropped > 0) {
      console.log(`  [clean] ${rel}: ${r.before} → ${r.after} (-${dropped})`);
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

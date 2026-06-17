/**
 * 一次性：清掉 Indiegogo / Makuake 的假数据
 *  - Indiegogo: progress_pct === 100 且 raised > 0 时（旧硬写规则），重置为 0
 *    （新爬虫会重新填真实值；前端会自动隐藏 0）
 *  - Makuake: price 含 ￥ 且 = raised 字符串时，重置为 ''
 */
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'data');

async function cleanFile(fp: string): Promise<{ before: number; fixed: number } | null> {
  let raw: string;
  try { raw = await fs.readFile(fp, 'utf8'); } catch { return null; }
  let obj: any;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!Array.isArray(obj?.items)) return null;

  let fixed = 0;
  for (const it of obj.items) {
    // Indiegogo 假 progress_pct=100
    if (it.platform === 'Indiegogo' && it.progress_pct === 100 && it.raised > 0) {
      it.progress_pct = 0;
      fixed++;
    }
    // Makuake price = ￥ + raised
    if (it.platform === 'Makuake' && typeof it.price === 'string') {
      const priceNum = parseInt((it.price || '').replace(/[^\d]/g, ''), 10);
      if (priceNum && Math.abs(priceNum - (it.raised || 0)) < 10) {
        it.price = '';
        fixed++;
      }
    }
  }

  if (fixed === 0) return { before: obj.items.length, fixed: 0 };
  await fs.writeFile(fp, JSON.stringify(obj, null, 2), 'utf8');
  return { before: obj.items.length, fixed };
}

async function main() {
  const targets: string[] = [path.join(ROOT, 'latest', 'crowdfunding.json')];
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name)) {
      targets.push(path.join(ROOT, e.name, 'crowdfunding.json'));
    }
  }

  console.log(`scanning ${targets.length} crowdfunding.json file(s)...\n`);
  let totalFixed = 0;
  for (const t of targets) {
    const r = await cleanFile(t);
    if (!r) continue;
    if (r.fixed > 0) {
      console.log(`  [fix] ${path.relative(ROOT, t)}: ${r.fixed} item(s) cleaned`);
      totalFixed += r.fixed;
    }
  }
  console.log(`\nsummary: cleaned ${totalFixed} fake values total`);
}

main().catch((e) => { console.error(e); process.exit(1); });

/**
 * 一次性：从历史归档（2026-06-10 之后）回填 latest/crowdfunding.json
 * 里 KS 条目缺失的 price 字段。按 id 匹配。
 */
import { promises as fs } from 'fs';
import path from 'path';

const ROOT = path.resolve(process.cwd(), 'data');

async function readJson(p: string): Promise<any | null> {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return null; }
}

async function main() {
  const latestPath = path.join(ROOT, 'latest', 'crowdfunding.json');
  const latest = await readJson(latestPath);
  if (!latest?.items) { console.error('no latest'); process.exit(1); }

  // 收集所有归档的 id → price（最新归档优先）
  const dates = (await fs.readdir(ROOT, { withFileTypes: true }))
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse(); // 最新在前

  const idToPrice = new Map<string, string>();
  for (const d of dates) {
    const obj = await readJson(path.join(ROOT, d, 'crowdfunding.json'));
    if (!obj?.items) continue;
    for (const it of obj.items) {
      if (it.platform === 'Kickstarter' && it.id && it.price && !idToPrice.has(it.id)) {
        idToPrice.set(it.id, it.price);
      }
    }
  }
  console.log(`从历史归档收集 ${idToPrice.size} 个 KS price 条目`);

  // 回填 latest
  let filled = 0;
  for (const it of latest.items) {
    if (it.platform === 'Kickstarter' && !it.price && idToPrice.has(it.id)) {
      it.price = idToPrice.get(it.id);
      filled++;
    }
  }
  await fs.writeFile(latestPath, JSON.stringify(latest, null, 2), 'utf8');
  console.log(`latest 回填了 ${filled} 个 price`);

  // 同步今天归档
  const today = new Date().toISOString().slice(0, 10);
  const todayPath = path.join(ROOT, today, 'crowdfunding.json');
  try {
    await fs.access(todayPath);
    const today_obj = await readJson(todayPath);
    if (today_obj?.items) {
      let f2 = 0;
      for (const it of today_obj.items) {
        if (it.platform === 'Kickstarter' && !it.price && idToPrice.has(it.id)) {
          it.price = idToPrice.get(it.id);
          f2++;
        }
      }
      await fs.writeFile(todayPath, JSON.stringify(today_obj, null, 2), 'utf8');
      console.log(`${today} 归档回填了 ${f2} 个`);
    }
  } catch {}
}

main().catch((e) => { console.error(e); process.exit(1); });

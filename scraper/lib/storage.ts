/**
 * 数据存储层：按日期归档 + manifest 索引
 *
 * 目录结构:
 *   data/
 *     manifest.json                          ← 索引：列出所有可用日期
 *     latest/                                ← 软链作用：最新一次数据
 *       crowdfunding.json
 *       news.json
 *       startups.json
 *     2026-06-08/                            ← 按日期归档（最多保留 30 天）
 *       crowdfunding.json
 *       news.json
 *       startups.json
 */
import { promises as fs } from 'fs';
import path from 'path';
import dayjs from 'dayjs';
import { log } from './logger';

const ROOT = path.resolve(process.cwd(), 'data');
const RETENTION_DAYS = 30;

export type DataKind = 'crowdfunding' | 'news' | 'startups' | 'investments';

export interface Manifest {
  updatedAt: string;
  dates: string[];      // 倒序：最新在前
  kinds: DataKind[];
  counts: Record<string, Partial<Record<DataKind, number>>>;
}

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

export async function saveSnapshot<T>(kind: DataKind, items: T[], date?: string): Promise<void> {
  const d = date ?? dayjs().format('YYYY-MM-DD');
  const dayDir = path.join(ROOT, d);
  const latestDir = path.join(ROOT, 'latest');
  await ensureDir(dayDir);
  await ensureDir(latestDir);

  // ★ 合并策略：读取 latest/ 已有数据，按 id 去重合并
  // 新抓到的条目覆盖同 id 旧条目，未抓到的旧条目保留不丢失
  const merged = await mergeWithExisting(kind, items, latestDir);

  const payload = JSON.stringify({ date: d, kind, count: merged.length, items: merged }, null, 2);
  await fs.writeFile(path.join(dayDir, `${kind}.json`), payload, 'utf8');
  await fs.writeFile(path.join(latestDir, `${kind}.json`), payload, 'utf8');

  log.ok('storage', `saved ${kind} (${merged.length} items, merged from ${items.length} new) → ${d}`);
}

/**
 * 字段级深合并：当新值是「无效空值」时保留旧值
 *
 * 关键设计：只对**容易抓取失败的字符串/数组字段**做兜底。
 * 数字字段（raised / progress_pct / backers / daysLeft）即使新值为 0
 * 也直接采用新值——众筹真的结束 / 项目下架时数字就该归零。
 *
 * 兜底字段：
 *   - 空字符串：name / price / tagline / image / category 等所有 string 字段
 *   - 已翻译：所有 *_en 后缀字段（重抓时若为空说明翻译失败，不要覆盖）
 *   - 空数组：summary_zh / summary_en / intro_zh / intro_en 等
 */
function mergeFields<T extends Record<string, any>>(oldItem: T, newItem: T): T {
  const result: Record<string, any> = { ...oldItem };
  for (const key of Object.keys(newItem)) {
    const newVal = newItem[key];
    const oldVal = oldItem[key];

    // 数字字段：新值原样采用（0 也是合法值）
    if (typeof newVal === 'number' || typeof newVal === 'boolean') {
      result[key] = newVal;
      continue;
    }

    // 字符串：新值为空字符串且旧值非空 → 保留旧值
    if (typeof newVal === 'string') {
      if (newVal.trim() === '' && typeof oldVal === 'string' && oldVal.trim() !== '') {
        continue; // 保留旧值
      }
      result[key] = newVal;
      continue;
    }

    // 数组：新值为空且旧值非空 → 保留旧值
    if (Array.isArray(newVal)) {
      if (newVal.length === 0 && Array.isArray(oldVal) && oldVal.length > 0) {
        continue; // 保留旧值
      }
      result[key] = newVal;
      continue;
    }

    // null / undefined：保留旧值
    if (newVal === null || newVal === undefined) {
      if (oldVal !== null && oldVal !== undefined) continue;
    }

    result[key] = newVal;
  }
  return result as T;
}

/**
 * 将本次新抓取的 items 与 latest/ 已有数据按 id 合并
 * - 同 id：字段级深合并（新值空 → 保留旧值；非空 → 覆盖）
 * - 旧有但本次未抓到的条目：保留（防止部分源失败导致数据丢失）
 */
async function mergeWithExisting<T>(kind: DataKind, newItems: T[], latestDir: string): Promise<T[]> {
  const filePath = path.join(latestDir, `${kind}.json`);
  let existingItems: T[] = [];
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const obj = JSON.parse(raw);
    if (Array.isArray(obj?.items)) {
      existingItems = obj.items;
    }
  } catch {
    // 文件不存在或解析失败，视为无旧数据
  }

  if (existingItems.length === 0) return newItems;

  // 按 id 建立旧数据索引
  const mergedMap = new Map<string, T>();
  for (const item of existingItems) {
    const id = (item as any).id;
    if (id) mergedMap.set(String(id), item);
  }

  // 新数据：同 id 做字段级合并；新 id 直接加入
  let newCount = 0;
  let updateCount = 0;
  for (const item of newItems) {
    const id = (item as any).id;
    if (!id) continue;
    const key = String(id);
    const existing = mergedMap.get(key);
    if (existing) {
      mergedMap.set(key, mergeFields(existing as any, item as any));
      updateCount++;
    } else {
      mergedMap.set(key, item);
      newCount++;
    }
  }

  const keptCount = mergedMap.size - newCount - updateCount;
  log.info('storage', `merge ${kind}: ${existingItems.length} existing + ${newItems.length} new → ${mergedMap.size} merged (new=${newCount}, updated=${updateCount}, kept=${keptCount})`);

  return Array.from(mergedMap.values());
}

export async function updateManifest(): Promise<Manifest> {
  await ensureDir(ROOT);
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  const dateDirs = entries
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();

  const counts: Manifest['counts'] = {};
  for (const d of dateDirs) {
    counts[d] = {};
    for (const kind of ['crowdfunding', 'news', 'startups', 'investments'] as DataKind[]) {
      const f = path.join(ROOT, d, `${kind}.json`);
      try {
        const raw = await fs.readFile(f, 'utf8');
        const obj = JSON.parse(raw);
        counts[d][kind] = obj.count ?? (Array.isArray(obj.items) ? obj.items.length : 0);
      } catch {
        // 当天该类没有
      }
    }
  }

  const manifest: Manifest = {
    updatedAt: new Date().toISOString(),
    dates: dateDirs,
    kinds: ['crowdfunding', 'news', 'startups', 'investments'],
    counts,
  };
  await fs.writeFile(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  log.ok('storage', `manifest updated (${dateDirs.length} dates)`);
  return manifest;
}

/**
 * 清理超过 retentionDays 的旧数据目录
 */
export async function pruneOldSnapshots(retentionDays = RETENTION_DAYS): Promise<void> {
  await ensureDir(ROOT);
  const cutoff = dayjs().subtract(retentionDays, 'day');
  const entries = await fs.readdir(ROOT, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(e.name)) continue;
    if (dayjs(e.name).isBefore(cutoff)) {
      await fs.rm(path.join(ROOT, e.name), { recursive: true, force: true });
      log.info('storage', `pruned old snapshot: ${e.name}`);
    }
  }
}

export function dataRoot() {
  return ROOT;
}
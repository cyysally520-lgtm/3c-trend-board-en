/**
 * AI 翻译模块（双 provider 容错）
 *
 * 顺序：
 *   1. Gemini 多 key 轮询（GEMINI_API_KEY / _2 / _3 ...）
 *   2. Gemini 全部 429 / 失败 → fallback 到 Deepseek（DEEPSEEK_API_KEY）
 *   3. Deepseek 也失败 → 抛错，本轮翻译跳过
 *
 * Deepseek 当前用 deepseek-chat 模型，OpenAI 兼容接口，无日免费限。
 */
import { log } from './logger';

// 注意：不在模块顶部读 env，避免在 dotenv.config 之前就被冻结成空串
function getGeminiKeys(): string[] {
  const keys: string[] = [];
  const primary = process.env.GEMINI_API_KEY;
  if (primary) keys.push(primary);
  for (let i = 2; i <= 10; i++) {
    const v = process.env[`GEMINI_API_KEY_${i}`];
    if (v) keys.push(v);
  }
  return keys;
}

function getDeepseekKey(): string {
  return process.env.DEEPSEEK_API_KEY || '';
}

// 模块级状态：当前用哪个 Gemini key（轮询起点），失败时累进
let currentKeyIdx = 0;

/**
 * 调用 Gemini REST API（多 key 自动轮询 + 429 重试）
 * 全部 key 都失败时返回 null（让上层 fallback 到 Deepseek）
 */
async function callGeminiOnly(prompt: string): Promise<string | null> {
  const keys = getGeminiKeys();
  if (keys.length === 0) return null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const key = keys[currentKeyIdx % keys.length];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
        }),
      });

      if (response.status === 429) {
        log.info('translate', `gemini key #${(currentKeyIdx % keys.length) + 1} hit 429, rotating...`);
        currentKeyIdx++;
        continue;
      }

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        log.warn('translate', `gemini ${response.status}: ${errText.slice(0, 200)}`);
        currentKeyIdx++;
        continue;
      }

      const data = await response.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts.map((p: any) => p.text || '').join('').trim();
      if (text) return text;
      currentKeyIdx++;
    } catch (err) {
      log.warn('translate', `gemini fetch failed: ${err instanceof Error ? err.message : err}`);
      currentKeyIdx++;
    }
  }
  return null;
}

/**
 * 调用 Deepseek API（OpenAI 兼容）
 */
async function callDeepseek(prompt: string): Promise<string | null> {
  const key = getDeepseekKey();
  if (!key) return null;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      log.warn('translate', `deepseek ${response.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim() || '';
    return text || null;
  } catch (err) {
    log.warn('translate', `deepseek fetch failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * 综合调用：先 Gemini，全限流/失败就切 Deepseek
 * 两边都失败返回空串
 */
async function callGemini(prompt: string): Promise<string> {
  const geminiKeys = getGeminiKeys();
  const dsKey = getDeepseekKey();

  if (geminiKeys.length === 0 && !dsKey) {
    log.warn('translate', 'no API keys configured (GEMINI_API_KEY / DEEPSEEK_API_KEY), skipping');
    return '';
  }

  // 1. Gemini 优先
  if (geminiKeys.length > 0) {
    const text = await callGeminiOnly(prompt);
    if (text) return text;
  }

  // 2. fallback: Deepseek
  if (dsKey) {
    log.info('translate', 'falling back to deepseek...');
    const text = await callDeepseek(prompt);
    if (text) return text;
  }

  // 两边都失败
  throw new Error('both Gemini and Deepseek failed');
}

/**
 * 翻译众筹产品名称为中文简称
 */
export async function translateCrowdNames(
  items: Array<{ name: string; name_zh?: string }>
): Promise<void> {
  // 过滤出需要翻译的项目
  const toTranslate = items.filter(it => !it.name_zh || it.name_zh === it.name);
  if (toTranslate.length === 0) {
    log.info('translate', 'all product names already translated');
    return;
  }

  log.info('translate', `translating ${toTranslate.length} product names...`);

  // 分批翻译（每批最多20个）
  const BATCH = 20;
  for (let i = 0; i < toTranslate.length; i += BATCH) {
    const batch = toTranslate.slice(i, i + BATCH);
    const names = batch.map(it => it.name);

    try {
      const prompt = `将以下英文产品名翻译为简洁中文简称（4-8个字），保持专业术语准确。每行一个，只输出翻译结果，不要序号：\n${names.join('\n')}`;

      const text = await callGemini(prompt);
      if (!text) continue;

      const lines = text.split('\n').map(l => l.replace(/^\d+[\.\)、]\s*/, '').trim()).filter(Boolean);

      for (let j = 0; j < batch.length && j < lines.length; j++) {
        batch[j].name_zh = lines[j];
      }

      log.ok('translate', `translated ${Math.min(batch.length, lines.length)} product names (batch ${Math.floor(i / BATCH) + 1})`);
    } catch (err) {
      log.warn('translate', `batch translate failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * 为众筹产品生成中文AI解读摘要
 */
export async function generateCrowdSummaries(
  items: Array<{ name: string; name_zh?: string; summary_zh: string[]; blurb?: string }>
): Promise<void> {
  // 过滤出需要生成摘要的项目
  const toGen = items.filter(it => it.summary_zh.length === 0 || it.summary_zh[0] === it.name);
  if (toGen.length === 0) {
    log.info('translate', 'all summaries already generated');
    return;
  }

  log.info('translate', `generating summaries for ${toGen.length} items...`);

  const BATCH = 10;
  for (let i = 0; i < toGen.length; i += BATCH) {
    const batch = toGen.slice(i, i + BATCH);
    const descriptions = batch.map(it => `${it.name}${it.blurb ? ': ' + it.blurb.slice(0, 100) : ''}`);

    try {
      const prompt = `为以下众筹产品各写3条中文AI解读要点（每条8-15字），简洁专业，分点用•分隔。格式：产品名→要点1•要点2•要点3\n${descriptions.join('\n')}`;

      const text = await callGemini(prompt);
      if (!text) continue;

      const lines = text.split('\n').filter(Boolean);

      for (let j = 0; j < batch.length && j < lines.length; j++) {
        const line = lines[j];
        // 提取→后面的内容
        const afterArrow = line.includes('→') ? line.split('→').slice(1).join('→') : line;
        // 按•分隔
        const points = afterArrow.split('•').map(p => p.trim()).filter(p => p.length > 0);
        if (points.length > 0) {
          batch[j].summary_zh = points;
        }
      }

      log.ok('translate', `generated summaries for ${batch.length} items (batch ${Math.floor(i / BATCH) + 1})`);
    } catch (err) {
      log.warn('translate', `summary generation failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * 翻译新闻标题为中文
 * 参考目标站「硅谷听见」的样式：英文原标题下方紧跟中文翻译
 */
export async function translateNewsTitles(
  items: Array<{ title: string; title_zh?: string }>
): Promise<void> {
  // 跳过：① 已译过 ② 标题本身就是中文（gizchina 等中文源）
  const isMostlyChinese = (s: string) => {
    const han = (s.match(/[一-龥]/g) || []).length;
    return han / Math.max(1, s.length) > 0.3;
  };
  const toTranslate = items.filter(
    (it) => it.title && !isMostlyChinese(it.title) && (!it.title_zh || it.title_zh === it.title)
  );
  if (toTranslate.length === 0) {
    log.info('translate', 'all news titles already translated or are Chinese');
    return;
  }

  log.info('translate', `translating ${toTranslate.length} news titles...`);

  const BATCH = 20;
  for (let i = 0; i < toTranslate.length; i += BATCH) {
    const batch = toTranslate.slice(i, i + BATCH);
    const titles = batch.map((it) => it.title);

    try {
      const prompt = `将以下英文科技新闻标题翻译成简洁的中文标题（保持原意、专业术语准确、不超过 30 字）。每行一个，按顺序对应，只输出翻译结果，不要序号或引号：\n${titles.join('\n')}`;
      const text = await callGemini(prompt);
      if (!text) continue;

      const lines = text
        .split('\n')
        .map((l) => l.replace(/^\d+[\.\)、]\s*/, '').replace(/^["「『]|["」』]$/g, '').trim())
        .filter(Boolean);

      for (let j = 0; j < batch.length && j < lines.length; j++) {
        batch[j].title_zh = lines[j];
      }

      log.ok(
        'translate',
        `translated ${Math.min(batch.length, lines.length)} news titles (batch ${Math.floor(i / BATCH) + 1})`,
      );
    } catch (err) {
      log.warn('translate', `news batch translate failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/**
 * 把 YC / a16z 创业公司的英文 intro 翻译成中文要点 bullets
 * 参考目标站「海外孵化」：每张卡显示 3 条中文 bullet 作为「AI 独角兽企业分析」
 *
 * 输入字段：name + intro（英文一句话）
 * 写入字段：intro_zh（中文 bullet 数组，2-3 条）
 */
export async function translateStartupIntros(
  items: Array<{ name: string; intro: string; intro_zh: string[] }>,
): Promise<void> {
  // 跳过：① 已有真正的中文 bullet（intro_zh 第 0 条不是英文 intro 本身）
  const isMostlyChinese = (s: string) => {
    const han = (s.match(/[一-龥]/g) || []).length;
    return han / Math.max(1, s.length) > 0.3;
  };
  const toGen = items.filter((it) => {
    if (!it.intro) return false;
    if (it.intro_zh && it.intro_zh.length > 0 && isMostlyChinese(it.intro_zh[0])) return false;
    return true;
  });
  if (toGen.length === 0) {
    log.info('translate', 'all startup intros already in Chinese');
    return;
  }

  log.info('translate', `generating Chinese analysis for ${toGen.length} startup intros...`);

  const BATCH = 10;
  for (let i = 0; i < toGen.length; i += BATCH) {
    const batch = toGen.slice(i, i + BATCH);
    const descriptions = batch.map((it) => `${it.name}: ${it.intro.slice(0, 200)}`);

    try {
      const prompt = `你是行业分析师，对每个 YC / a16z 投资的创业公司，结合其英文 intro 写 2-3 条中文要点（每条 10-25 字，专业精炼，关注：技术核心、商业模式、市场定位）。
格式：每行一个项目，"项目名→要点1•要点2•要点3"。只输出结果，不要序号或解释。
${descriptions.join('\n')}`;

      const text = await callGemini(prompt);
      if (!text) continue;

      const lines = text.split('\n').filter(Boolean);
      for (let j = 0; j < batch.length && j < lines.length; j++) {
        const line = lines[j];
        const after = line.includes('→') ? line.split('→').slice(1).join('→') : line;
        const points = after.split('•').map((p) => p.trim()).filter((p) => p.length > 2);
        if (points.length > 0) {
          batch[j].intro_zh = points;
        }
      }

      log.ok(
        'translate',
        `generated startup analysis for ${batch.length} items (batch ${Math.floor(i / BATCH) + 1})`,
      );
    } catch (err) {
      log.warn('translate', `startup batch failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ===== 以下为 EN 站专用：把已有中文字段反向翻译为英文 =====

const isMostlyEnglish = (s: string) => {
  if (!s) return false;
  const han = (s.match(/[一-龥]/g) || []).length;
  return han / s.length < 0.1;
};

const isMostlyChinese = (s: string) => {
  if (!s) return false;
  const han = (s.match(/[一-龥]/g) || []).length;
  // 旧阈值 30% 太高：「张嘉源(Jiayuan Zhang)，前 TikTok 工程师」中文占 27%
  // 也应被翻译。改为「含至少 3 个汉字 OR 汉字占比 ≥ 5%」就触发翻译
  return han >= 3 || han / s.length > 0.05;
};

/**
 * 通用：把任意中文字符串列表批量翻译成英文
 * 成功：返回与 texts 等长的翻译数组（每个位置都是英文）
 * 失败 / 限流 / 单条对不上：返回 null，让调用方知道"这批整批失败"，不要污染 _en 字段
 */
async function translateBatchToEn(texts: string[], hint: string): Promise<string[] | null> {
  if (texts.length === 0) return [];
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const prompt = `Translate the following ${hint} from Chinese to natural, professional English. Keep technical terms accurate. Output one translation per line in the same numbered order. Output ONLY translations, no explanations or extra punctuation.

${numbered}`;
  try {
    const text = await callGemini(prompt);
    if (!text) return null;
    const lines = text
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[\.\)、:：]\s*/, '').trim())
      .filter(Boolean);
    // 行数对不齐说明 LLM 输出格式问题，整批不可信
    if (lines.length < texts.length) return null;
    return texts.map((_, i) => lines[i]);
  } catch (err) {
    log.warn('translate', `batch-to-en failed (${hint}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * EN 站：把众筹产品的 name_zh / category_tag_zh / summary_zh 反向译成英文
 * 写入 category_tag_en / summary_en
 * 注意：name 通常本来就是英文（KS/CrowdSupply 数据），无需译
 */
export async function translateCrowdToEn(
  items: Array<{
    category_tag_zh?: string;
    category_tag_en?: string;
    summary_zh?: string[];
    summary_en?: string[];
    name?: string;
  }>,
): Promise<void> {
  // 1) category_tag_zh → category_tag_en
  const tagItems = items.filter((it) => it.category_tag_zh && !it.category_tag_en && isMostlyChinese(it.category_tag_zh));
  if (tagItems.length > 0) {
    log.info('translate', `translating ${tagItems.length} crowd category tags to EN...`);
    const tags = tagItems.map((it) => it.category_tag_zh!);
    const en = await translateBatchToEn(tags, 'category tags (short, like "#Hardware" "#AI Wearable")');
    if (en) {
      tagItems.forEach((it, i) => { if (en[i]) it.category_tag_en = en[i]; });
      log.ok('translate', `translated ${tagItems.length} crowd category tags`);
    }
  }

  // 2) summary_zh → summary_en
  // summary_zh 是 string[]，挨个译；只译那些至少有一条中文 bullet 的
  const summaryItems = items.filter(
    (it) => Array.isArray(it.summary_zh) && it.summary_zh.length > 0
      && it.summary_zh.some((s) => isMostlyChinese(s))
      && (!it.summary_en || it.summary_en.length === 0),
  );
  if (summaryItems.length > 0) {
    log.info('translate', `translating ${summaryItems.length} crowd summaries to EN...`);
    const BATCH = 10;
    for (let i = 0; i < summaryItems.length; i += BATCH) {
      const batch = summaryItems.slice(i, i + BATCH);
      const flat = batch.flatMap((it, bi) => it.summary_zh!.map((s) => `[${bi}] ${s}`));
      const en = await translateBatchToEn(flat, 'product summary bullets (concise, professional)');
      if (!en) continue;
      // 重新分配回各项
      const grouped: string[][] = batch.map(() => []);
      en.forEach((line, idx) => {
        const m = line.match(/^\[(\d+)\]\s*(.*)$/);
        if (m) {
          grouped[parseInt(m[1], 10)].push(m[2]);
        } else {
          // fallback：按原本顺序补
          for (let k = 0; k < grouped.length; k++) {
            if (grouped[k].length < (batch[k].summary_zh?.length ?? 0)) {
              grouped[k].push(line);
              break;
            }
          }
        }
      });
      batch.forEach((it, bi) => {
        if (grouped[bi].length > 0) it.summary_en = grouped[bi];
      });
      log.ok('translate', `translated crowd summaries (batch ${Math.floor(i / BATCH) + 1})`);
    }
  }
}

/**
 * EN 站：把新闻 category_tag_zh 反向译为英文（title 本来是英文，title_zh 不用回译）
 */
export async function translateNewsToEn(
  items: Array<{ category_tag_zh?: string; category_tag_en?: string; title?: string; title_zh?: string }>,
): Promise<void> {
  const tagItems = items.filter((it) => it.category_tag_zh && !it.category_tag_en && isMostlyChinese(it.category_tag_zh));
  if (tagItems.length === 0) {
    log.info('translate', 'all news category tags already in EN');
    return;
  }
  log.info('translate', `translating ${tagItems.length} news category tags to EN...`);
  const tags = tagItems.map((it) => it.category_tag_zh!);
  const en = await translateBatchToEn(tags, 'news category tags (short, like "#Tech" "#AI" "#Startup")');
  if (en) {
    tagItems.forEach((it, i) => { if (en[i]) it.category_tag_en = en[i]; });
    log.ok('translate', `translated ${tagItems.length} news category tags`);
  }
}

/**
 * EN 站：把 startups 的 intro_zh（已是中文 bullet）反向译为英文 intro_en
 * 如果 intro 本来是英文，可以直接拆为 bullet 不用译
 */
export async function translateStartupsToEn(
  items: Array<{ intro?: string; intro_zh?: string[]; intro_en?: string[] }>,
): Promise<void> {
  const targets = items.filter(
    (it) => Array.isArray(it.intro_zh) && it.intro_zh.length > 0
      && it.intro_zh.some((s) => isMostlyChinese(s))
      && (!it.intro_en || it.intro_en.length === 0),
  );
  if (targets.length === 0) {
    log.info('translate', 'all startup intros already in EN');
    return;
  }
  log.info('translate', `translating ${targets.length} startup intro bullets to EN...`);
  const BATCH = 10;
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = targets.slice(i, i + BATCH);
    const flat = batch.flatMap((it, bi) => it.intro_zh!.map((s) => `[${bi}] ${s}`));
    const en = await translateBatchToEn(flat, 'startup analysis bullets (focus on tech / business / market)');
    if (!en) continue;
    const grouped: string[][] = batch.map(() => []);
    en.forEach((line) => {
      const m = line.match(/^\[(\d+)\]\s*(.*)$/);
      if (m) grouped[parseInt(m[1], 10)].push(m[2]);
    });
    batch.forEach((it, bi) => {
      if (grouped[bi].length > 0) it.intro_en = grouped[bi];
    });
    log.ok('translate', `translated startup intros (batch ${Math.floor(i / BATCH) + 1})`);
  }
}

/**
 * EN 站：把 nextbanker 抓到的 invest 项目所有中文字段译为英文
 * 写入 *_en 字段。每条 6 个字段：name / category / tech / business / team / operations / funding
 */
export async function translateInvestsToEn(
  items: Array<{
    name?: string; name_en?: string;
    category?: string; category_en?: string;
    tech?: string; tech_en?: string;
    business?: string; business_en?: string;
    team?: string; team_en?: string;
    operations?: string; operations_en?: string;
    funding?: string; funding_en?: string;
  }>,
): Promise<void> {
  // 同一 batch 内统一翻译多个字段，但按字段类型分别 batch（提高准确性）
  const FIELDS: Array<[keyof (typeof items)[number], keyof (typeof items)[number], string]> = [
    ['name', 'name_en', 'product names (concise, brand-style)'],
    ['category', 'category_en', 'industry category names (e.g. "AI Hardware", "Embodied AI", "AI Agent")'],
    ['tech', 'tech_en', 'technical descriptions (concise, professional)'],
    ['business', 'business_en', 'business model descriptions'],
    ['team', 'team_en', 'team backgrounds'],
    ['operations', 'operations_en', 'operations metrics'],
    ['funding', 'funding_en', 'funding status descriptions'],
  ];

  for (const [zhKey, enKey, hint] of FIELDS) {
    const targets = items.filter((it) => {
      const zh = it[zhKey] as string | undefined;
      const en = it[enKey] as string | undefined;
      return zh && isMostlyChinese(zh) && !en;
    });
    if (targets.length === 0) {
      log.info('translate', `all invest ${zhKey} already in EN`);
      continue;
    }
    log.info('translate', `translating ${targets.length} invest ${zhKey} to EN...`);
    const BATCH = 15;
    for (let i = 0; i < targets.length; i += BATCH) {
      const batch = targets.slice(i, i + BATCH);
      const texts = batch.map((it) => String(it[zhKey] ?? ''));
      const en = await translateBatchToEn(texts, hint);
      if (!en) continue;
      batch.forEach((it, bi) => {
        if (en[bi] && en[bi] !== texts[bi]) {
          (it as any)[enKey] = en[bi];
        }
      });
      log.ok('translate', `translated invest ${zhKey} (batch ${Math.floor(i / BATCH) + 1})`);
    }
  }
}
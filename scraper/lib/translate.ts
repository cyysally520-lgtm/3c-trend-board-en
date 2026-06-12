/**
 * Gemini AI 翻译模块
 * 批量翻译产品名称和生成中文摘要
 * 使用 REST API 直接调用，避免 SDK 版本兼容问题
 */
import { log } from './logger';

// 注意：不在模块顶部读 env，避免在 dotenv.config 之前就被冻结成空串
function getApiKey(): string {
  return process.env.GEMINI_API_KEY || '';
}

/**
 * 调用 Gemini REST API
 */
async function callGemini(prompt: string): Promise<string> {
  const GEMINI_API_KEY = getApiKey();
  if (!GEMINI_API_KEY) {
    log.warn('translate', 'GEMINI_API_KEY not set, skipping translation');
    return '';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Gemini API ${response.status}: ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  // 从响应中提取文本
  const candidates = data?.candidates || [];
  if (candidates.length === 0) {
    throw new Error('Gemini API returned no candidates');
  }
  const parts = candidates[0]?.content?.parts || [];
  const text = parts.map((p: any) => p.text || '').join('');
  return text.trim();
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
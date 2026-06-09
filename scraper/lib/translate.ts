/**
 * Gemini AI 翻译模块
 * 批量翻译产品名称和生成中文摘要
 * 使用 REST API 直接调用，避免 SDK 版本兼容问题
 */
import { log } from './logger';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

/**
 * 调用 Gemini REST API
 */
async function callGemini(prompt: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    log.warn('translate', 'GEMINI_API_KEY not set, skipping translation');
    return '';
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

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
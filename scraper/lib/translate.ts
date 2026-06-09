/**
 * Gemini AI 翻译模块
 * 批量翻译产品名称和生成中文摘要
 */
import { GoogleGenAI, Type } from '@google/genai';
import { log } from './logger';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

let _ai: GoogleGenAI | null = null;

function getAI(): GoogleGenAI | null {
  if (_ai) return _ai;
  if (!GEMINI_API_KEY) {
    log.warn('translate', 'GEMINI_API_KEY not set, skipping translation');
    return null;
  }
  _ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return _ai;
}

/**
 * 翻译众筹产品名称为中文简称
 */
export async function translateCrowdNames(
  items: Array<{ name: string; name_zh?: string }>
): Promise<void> {
  const ai = getAI();
  if (!ai) return;

  // 过滤出需要翻译的项目
  const toTranslate = items.filter(it => !it.name_zh || it.name_zh === it.name);
  if (toTranslate.length === 0) return;

  // 分批翻译（每批最多20个）
  const BATCH = 20;
  for (let i = 0; i < toTranslate.length; i += BATCH) {
    const batch = toTranslate.slice(i, i + BATCH);
    const names = batch.map(it => it.name);

    try {
      const prompt = `将以下英文产品名翻译为简洁中文简称（4-8个字），保持专业术语准确。每行一个，只输出翻译结果，不要序号：\n${names.join('\n')}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      });

      const text = response.text?.trim() || '';
      const lines = text.split('\n').map(l => l.replace(/^\d+[\.\)、]\s*/, '').trim()).filter(Boolean);

      for (let j = 0; j < batch.length && j < lines.length; j++) {
        batch[j].name_zh = lines[j];
      }

      log.ok('translate', `translated ${batch.length} product names (batch ${Math.floor(i / BATCH) + 1})`);
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
  const ai = getAI();
  if (!ai) return;

  // 过滤出需要生成摘要的项目
  const toGen = items.filter(it => it.summary_zh.length === 0 || it.summary_zh[0] === it.name);
  if (toGen.length === 0) return;

  const BATCH = 10;
  for (let i = 0; i < toGen.length; i += BATCH) {
    const batch = toGen.slice(i, i + BATCH);
    const descriptions = batch.map(it => `${it.name}${it.blurb ? ': ' + it.blurb.slice(0, 100) : ''}`);

    try {
      const prompt = `为以下众筹产品各写3条中文AI解读要点（每条8-15字），简洁专业，分点用•分隔。格式：产品名→要点1•要点2•要点3\n${descriptions.join('\n')}`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt,
      });

      const text = response.text?.trim() || '';
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
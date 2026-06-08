/**
 * 通用 HTTP 工具：UA 池、重试、超时、限速友好
 * 用于轻量级静态页面抓取（cheerio 场景）
 */
import { log } from './logger';

const USER_AGENTS = [
  // 主流桌面浏览器 UA，定期更新
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

export function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export const DEFAULT_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

/**
 * 带重试 + 随机 UA 的 fetch
 */
export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const {
    timeoutMs = 20000,
    retries = 3,
    retryDelayMs = 2000,
    headers = {},
  } = opts;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': randomUA(),
          ...DEFAULT_HEADERS,
          ...headers,
        },
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      log.warn('http', `attempt ${attempt}/${retries} failed for ${url}: ${err instanceof Error ? err.message : err}`);
      if (attempt < retries) {
        await sleep(retryDelayMs * attempt); // 退避
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
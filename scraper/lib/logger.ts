/**
 * 简易彩色日志 - 给爬虫看的
 */

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m',
};

function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export const log = {
  info(scope: string, msg: string) {
    console.log(`${colors.gray}[${ts()}]${colors.reset} ${colors.blue}[${scope}]${colors.reset} ${msg}`);
  },
  ok(scope: string, msg: string) {
    console.log(`${colors.gray}[${ts()}]${colors.reset} ${colors.green}[${scope}]${colors.reset} ${msg}`);
  },
  warn(scope: string, msg: string) {
    console.warn(`${colors.gray}[${ts()}]${colors.reset} ${colors.yellow}[${scope}]${colors.reset} ${msg}`);
  },
  err(scope: string, msg: string, err?: unknown) {
    const detail = err instanceof Error ? err.message : err ? String(err) : '';
    console.error(`${colors.gray}[${ts()}]${colors.reset} ${colors.red}[${scope}]${colors.reset} ${msg}${detail ? ' :: ' + detail : ''}`);
  },
};
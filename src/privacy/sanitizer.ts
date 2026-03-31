/**
 * 隐私脱敏：移除 API Key、用户名、IP 等敏感信息
 */

/** 脱敏规则列表 */
const patterns: { regex: RegExp; replacement: string; label: string }[] = [
  // API Keys
  { regex: /(?:sk-|api[_-]?key[_-]?)([a-zA-Z0-9_-]{20,})/gi, replacement: '<API_KEY>', label: 'API Key' },
  { regex: /Bearer\s+[a-zA-Z0-9._-]+/gi, replacement: 'Bearer <TOKEN>', label: 'Bearer Token' },
  // Windows 用户名路径
  { regex: /C:\\Users\\([^\\]+)/gi, replacement: 'C:\\Users\\<USER>', label: '用户名路径' },
  // IP 地址
  { regex: /\b(\d{1,3}\.){3}\d{1,3}\b/g, replacement: '<IP>', label: 'IP 地址' },
  // 邮箱
  { regex: /[\w.-]+@[\w.-]+\.\w+/g, replacement: '<EMAIL>', label: '邮箱' },
];

/** 对文本进行脱敏处理 */
export function sanitize(text: string): string {
  let result = text;
  for (const { regex, replacement } of patterns) {
    result = result.replace(regex, replacement);
  }
  return result;
}

/** 检查文本是否包含敏感信息 */
export function detectSensitive(text: string): { found: boolean; items: string[] } {
  const items: string[] = [];
  for (const { regex, label } of patterns) {
    if (regex.test(text)) {
      items.push(label);
    }
    // 重置 regex lastIndex
    regex.lastIndex = 0;
  }
  return { found: items.length > 0, items };
}

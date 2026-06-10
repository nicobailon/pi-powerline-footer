// Adapted from tokenx (MIT): https://github.com/johannschopplich/tokenx
// Copyright (c) Johann Schopplich
// Adaptation date: 2026-06-10

const TOKENX_PATTERNS = {
  whitespace: /^\s+$/,
  cjk: /[\u4E00-\u9FFF\u3400-\u4DBF\u3000-\u303F\uFF00-\uFFEF\u30A0-\u30FF\u2E80-\u2EFF\u31C0-\u31EF\u3200-\u32FF\u3300-\u33FF\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/,
  numeric: /^\d+(?:[.,]\d+)*$/,
  punctuation: /[.,!?;(){}[\]<>:/\\|@#$%^&*+=`~_-]/,
  alphanumeric: /^[a-zA-Z0-9\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u00FF]+$/,
} as const;

const TOKENX_SPLIT_PATTERN = new RegExp(`(\\s+|${TOKENX_PATTERNS.punctuation.source}+)`);
const TOKENX_SHORT_TOKEN_THRESHOLD = 3;
const TOKENX_DEFAULT_CHARS_PER_TOKEN = 4;
const TOKENX_LANGUAGE_CONFIGS = [
  { pattern: /[äöüßẞ]/i, averageCharsPerToken: 3 },
  { pattern: /[éèêëàâîïôûùüÿçœæáíóúñ]/i, averageCharsPerToken: 3 },
  { pattern: /[ąćęłńóśźżěščřžýůúďťň]/i, averageCharsPerToken: 3.5 },
] as const;

function estimateTokenxSegmentTokens(segment: string): number {
  if (TOKENX_PATTERNS.whitespace.test(segment)) {
    return 0;
  }

  if (TOKENX_PATTERNS.cjk.test(segment)) {
    return Array.from(segment).length;
  }

  if (TOKENX_PATTERNS.numeric.test(segment)) {
    return 1;
  }

  if (segment.length <= TOKENX_SHORT_TOKEN_THRESHOLD) {
    return 1;
  }

  if (TOKENX_PATTERNS.punctuation.test(segment)) {
    return segment.length > 1 ? Math.ceil(segment.length / 2) : 1;
  }

  const charsPerToken = getTokenxCharsPerToken(segment);
  if (TOKENX_PATTERNS.alphanumeric.test(segment)) {
    return Math.ceil(segment.length / charsPerToken);
  }

  return Math.ceil(segment.length / charsPerToken);
}

function getTokenxCharsPerToken(segment: string): number {
  for (const config of TOKENX_LANGUAGE_CONFIGS) {
    if (config.pattern.test(segment)) {
      return config.averageCharsPerToken;
    }
  }

  return TOKENX_DEFAULT_CHARS_PER_TOKEN;
}

export function estimatePromptTokens(text: string): number {
  if (!text) {
    return 0;
  }

  const segments = text.split(TOKENX_SPLIT_PATTERN).filter(Boolean);
  let tokenCount = 0;

  for (const segment of segments) {
    tokenCount += estimateTokenxSegmentTokens(segment);
  }

  return tokenCount;
}

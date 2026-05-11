import type { NovelMetadata } from './spider';

interface LibrarySearchAlias {
  alias: string;
}

export interface LibrarySearchNovel {
  sourceId: string;
  metadata: NovelMetadata;
  aliases: LibrarySearchAlias[];
}

type SearchNode =
  | { type: 'term'; field: SearchField | null; value: string }
  | { type: 'and'; children: SearchNode[] }
  | { type: 'or'; children: SearchNode[] }
  | { type: 'not'; child: SearchNode };

type SearchField = 'name' | 'tag' | 'site' | 'author' | 'summary' | 'alias';

interface SearchToken {
  type: 'word' | 'lparen' | 'rparen' | 'plus' | 'minus';
  value: string;
}

interface SearchEvaluation {
  matched: boolean;
  score: number;
}

const FIELD_ALIASES: Record<string, SearchField> = {
  name: 'name',
  title: 'name',
  tag: 'tag',
  site: 'site',
  source: 'site',
  author: 'author',
  summary: 'summary',
  description: 'summary',
  alias: 'alias',
};

export function searchLibraryNovels<T extends LibrarySearchNovel>(novels: T[], query: string): T[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return novels;
  }

  const tokens = tokenizeQuery(normalizedQuery);
  const expression = parseSearchExpression(tokens);

  return novels
    .map((novel) => ({ novel, evaluation: evaluateNode(expression, novel) }))
    .filter((entry) => entry.evaluation.matched)
    .sort((left, right) => {
      if (right.evaluation.score !== left.evaluation.score) {
        return right.evaluation.score - left.evaluation.score;
      }

      const updatedAtDifference = String((right.novel as { updatedAt?: string }).updatedAt ?? '').localeCompare(
        String((left.novel as { updatedAt?: string }).updatedAt ?? ''),
      );
      if (updatedAtDifference !== 0) {
        return updatedAtDifference;
      }

      return left.novel.metadata.title.localeCompare(right.novel.metadata.title, 'zh-CN');
    })
    .map((entry) => entry.novel);
}

function tokenizeQuery(query: string): SearchToken[] {
  const tokens: SearchToken[] = [];
  let cursor = 0;

  while (cursor < query.length) {
    const current = query[cursor];

    if (!current) {
      break;
    }

    if (/\s/.test(current)) {
      cursor += 1;
      continue;
    }

    if (current === '(') {
      tokens.push({ type: 'lparen', value: current });
      cursor += 1;
      continue;
    }

    if (current === ')') {
      tokens.push({ type: 'rparen', value: current });
      cursor += 1;
      continue;
    }

    if (current === '+') {
      tokens.push({ type: 'plus', value: current });
      cursor += 1;
      continue;
    }

    if (current === '-') {
      tokens.push({ type: 'minus', value: current });
      cursor += 1;
      continue;
    }

    if (current === '"') {
      const endQuoteIndex = query.indexOf('"', cursor + 1);
      if (endQuoteIndex < 0) {
        throw new Error('查询语法错误：缺少结束引号。');
      }

      const value = query.slice(cursor + 1, endQuoteIndex).trim();
      if (value.length > 0) {
        tokens.push({ type: 'word', value });
      }
      cursor = endQuoteIndex + 1;
      continue;
    }

    let end = cursor;
    while (end < query.length && !/[\s()+-]/.test(query[end] ?? '')) {
      end += 1;
    }

    const value = query.slice(cursor, end).trim();
    if (value.length > 0) {
      tokens.push({ type: 'word', value });
    }
    cursor = end;
  }

  return tokens;
}

function parseSearchExpression(tokens: SearchToken[]): SearchNode {
  let cursor = 0;

  function parseOrExpression(): SearchNode {
    const children: SearchNode[] = [parseAndExpression()];

    while (tokens[cursor]?.type === 'word' && isOrKeyword(tokens[cursor]?.value ?? '')) {
      cursor += 1;
      children.push(parseAndExpression());
    }

    return children.length === 1 ? children[0]! : { type: 'or', children };
  }

  function parseAndExpression(): SearchNode {
    const children: SearchNode[] = [parseUnaryExpression()];

    while (cursor < tokens.length) {
      const token = tokens[cursor];
      if (!token || token.type === 'rparen' || (token.type === 'word' && isOrKeyword(token.value))) {
        break;
      }

      children.push(parseUnaryExpression());
    }

    return children.length === 1 ? children[0]! : { type: 'and', children };
  }

  function parseUnaryExpression(): SearchNode {
    const token = tokens[cursor];
    if (!token) {
      throw new Error('查询语法错误：表达式提前结束。');
    }

    if (token.type === 'plus') {
      cursor += 1;
      return parseUnaryExpression();
    }

    if (token.type === 'minus') {
      cursor += 1;
      return { type: 'not', child: parsePrimaryExpression() };
    }

    return parsePrimaryExpression();
  }

  function parsePrimaryExpression(): SearchNode {
    const token = tokens[cursor];
    if (!token) {
      throw new Error('查询语法错误：表达式提前结束。');
    }

    if (token.type === 'lparen') {
      cursor += 1;
      const expression = parseOrExpression();
      if (tokens[cursor]?.type !== 'rparen') {
        throw new Error('查询语法错误：括号没有正确闭合。');
      }
      cursor += 1;
      return expression;
    }

    if (token.type !== 'word') {
      throw new Error(`查询语法错误：无法识别 ${token.value}。`);
    }

    cursor += 1;
    return parseSearchTerm(token.value);
  }

  if (tokens.length === 0) {
    throw new Error('查询内容不能为空。');
  }

  const expression = parseOrExpression();
  if (cursor < tokens.length) {
    throw new Error(`查询语法错误：${tokens[cursor]?.value ?? '末尾'} 附近无法解析。`);
  }

  return expression;
}

function parseSearchTerm(rawValue: string): SearchNode {
  const fieldSeparatorIndex = rawValue.indexOf(':');
  if (fieldSeparatorIndex > 0) {
    const rawField = normalizeText(rawValue.slice(0, fieldSeparatorIndex));
    const rawTermValue = rawValue.slice(fieldSeparatorIndex + 1).trim();
    const field = FIELD_ALIASES[rawField];

    if (field && rawTermValue.length > 0) {
      return {
        type: 'term',
        field,
        value: rawTermValue,
      };
    }
  }

  return {
    type: 'term',
    field: null,
    value: rawValue,
  };
}

function evaluateNode(node: SearchNode, novel: LibrarySearchNovel): SearchEvaluation {
  switch (node.type) {
    case 'term':
      return evaluateTerm(node, novel);
    case 'and': {
      let score = 0;

      for (const child of node.children) {
        const evaluation = evaluateNode(child, novel);
        if (!evaluation.matched) {
          return { matched: false, score: 0 };
        }

        score += evaluation.score;
      }

      return { matched: true, score };
    }
    case 'or': {
      let matched = false;
      let score = 0;

      for (const child of node.children) {
        const evaluation = evaluateNode(child, novel);
        if (!evaluation.matched) {
          continue;
        }

        matched = true;
        score += evaluation.score;
      }

      return { matched, score };
    }
    case 'not': {
      const evaluation = evaluateNode(node.child, novel);
      return { matched: !evaluation.matched, score: 0 };
    }
  }
}

function evaluateTerm(node: Extract<SearchNode, { type: 'term' }>, novel: LibrarySearchNovel): SearchEvaluation {
  const term = normalizeText(node.value);
  if (!term) {
    return { matched: true, score: 0 };
  }

  if (node.field === 'name') {
    return scoreTextField(novel.metadata.title, term, 150);
  }

  if (node.field === 'tag') {
    return scoreManyTextFields(novel.metadata.tags, term, 120);
  }

  if (node.field === 'site') {
    return scoreTextField(novel.sourceId, term, 90);
  }

  if (node.field === 'author') {
    return scoreTextField(novel.metadata.author, term, 100);
  }

  if (node.field === 'summary') {
    return scoreTextField(novel.metadata.description, term, 50);
  }

  if (node.field === 'alias') {
    return scoreManyTextFields(novel.aliases.map((entry) => entry.alias), term, 140);
  }

  const fieldScores = [
    scoreTextField(novel.metadata.title, term, 150),
    scoreManyTextFields(novel.aliases.map((entry) => entry.alias), term, 140),
    scoreManyTextFields(novel.metadata.tags, term, 120),
    scoreTextField(novel.metadata.author, term, 100),
    scoreTextField(novel.sourceId, term, 90),
    scoreTextField(novel.metadata.description, term, 50),
  ].filter((entry) => entry.matched);

  if (fieldScores.length === 0) {
    return { matched: false, score: 0 };
  }

  return {
    matched: true,
    score: fieldScores.reduce((best, entry) => Math.max(best, entry.score), 0),
  };
}

function scoreManyTextFields(values: string[], term: string, weight: number): SearchEvaluation {
  const scores = values.map((value) => scoreTextField(value, term, weight)).filter((entry) => entry.matched);
  if (scores.length === 0) {
    return { matched: false, score: 0 };
  }

  return scores.reduce((best, current) => (current.score > best.score ? current : best));
}

function scoreTextField(value: string, term: string, weight: number): SearchEvaluation {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return { matched: false, score: 0 };
  }

  if (normalizedValue === term) {
    return { matched: true, score: weight + 60 };
  }

  if (normalizedValue.startsWith(term)) {
    return { matched: true, score: weight + 30 };
  }

  if (normalizedValue.includes(term)) {
    return { matched: true, score: weight };
  }

  return { matched: false, score: 0 };
}

function normalizeText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function isOrKeyword(value: string): boolean {
  return normalizeText(value) === 'or';
}
// Wikitext helpers for Terra Wiki content. Each one scans its input a bounded number of times, so hostile or broken
// markup cannot make them slow; they return what the equivalent regular expressions in their comments return.

const isSpace = (character: string) => /\s/.test(character);

/** Removes every `<...>` with at least one character inside, like `value.replace(/<[^>]+>/g, "")`. */
export function stripTags(value: string): string {
  let result = "";
  let index = 0;
  for (;;) {
    const open = value.indexOf("<", index);
    if (open === -1) break;
    const close = value.indexOf(">", open + 1);
    if (close === -1) break;
    if (close === open + 1) {
      result += value.slice(index, close);
      index = close;
      continue;
    }
    result += value.slice(index, open);
    index = close + 1;
  }
  return result + value.slice(index);
}

type WikiLink = { start: number; end: number; target: string };

/** For each position, the index of the next character of `characters` at or after it, or the length. */
function nextIndexes(value: string, characters: string): Int32Array {
  const next = new Int32Array(value.length + 1);
  next[value.length] = value.length;
  for (let index = value.length - 1; index >= 0; index -= 1) next[index] = characters.includes(value[index]!) ? index : next[index + 1]!;
  return next;
}

/** Links matched by `/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g`, left to right and without overlapping. */
function wikiLinks(value: string): WikiLink[] {
  const links: WikiLink[] = [];
  if (!value.includes("[[")) return links;
  const nextStop = nextIndexes(value, "]|");
  const nextBracket = nextIndexes(value, "]");
  let index = 0;
  for (;;) {
    const start = value.indexOf("[[", index);
    if (start === -1) return links;
    // The target runs to the first "]" or "|": a "]" must open "]]", and a "|" needs a label up to "]]".
    const targetEnd = nextStop[start + 2]!;
    let end = -1;
    if (targetEnd > start + 2 && targetEnd < value.length) {
      const labelEnd = value[targetEnd] === "]" ? targetEnd : nextBracket[targetEnd + 1]!;
      const labelled = labelEnd !== targetEnd;
      if (labelEnd < value.length && value[labelEnd + 1] === "]" && (!labelled || labelEnd > targetEnd + 1)) end = labelEnd + 2;
    }
    if (end === -1) {
      index = start + 1;
      continue;
    }
    links.push({ start, end, target: value.slice(start + 2, targetEnd) });
    index = end;
  }
}

/** Replaces each `[[target]]` or `[[target|label]]` with its target. */
export function replaceWikiLinks(value: string): string {
  let result = "";
  let index = 0;
  for (const link of wikiLinks(value)) {
    result += value.slice(index, link.start) + link.target;
    index = link.end;
  }
  return result + value.slice(index);
}

/** Targets of the `[[target]]` and `[[target|label]]` links, in order. */
export function wikiLinkTargets(value: string): string[] {
  return wikiLinks(value).map((link) => link.target);
}

/** `value.replace(/\s*\([^)]*\)\s*$/, "")`: drops a final parenthesis and the spaces around it. */
export function stripTrailingParenthesis(value: string): string {
  let end = value.length;
  while (end > 0 && isSpace(value[end - 1]!)) end -= 1;
  if (end === 0 || value[end - 1] !== ")") return value;
  const close = end - 1;
  const open = value.indexOf("(", value.lastIndexOf(")", close - 1) + 1);
  if (open === -1 || open > close) return value;
  let start = open;
  while (start > 0 && isSpace(value[start - 1]!)) start -= 1;
  return value.slice(0, start);
}

/** Text of the first parenthesis, like `value.match(/\(([^)]*)\)/)?.[1]`. */
export function firstParenthesis(value: string): string | undefined {
  const open = value.indexOf("(");
  if (open === -1) return undefined;
  const close = value.indexOf(")", open + 1);
  return close === -1 ? undefined : value.slice(open + 1, close);
}

const fieldHead = /\|\s*illustrator\s*=/i;
// A following field: "|", a name without "=" or a line break, optional spaces and line breaks, and "=".
const nextField = /\|[^\n=]+(?:\n\s*)?=/y;

/**
 * Value of the first `|illustrator =` field, up to the next field or the end of the template, like
 * `/\|\s*illustrator\s*=([\s\S]*?)(?=\n\|[^\n=]+\s*=|\n}})/i`; undefined when it does not end.
 */
export function illustratorFieldValue(wikitext: string): string | undefined {
  const head = fieldHead.exec(wikitext);
  if (!head) return undefined;
  const start = head.index + head[0].length;
  for (let newline = wikitext.indexOf("\n", start); newline !== -1; newline = wikitext.indexOf("\n", newline + 1)) {
    if (wikitext.startsWith("}}", newline + 1)) return wikitext.slice(start, newline);
    nextField.lastIndex = newline + 1;
    if (nextField.test(wikitext)) return wikitext.slice(start, newline);
  }
  return undefined;
}

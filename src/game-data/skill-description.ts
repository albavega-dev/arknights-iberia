import { formatNumber, formatPercent } from "./number-format";

export type SkillBlackboardEntry = {
  key: string;
  value: number;
  valueStr?: string | null;
};

export type SkillDescriptionTone = "increase" | "decrease" | "keyword" | "status";

export type SkillDescriptionNode =
  | { type: "text"; text: string }
  | { type: "lineBreak" }
  | { type: "value"; key: string; display: string; percent: boolean }
  | { type: "style"; tag: string; tone: SkillDescriptionTone; termId?: string; children: SkillDescriptionNode[] }
  | { type: "unknownMarker"; text: string };

/** `<@...>` tags verified against real records; any other `<@...>` tag is dropped and its inner text is shown unstyled. */
const knownTags: Record<string, SkillDescriptionTone> = {
  "@ba.vup": "increase",
  "@ba.vdown": "decrease",
  "@ba.rem": "keyword",
  "@ba.kw": "keyword",
  "@cc.vup": "increase",
  "@cc.vdown": "decrease",
  "@cc.rem": "keyword",
  "@cc.kw": "keyword",
};

/** `<$id>` tags mark a glossary term: they share the status tone and keep the term id (for example `ba.stun`) for future tooltips. */
function termIdOf(tag: string): string | null {
  return tag.startsWith("$") && tag.length > 1 ? tag.slice(1) : null;
}

const tokenPattern = /<([@$][^<>\s]*)>|<\/>|\{([^{}:\s]+)(?::([^{}\s]*))?\}|\\n|\r?\n/g;

type Frame = { tag: string | null; tone: SkillDescriptionTone | null; termId: string | null; open: string; children: SkillDescriptionNode[] };

function appendText(nodes: SkillDescriptionNode[], text: string) {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === "text") last.text += text;
  else nodes.push({ type: "text", text });
}

function appendNode(nodes: SkillDescriptionNode[], node: SkillDescriptionNode) {
  if (node.type === "text") appendText(nodes, node.text);
  else nodes.push(node);
}

function findEntry(blackboard: readonly SkillBlackboardEntry[], key: string) {
  const lower = key.toLowerCase();
  return blackboard.find((entry) => entry.key === key) ?? blackboard.find((entry) => entry.key.toLowerCase() === lower);
}

const supportedFormats = new Set<string | undefined>([undefined, "0", "0.0", "0%", "0.0%"]);

/**
 * Resolves `{key}`, `{key:fmt}` and `{-key:fmt}`; a leading `-` negates the value. `0` rounds to an integer, `0.0` keeps the natural
 * value (at most two decimals, as the wiki shows it), a trailing `%` scales by 100, and no format uses the general formatter.
 */
function resolveValue(marker: string, rawKey: string, format: string | undefined, blackboard: readonly SkillBlackboardEntry[]): SkillDescriptionNode {
  const negate = rawKey.startsWith("-");
  const key = negate ? rawKey.slice(1) : rawKey;
  const entry = key ? findEntry(blackboard, key) : undefined;
  if (!entry || !supportedFormats.has(format)) return { type: "unknownMarker", text: marker };
  const percent = format?.endsWith("%") ?? false;
  if (entry.valueStr != null) return { type: "value", key, display: entry.valueStr, percent };
  if (!Number.isFinite(entry.value)) return { type: "unknownMarker", text: marker };
  const value = negate ? -entry.value : entry.value;
  const display = percent ? formatPercent(value * 100) : formatNumber(format === "0" ? Math.round(value) : value);
  return { type: "value", key, display, percent };
}

function styleNode(frame: Frame): SkillDescriptionNode {
  const node: SkillDescriptionNode = { type: "style", tag: frame.tag!, tone: frame.tone!, children: frame.children };
  if (frame.termId) node.termId = frame.termId;
  return node;
}

/**
 * Parses a skill description into typed nodes. Pure and closed-grammar: it never produces or evaluates HTML,
 * and unrecognised variables are kept visible as an `unknownMarker`; unrecognised tags show their inner text unstyled.
 */
export function parseSkillDescription(description: string, blackboard: readonly SkillBlackboardEntry[]): SkillDescriptionNode[] {
  const stack: Frame[] = [{ tag: null, tone: null, termId: null, open: "", children: [] }];
  const current = () => stack[stack.length - 1].children;
  let cursor = 0;

  for (const match of description.matchAll(tokenPattern)) {
    appendText(current(), description.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const [token, tag, key, format] = match;

    if (tag !== undefined) {
      const term = termIdOf(tag);
      const tone = term ? "status" : (knownTags[tag] ?? null);
      stack.push({ tag: tone ? tag : null, tone, termId: term, open: token, children: [] });
    } else if (token === "</>") {
      if (stack.length === 1) {
        current().push({ type: "unknownMarker", text: token });
        continue;
      }
      const frame = stack.pop()!;
      if (frame.tag && frame.tone) current().push(styleNode(frame));
      else {
        for (const child of frame.children) appendNode(current(), child);
      }
    } else if (key !== undefined) {
      current().push(resolveValue(token, key, format, blackboard));
    } else {
      current().push({ type: "lineBreak" });
    }
  }
  appendText(current(), description.slice(cursor));

  while (stack.length > 1) {
    const frame = stack.pop()!;
    if (frame.tag && frame.tone) current().push(styleNode(frame));
    else for (const child of frame.children) appendNode(current(), child);
  }
  return stack[0].children;
}

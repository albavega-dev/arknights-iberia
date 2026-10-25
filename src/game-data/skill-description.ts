import { formatNumber, formatPercent } from "./number-format";

export type SkillBlackboardEntry = {
  key: string;
  value: number;
  valueStr?: string | null;
};

export type SkillDescriptionTone = "increase" | "keyword" | "status";

export type SkillDescriptionNode =
  | { type: "text"; text: string }
  | { type: "lineBreak" }
  | { type: "value"; key: string; display: string; percent: boolean }
  | { type: "style"; tag: string; tone: SkillDescriptionTone; children: SkillDescriptionNode[] }
  | { type: "unknownMarker"; text: string };

/** Tags verified against real records; any other `<@...>` or `<$...>` tag is dropped and its inner text is shown unstyled. */
const knownTags: Record<string, SkillDescriptionTone> = {
  "@ba.vup": "increase",
  "@ba.rem": "keyword",
  "$ba.stun": "status",
  "$ba.binding": "status",
};

const tokenPattern = /<([@$][^<>\s]*)>|<\/>|\{([^{}:\s]+)(?::([^{}\s]*))?\}|\\n|\r?\n/g;

type Frame = { tag: string | null; tone: SkillDescriptionTone | null; open: string; children: SkillDescriptionNode[] };

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

function resolveValue(marker: string, key: string, format: string | undefined, blackboard: readonly SkillBlackboardEntry[]): SkillDescriptionNode {
  const entry = findEntry(blackboard, key);
  if (!entry || (format !== undefined && format !== "0%")) return { type: "unknownMarker", text: marker };
  const percent = format === "0%";
  if (entry.valueStr != null) return { type: "value", key, display: entry.valueStr, percent };
  if (!Number.isFinite(entry.value)) return { type: "unknownMarker", text: marker };
  return { type: "value", key, display: percent ? formatPercent(entry.value * 100) : formatNumber(entry.value), percent };
}

/**
 * Parses a skill description into typed nodes. Pure and closed-grammar: it never produces or evaluates HTML,
 * and unrecognised variables are kept visible as an `unknownMarker`; unrecognised tags show their inner text unstyled.
 */
export function parseSkillDescription(description: string, blackboard: readonly SkillBlackboardEntry[]): SkillDescriptionNode[] {
  const stack: Frame[] = [{ tag: null, tone: null, open: "", children: [] }];
  const current = () => stack[stack.length - 1].children;
  let cursor = 0;

  for (const match of description.matchAll(tokenPattern)) {
    appendText(current(), description.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const [token, tag, key, format] = match;

    if (tag !== undefined) {
      const tone = knownTags[tag] ?? null;
      stack.push({ tag: tone ? tag : null, tone, open: token, children: [] });
    } else if (token === "</>") {
      if (stack.length === 1) {
        current().push({ type: "unknownMarker", text: token });
        continue;
      }
      const frame = stack.pop()!;
      if (frame.tag && frame.tone) current().push({ type: "style", tag: frame.tag, tone: frame.tone, children: frame.children });
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
    if (frame.tag && frame.tone) current().push({ type: "style", tag: frame.tag, tone: frame.tone, children: frame.children });
    else for (const child of frame.children) appendNode(current(), child);
  }
  return stack[0].children;
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseSkillDescription, type SkillBlackboardEntry, type SkillDescriptionNode } from "../src/game-data/skill-description";

const bb = (...entries: [string, number, (string | null)?][]): SkillBlackboardEntry[] => entries.map(([key, value, valueStr]) => ({ key, value, valueStr }));
const text = (value: string): SkillDescriptionNode => ({ type: "text", text: value });
const value = (key: string, display: string, percent = false): SkillDescriptionNode => ({ type: "value", key, display, percent });

describe("parseSkillDescription real cases", () => {
  it("shows a direct value without percent (skcom_charge_cost[1])", () => {
    assert.deepEqual(parseSkillDescription("Cost {cost} SP", bb(["cost", 6])), [text("Cost "), value("cost", "6"), text(" SP")]);
  });

  it("converts fractions to percent with :0% and no floating-point noise (skchr_amiya_3 atk)", () => {
    const description = "ATK +{atk:0%}";
    assert.deepEqual(parseSkillDescription(description, bb(["atk", 1])), [text("ATK +"), value("atk", "100 %", true)]);
    assert.deepEqual(parseSkillDescription(description, bb(["atk", 1.1])), [text("ATK +"), value("atk", "110 %", true)]);
    assert.deepEqual(parseSkillDescription(description, bb(["atk", 1.2])), [text("ATK +"), value("atk", "120 %", true)]);
  });

  it("converts max_hp fractions (skchr_amiya_3 max_hp)", () => {
    assert.deepEqual(parseSkillDescription("{max_hp:0%}", bb(["max_hp", 0.25])), [value("max_hp", "25 %", true)]);
    assert.deepEqual(parseSkillDescription("{max_hp:0%}", bb(["max_hp", 0.5])), [value("max_hp", "50 %", true)]);
  });

  it("keeps attack_speed as a plain number (skchr_kalts_2)", () => {
    assert.deepEqual(parseSkillDescription("ASPD +{attack_speed}", bb(["attack_speed", 30])), [text("ASPD +"), value("attack_speed", "30")]);
  });

  it("converts def with :0% (skchr_kalts_1)", () => {
    assert.deepEqual(parseSkillDescription("DEF +{def:0%}", bb(["def", 0.6])), [text("DEF +"), value("def", "60 %", true)]);
    assert.deepEqual(parseSkillDescription("DEF +{def:0%}", bb(["def", 0.7])), [text("DEF +"), value("def", "70 %", true)]);
  });

  it("keeps stun as a plain number (skchr_amiya_2)", () => {
    assert.deepEqual(parseSkillDescription("<$ba.stun>Stun</> for {stun}s", bb(["stun", 10])), [
      { type: "style", tag: "$ba.stun", tone: "status", termId: "ba.stun", children: [text("Stun")] },
      text(" for "),
      value("stun", "10"),
      text("s"),
    ]);
  });
});

describe("parseSkillDescription markup", () => {
  it("maps known tags to typed style nodes", () => {
    assert.deepEqual(parseSkillDescription("<@ba.vup>+10</> and <@ba.rem>note</> and <$ba.binding>Bind</>", []), [
      { type: "style", tag: "@ba.vup", tone: "increase", children: [text("+10")] },
      text(" and "),
      { type: "style", tag: "@ba.rem", tone: "keyword", children: [text("note")] },
      text(" and "),
      { type: "style", tag: "$ba.binding", tone: "status", termId: "ba.binding", children: [text("Bind")] },
    ]);
  });

  it("maps the decrease and keyword tags found in the catalog", () => {
    assert.deepEqual(parseSkillDescription("<@ba.vdown>slow</> <@ba.kw>Limit</> <@cc.vup>up</> <@cc.rem>r</> <@cc.kw>k</>", []), [
      { type: "style", tag: "@ba.vdown", tone: "decrease", children: [text("slow")] },
      text(" "),
      { type: "style", tag: "@ba.kw", tone: "keyword", children: [text("Limit")] },
      text(" "),
      { type: "style", tag: "@cc.vup", tone: "increase", children: [text("up")] },
      text(" "),
      { type: "style", tag: "@cc.rem", tone: "keyword", children: [text("r")] },
      text(" "),
      { type: "style", tag: "@cc.kw", tone: "keyword", children: [text("k")] },
    ]);
  });

  it("gives the base skill decrease tag the decrease tone", () => {
    assert.deepEqual(parseSkillDescription("Morale <@cc.vdown>-0.1</> per hour", []), [
      text("Morale "),
      { type: "style", tag: "@cc.vdown", tone: "decrease", children: [text("-0.1")] },
      text(" per hour"),
    ]);
  });

  it("gives every glossary term the status tone and keeps its id", () => {
    assert.deepEqual(parseSkillDescription("<$ba.sluggish>Slow</> and <$ba.dt.element>Elemental</> and <$cc.bd_A>x</>", []), [
      { type: "style", tag: "$ba.sluggish", tone: "status", termId: "ba.sluggish", children: [text("Slow")] },
      text(" and "),
      { type: "style", tag: "$ba.dt.element", tone: "status", termId: "ba.dt.element", children: [text("Elemental")] },
      text(" and "),
      { type: "style", tag: "$cc.bd_A", tone: "status", termId: "cc.bd_A", children: [text("x")] },
    ]);
  });

  it("parses a glossary explanation with nested terms and real line breaks", () => {
    assert.deepEqual(parseSkillDescription("Cannot move.\n<$ba.cold>Cold</> then <@cc.rem>wait</>", []), [
      text("Cannot move."),
      { type: "lineBreak" },
      { type: "style", tag: "$ba.cold", tone: "status", termId: "ba.cold", children: [text("Cold")] },
      text(" then "),
      { type: "style", tag: "@cc.rem", tone: "keyword", children: [text("wait")] },
    ]);
  });

  it("treats a term tag without an id as an unknown tag", () => {
    assert.deepEqual(parseSkillDescription("<$>text</>", []), [text("text")]);
  });

  it("converts the literal \n and real newlines to line breaks", () => {
    assert.deepEqual(parseSkillDescription("one\ntwo\nthree\r\nfour", []), [text("one"), { type: "lineBreak" }, text("two"), { type: "lineBreak" }, text("three"), { type: "lineBreak" }, text("four")]);
  });

  it("resolves values inside nested tags", () => {
    assert.deepEqual(parseSkillDescription("<@ba.rem>Gain <@ba.vup>{atk:0%}</> ATK</>", bb(["atk", 0.5])), [
      {
        type: "style",
        tag: "@ba.rem",
        tone: "keyword",
        children: [text("Gain "), { type: "style", tag: "@ba.vup", tone: "increase", children: [value("atk", "50 %", true)] }, text(" ATK")],
      },
    ]);
  });

  it("shows the inner text of unknown tags without style or raw markers", () => {
    assert.deepEqual(parseSkillDescription("<@ba.unknown>text</> after <@ba.other>more", []), [text("text after more")]);
    assert.deepEqual(parseSkillDescription("<@ba.unknown>a <@ba.vup>{atk:0%}</> b</>", bb(["atk", 1])), [text("a "), { type: "style", tag: "@ba.vup", tone: "increase", children: [value("atk", "100 %", true)] }, text(" b")]);
  });

  it("keeps a stray closing marker and closes unclosed tags at the end", () => {
    assert.deepEqual(parseSkillDescription("a</>b", []), [text("a"), { type: "unknownMarker", text: "</>" }, text("b")]);
    assert.deepEqual(parseSkillDescription("<@ba.vup>open", []), [{ type: "style", tag: "@ba.vup", tone: "increase", children: [text("open")] }]);
  });

  it("returns no nodes for an empty description", () => {
    assert.deepEqual(parseSkillDescription("", []), []);
  });
});

describe("parseSkillDescription values", () => {
  it("keeps decimals, drops floating-point noise and keeps negative signs", () => {
    assert.deepEqual(parseSkillDescription("{a} {b} {c:0%} {d:0%}", bb(["a", 1.5], ["b", -2], ["c", -0.3], ["d", 0.1 + 0.2])), [
      value("a", "1,5"),
      text(" "),
      value("b", "-2"),
      text(" "),
      value("c", "-30 %", true),
      text(" "),
      value("d", "30 %", true),
    ]);
  });

  it("gives priority to valueStr without converting it", () => {
    assert.deepEqual(parseSkillDescription("{atk:0%} {cost}", bb(["atk", 1.5, "150%"], ["cost", 3, null])), [value("atk", "150%", true), text(" "), value("cost", "3")]);
  });

  it("keeps a missing variable visible instead of replacing it with zero", () => {
    assert.deepEqual(parseSkillDescription("Deals {missing} and {gone:0%}", bb(["atk", 1])), [
      text("Deals "),
      { type: "unknownMarker", text: "{missing}" },
      text(" and "),
      { type: "unknownMarker", text: "{gone:0%}" },
    ]);
  });

  it("keeps unsupported formats and non-finite values as unknown markers", () => {
    assert.deepEqual(parseSkillDescription("{atk:0.00} {nan}", bb(["atk", 1], ["nan", Number.NaN])), [
      { type: "unknownMarker", text: "{atk:0.00}" },
      text(" "),
      { type: "unknownMarker", text: "{nan}" },
    ]);
  });

  it("formats :0 as a rounded integer and :0.0 with its natural precision (Terra Wiki: Greyy S2, Thorns S2)", () => {
    assert.deepEqual(parseSkillDescription("{a:0} {b:0} {c:0.0} {d:0.0} {e:0.0}", bb(["a", 6], ["b", 2.6], ["c", 2], ["d", 1.5], ["e", 0.75])), [
      value("a", "6"), text(" "), value("b", "3"), text(" "), value("c", "2"), text(" "), value("d", "1,5"), text(" "), value("e", "0,75"),
    ]);
  });

  it("formats :0.0% as a percentage with natural precision", () => {
    assert.deepEqual(parseSkillDescription("{hp:0.0%} {atk:0.0%}", bb(["hp", 0.025], ["atk", 1])), [value("hp", "2,5 %", true), text(" "), value("atk", "100 %", true)]);
  });

  it("negates the value of {-key} and {-key:0%} (Frostleaf S1, Nights S2)", () => {
    assert.deepEqual(parseSkillDescription("-{-move_speed:0%} {-def} {-max_hp:0.0}", bb(["move_speed", -0.2], ["def", -3], ["max_hp", -0.75])), [
      text("-"), value("move_speed", "20 %", true), text(" "), value("def", "3"), text(" "), value("max_hp", "0,75"),
    ]);
  });

  it("keeps a negated key with an unknown name or without a name as an unknown marker", () => {
    assert.deepEqual(parseSkillDescription("{-gone} {-}", bb(["atk", 1])), [{ type: "unknownMarker", text: "{-gone}" }, text(" "), { type: "unknownMarker", text: "{-}" }]);
  });

  it("matches keys case-insensitively and supports keys with @", () => {
    assert.deepEqual(parseSkillDescription("{ATK} {attack@atk_scale:0%}", bb(["atk", 2], ["attack@atk_scale", 1.5])), [value("ATK", "2"), text(" "), value("attack@atk_scale", "150 %", true)]);
  });

  it("prefers an exact key over a case-insensitive one", () => {
    assert.deepEqual(parseSkillDescription("{Atk}", bb(["atk", 1], ["Atk", 2])), [value("Atk", "2")]);
  });
});

describe("parseSkillDescription HTML safety", () => {
  it("keeps HTML as literal text and never builds elements", () => {
    const description = "<script>alert(1)</script><b>bold</b><img src=x onerror=alert(1)>";
    assert.deepEqual(parseSkillDescription(description, []), [text(description)]);
  });

  it("does not resolve markers inside HTML or evaluate expressions", () => {
    const nodes = parseSkillDescription("<a href=\"javascript:alert({atk})\">x</a> {atk*2} ${atk}", bb(["atk", 5]));
    assert.ok(nodes.every((node) => node.type !== "style"));
    assert.deepEqual(nodes.filter((node) => node.type === "unknownMarker"), [{ type: "unknownMarker", text: "{atk*2}" }]);
    assert.equal(JSON.stringify(nodes).includes("[object"), false);
  });

  it("treats tag-like text without @ or $ as plain text", () => {
    assert.deepEqual(parseSkillDescription("<ba.vup>x</ba.vup>", []), [text("<ba.vup>x</ba.vup>")]);
  });
});

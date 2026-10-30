import assert from "node:assert/strict";
import test from "node:test";
import { firstParenthesis, illustratorFieldValue, replaceWikiLinks, stripTags, stripTrailingParenthesis, wikiLinkTargets } from "../src/game-data/wikitext.js";
import { extractArtists, extractIllustratorField } from "../scripts/extract-terra-artist-credits.js";
import { creditsFor } from "../scripts/normalize-operator-artist-credits.js";

const linear = (label: string, run: () => void) => {
  const started = performance.now();
  run();
  assert.ok(performance.now() - started < 1000, `${label}: hostile inputs finish well under a second`);
};

test("tags are removed when they have something inside", () => {
  assert.equal(stripTags("<b>Wei</b>@W<br/>"), "Wei@W");
  assert.equal(stripTags("a<>b"), "a<>b", "an empty pair stays");
  assert.equal(stripTags("a<<b>c"), "ac", "the tag runs from the first < to the next >");
  assert.equal(stripTags("a<b"), "a<b");
  assert.equal(stripTags("<><b>"), "<>");
  linear("tags", () => {
    stripTags("<".repeat(200_000));
    stripTags("<a".repeat(100_000));
    stripTags("<>".repeat(100_000) + "<");
  });
});

test("wiki links become their target, with or without a label", () => {
  assert.equal(replaceWikiLinks("*[[Wei@W|唯@W]] and [[NoriZC]]"), "*Wei@W and NoriZC");
  assert.deepEqual(wikiLinkTargets("[[A|a]] [[B]] [[|x]] [[C|]] [[D]"), ["A", "B"]);
  assert.equal(replaceWikiLinks("[[[A]]"), "[A", "a [ before the target belongs to it");
  assert.equal(replaceWikiLinks("[[A|b|c]]"), "A", "a label may hold |");
  assert.equal(replaceWikiLinks("[[A|[[B]]"), "A");
  assert.equal(replaceWikiLinks("[[A]x]] [[B]]"), "[[A]x]] B");
  assert.deepEqual(wikiLinkTargets("no links"), []);
  linear("links", () => {
    replaceWikiLinks("[[".repeat(100_000) + "]");
    replaceWikiLinks("[[a|".repeat(50_000) + "]");
    replaceWikiLinks("[".repeat(200_000) + "]x");
    wikiLinkTargets("[[a|b]".repeat(40_000));
  });
});

test("a final parenthesis and the spaces around it are dropped", () => {
  assert.equal(stripTrailingParenthesis("Mag42 (''Touch the Stars'')"), "Mag42");
  assert.equal(stripTrailingParenthesis("A (b) c (d)  "), "A (b) c");
  assert.equal(stripTrailingParenthesis("A (b) (c (d)"), "A (b)", "the parenthesis opens after the previous )");
  assert.equal(stripTrailingParenthesis("A (b (c) )"), "A (b (c) )", "no ( after the previous )");
  assert.equal(stripTrailingParenthesis("A (b) c"), "A (b) c");
  assert.equal(stripTrailingParenthesis("A b)"), "A b)");
  assert.equal(stripTrailingParenthesis(")"), ")");
  assert.equal(stripTrailingParenthesis("()"), "");
  linear("trailing parenthesis", () => {
    stripTrailingParenthesis("(".repeat(200_000) + "x");
    stripTrailingParenthesis(" ".repeat(200_000) + "x)");
    stripTrailingParenthesis("a" + " ".repeat(200_000) + "(b)");
  });
});

test("the first parenthesis is the role of a credit", () => {
  assert.equal(firstParenthesis("Mag42 (original design by [[Wei@W]]) (x)"), "original design by [[Wei@W]]");
  assert.equal(firstParenthesis("a (b (c) d"), "b (c");
  assert.equal(firstParenthesis("a (b"), undefined);
  assert.equal(firstParenthesis("a) b"), undefined);
  linear("first parenthesis", () => firstParenthesis("(".repeat(200_000)));
});

test("the illustrator field runs to the next field or the end of the template", () => {
  assert.equal(illustratorFieldValue("{{Operator\n|Illustrator = *A\n*B (skin)\n| record  =x\n}}"), " *A\n*B (skin)");
  assert.equal(illustratorFieldValue("|illustrator=A\n}}"), "A");
  assert.equal(illustratorFieldValue("|illustrator=A\n|cv\n  = x"), "A", "spaces and line breaks may precede the =");
  assert.equal(illustratorFieldValue("|illustrator=A\n|=x\n}}"), "A\n|=x", "a field needs a name");
  assert.equal(illustratorFieldValue("|illustrator=\n|x=1"), "");
  assert.equal(illustratorFieldValue("|illustrator=A\n|cv"), undefined, "a field that never ends");
  assert.equal(illustratorFieldValue("|name=A\n}}"), undefined);
  linear("illustrator field", () => {
    illustratorFieldValue("|illustrator =" + "\n|".repeat(100_000));
    illustratorFieldValue("|illustrator =\n|" + " ".repeat(200_000));
    illustratorFieldValue("|illustrator =\n|a" + "\n".repeat(200_000));
    illustratorFieldValue("|illustrator =".repeat(20_000));
    illustratorFieldValue("|" + " ".repeat(200_000) + "illustrator");
  });
});

test("the extractor keeps its results and stays linear on hostile pages", () => {
  const page = "{{Operator\n|skin1 = Touch the Stars\n|illustrator = *[[Wei@W|唯@W]]\n*Mag42 (''Touch the Stars'')\n*<b>Kuroduke</b> (Operator art)\n*[[A]] & [[B]] (E2 artwork)\n|cv = x\n}}";
  assert.deepEqual(extractArtists(page), [
    { name: "Wei@W", evidence: "|illustrator = [[Wei@W|唯@W]]" },
    { name: "Kuroduke", role: "Operator art", evidence: "|illustrator = <b>Kuroduke</b> (Operator art)" },
    { name: "A & B", role: "E2 artwork", evidence: "|illustrator = [[A]] & [[B]] (E2 artwork)" },
  ]);
  assert.equal(extractIllustratorField("|illustrator =  \n}}"), null);
  const credits = creditsFor({ operatorId: "char_x", operatorName: "X", source: {}, status: "partial", general: extractArtists(page) });
  assert.deepEqual(credits.map((credit) => [credit.artist, credit.role]), [["Wei@W", "unknown"], ["Kuroduke", "operator-illustration"], ["A", "effects"], ["B", "effects"]]);
  linear("extractor", () => {
    extractArtists("|illustrator =\n" + "<(".repeat(50_000) + "\n}}");
    extractArtists("|illustrator =\n*" + "[[a|".repeat(40_000) + "\n}}");
    extractArtists("|illustrator =\n*a" + " ".repeat(200_000) + "(b\n}}");
  });
});

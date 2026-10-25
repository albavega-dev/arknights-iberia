/**
 * Known defects in the source skill data. This is the only place that lists them: the skills generator accepts a
 * description marker without a value only when it is declared here.
 * - Without `fix`, the generator records the key in the level's `absentKeys` and the interface shows a dash with a note.
 * - With `fix`, the value is taken from the level field named there and the key is recorded in `correctedKeys`;
 *   the correction must cite an independent source that agrees with the value at every level.
 */
export type SkillDataGapFix = Readonly<{
  /** Level field that supplies the missing blackboard value. */
  from: "duration";
  source: string;
  checked: string;
}>;

export type SkillDataGap = Readonly<{
  skillId: string;
  /** Operator that owns the skill (informational; the skill id is the lookup key). */
  operatorId: string;
  /** Blackboard key used by the description but missing from the source blackboard. */
  key: string;
  note: string;
  fix?: SkillDataGapFix;
}>;

export const skillDataGaps: readonly SkillDataGap[] = [
  {
    skillId: "skchr_zebra_1",
    operatorId: "char_304_zebra",
    key: "duration",
    note: "Heavyrain skill 1: the description uses {duration} but the blackboard has no such key at any level.",
    fix: {
      from: "duration",
      source: "https://arknights.wiki.gg/wiki/Heavyrain (Emergency Camouflage: 4 seconds at every skill level 1-10, matching the level field duration = 4)",
      checked: "2026-10-26",
    },
  },
];

export function findSkillDataGap(skillId: string, key: string, gaps: readonly SkillDataGap[] = skillDataGaps): SkillDataGap | undefined {
  return gaps.find((gap) => gap.skillId === skillId && gap.key.toLowerCase() === key.toLowerCase());
}

/** Text shown in place of an absent value; the note explains it without guessing the number. */
export const absentValueDisplay = "—";
export const absentValueNote = "Dato ausente en el origen del juego";

/**
 * Public English labels for subclass identifiers in the fixed EN snapshot.
 * The technical identifier remains the source-of-truth value.
 */
export const operatorArchetypeLabels: Readonly<Record<string, string>> = {
  agent: "Agent", alchemist: "Alchemist", aoesniper: "Artilleryman", artsfghter: "Arts Fighter", artsprotector: "Arts Protector",
  bard: "Bard", bearer: "Standard Bearer", blessing: "Abjurer", blastcaster: "Blast Caster", bombarder: "Flinger", centurion: "Centurion", chain: "Chain Caster", chainhealer: "Chain Medic",
  charger: "Charger", closerange: "Heavyshooter", corecaster: "Core Caster", counsellor: "Hexer", craftsman: "Artificer", crusher: "Crusher", dollkeeper: "Dollkeeper",
  duelist: "Duelist", executor: "Executor", fastshot: "Marksman", fearless: "Dreadnought", fighter: "Fighter", fortress: "Fortress",
  funnel: "Mech-Accord Caster", geek: "Geek", guardian: "Guardian", hammer: "Earthshaker", healer: "Therapist",
  hookmaster: "Hookmaster", hunter: "Hunter", incantationmedic: "Incantation Medic", instructor: "Instructor", librator: "Liberator",
  longrange: "Deadeye", loopshooter: "Loopshooter", lord: "Lord", mercenary: "Mercenary", merchant: "Merchant", musha: "Musha", mystic: "Mystic Caster",
  phalanx: "Phalanx Caster", physician: "Physician", pioneer: "Pioneer", primcaster: "Primal Caster", primguard: "Primal Guard",
  primprotector: "Primal Protector", protector: "Protector", pusher: "Push Stroker", reaper: "Reaper", ritualist: "Ritualist",
  shotprotector: "Shot Protector", siegesniper: "Besieger", skybreaker: "Skybreaker", skywalker: "Skywalker", slower: "Decel Binder", soulcaster: "Shaper Caster",
  reaperrange: "Spreadshooter", ringhealer: "Multi-target Medic",
  splashcaster: "Splash Caster", stalker: "Ambusher", summoner: "Summoner",
  // CN-only in the fixed snapshot; public English presentation label, not an EN snapshot field.
  supportiveranger: "Supportive Ranger", sword: "Swordmaster", tactician: "Tactician", traper: "Trapmaster",
  underminer: "Hexer", unyield: "Juggernaut", wandermedic: "Wandering Medic", watchman: "Watchman",
};

/** Every subclass ID observed in the fixed EN snapshot, including unresolved IDs. */
export const knownOperatorArchetypeIds = [
  "agent", "alchemist", "aoesniper", "artsfghter", "artsprotector", "bard", "bearer", "blessing", "blastcaster", "bombarder", "centurion",
  "chain", "chainhealer", "charger", "closerange", "corecaster", "counsellor", "craftsman", "crusher", "dollkeeper", "duelist",
  "executor", "fastshot", "fearless", "fighter", "fortress", "funnel", "geek", "guardian", "hammer", "healer", "hookmaster",
  "hunter", "incantationmedic", "instructor", "librator", "longrange", "loopshooter", "lord", "mercenary", "merchant", "musha",
  "mystic", "notchar1", "notchar2", "phalanx", "physician", "pioneer", "primcaster", "primguard", "primprotector", "protector",
  "pusher", "reaper", "reaperrange", "ringhealer", "ritualist", "shotprotector", "siegesniper", "skybreaker", "skywalker", "slower",
  "soulcaster", "splashcaster", "stalker", "summoner", "sword", "tactician", "traper", "underminer", "unyield", "wandermedic", "watchman",
] as const;

export function getOperatorArchetypeName(subClassId: string): string {
  return operatorArchetypeLabels[subClassId] ?? subClassId;
}

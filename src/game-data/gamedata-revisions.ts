export type GameDataRegion = "en" | "cn";
export type GameDataTable = "character_table" | "uniequip_table" | "battle_equip_table";

export const gameDataRepository = "ArknightsAssets/ArknightsGamedata";

// Pinned GameData commits shared by the stats manifest, the operator bundle and tactical data.
export const gameDataRevisions: Readonly<Record<GameDataRegion, string>> = {
  en: "409bce70516f2420af61b1fc5680da60e448ab99",
  cn: "84bbfbb4978f3545645264bf741356a64909439f",
};

export const gameDataTableHashes: Readonly<Record<GameDataRegion, Readonly<Record<GameDataTable, string>>>> = {
  en: {
    character_table: "CA0663517EC917AEC88A11A41D1B38611EAC29A5B5353DABC459B0102591D9E4",
    uniequip_table: "211A60007795D0337A6D55ADE85AA2038EA0842957038324829F9E78A99579ED",
    battle_equip_table: "B34715324F31C601ED0D45A7C7945091EF0FDFC2F7FBD9C7D39C8A89CD89B502",
  },
  cn: {
    character_table: "F199EF7ED94A8CE4AF05DAE6657B3E340F85CAB5F6EA010D2F394696F49E91F5",
    uniequip_table: "D4E9D6A404117ED695EBCFFDDDF329BE61A389AD6679D1E5DFF23BB121FC9F61",
    battle_equip_table: "1E52FEC685F1D3C193F3AAA64A47E94D41F5C191C61D5EDA86A958F832B0719E",
  },
};

export type GameDataSkillTable = "skill_table" | "range_table" | "gamedata_const";

export const gameDataSkillTableHashes: Readonly<Record<GameDataRegion, Readonly<Record<GameDataSkillTable, string>>>> = {
  en: {
    skill_table: "1F4B1BA220A2ABB11A06FDA66B715695EBE1B56F4C6C1583E33A4E20C4B81F0A",
    range_table: "A98344D688A8933C4DD7DDAAE3CB76C4347295359A18B60B918042CC2542D9D9",
    gamedata_const: "4A8DEF16D1F6125B0C8FCDF2451AEBAC8AA27BFED784D1B9B5F5A3EBCC35231D",
  },
  cn: {
    skill_table: "0E134340D77DFF0404011F6419277FEDD7F93693778DD2B1F1AD3C1AE29F5F06",
    range_table: "A98344D688A8933C4DD7DDAAE3CB76C4347295359A18B60B918042CC2542D9D9",
    gamedata_const: "2FBA9C59C47E1D2173EEED074F87EEA844D9226FAE406DA3D6D3DE3D21E637EB",
  },
};

// Base (infrastructure) skills of each operator.
export type GameDataBuildingTable = "building_data";

export const gameDataBuildingTableHashes: Readonly<Record<GameDataRegion, Readonly<Record<GameDataBuildingTable, string>>>> = {
  en: { building_data: "9D07CDBCD1BA466E6329756D9500CC1AF9405B55B5D31E797A13B8857FCD8EF1" },
  cn: { building_data: "15556552590AE1A5D1AC82C2008199448318F364C9ADB0F4747438E17675E824" },
};

// Trust frames: favor points and their trust percentage.
export type GameDataFavorTable = "favor_table";

export const gameDataFavorTableHashes: Readonly<Record<GameDataRegion, Readonly<Record<GameDataFavorTable, string>>>> = {
  en: { favor_table: "A4A015E0166EFF88497E5D2C94E6EF5DEF2AC16D5F5B970054356AAC598A26EF" },
  cn: { favor_table: "A4A015E0166EFF88497E5D2C94E6EF5DEF2AC16D5F5B970054356AAC598A26EF" },
};

// Handbook (biography) text of every operator.
export type GameDataHandbookTable = "handbook_info_table";

export const gameDataHandbookTableHashes: Readonly<Record<GameDataRegion, Readonly<Record<GameDataHandbookTable, string>>>> = {
  en: { handbook_info_table: "07077CD529965C57DA1F602028F1CEEC81B43814AF0D8F131DCBED92B04E0498" },
  cn: { handbook_info_table: "B6E6FA4CAFE118B8C0342E7643A6103775F72C173A43467AEEA22DFBEE01D108" },
};

// CN release dates: banner openings and Integrated Strategies topics. Pinned for CN only.
export type GameDataReleaseTable = "gacha_table" | "roguelike_topic_table";

export const gameDataReleaseTableHashes: Readonly<Record<GameDataRegion, Readonly<Partial<Record<GameDataReleaseTable, string>>>>> = {
  en: {},
  cn: {
    gacha_table: "206C273D2E7DB0C82A29B448450224C43EBD10104DC004301798AE17FE0D0748",
    roguelike_topic_table: "A923AE051FAD0215DD79CBB488B479522A85A8ADB794B879AD147C7C26E6743C",
  },
};

/** Every table pinned for a region, with its SHA-256. */
export function pinnedGameDataTableHashes(region: GameDataRegion): Readonly<Record<string, string>> {
  return {
    ...gameDataTableHashes[region], ...gameDataSkillTableHashes[region], ...gameDataBuildingTableHashes[region], ...gameDataFavorTableHashes[region],
    ...gameDataHandbookTableHashes[region], ...gameDataReleaseTableHashes[region],
  } as Readonly<Record<string, string>>;
}

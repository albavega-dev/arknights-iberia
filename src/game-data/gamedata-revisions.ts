export type GameDataRegion = "en" | "cn";
export type GameDataTable = "character_table" | "uniequip_table" | "battle_equip_table";

export const gameDataRepository = "ArknightsAssets/ArknightsGamedata";

// Pinned GameData commits shared by the stats manifest, the operator bundle and tactical data.
export const gameDataRevisions: Readonly<Record<GameDataRegion, string>> = {
  en: "3aaa25b649fed5dedad9527602826dc487ea07d8",
  cn: "e4888c5b4d9b57aa3bfd4d109ae70f74cf3b7842",
};

export const gameDataTableHashes: Readonly<Record<GameDataRegion, Readonly<Record<GameDataTable, string>>>> = {
  en: {
    character_table: "DDAC29AF8BF303D3DFDD92EC7D6C822605EABD0625AE544B97434DE517F9E7C3",
    uniequip_table: "211A60007795D0337A6D55ADE85AA2038EA0842957038324829F9E78A99579ED",
    battle_equip_table: "B34715324F31C601ED0D45A7C7945091EF0FDFC2F7FBD9C7D39C8A89CD89B502",
  },
  cn: {
    character_table: "12652FA249763EA1D1F8F147F2EFE6A98EFEE593F38DBEF471DDBC9A234B70E5",
    uniequip_table: "D4E9D6A404117ED695EBCFFDDDF329BE61A389AD6679D1E5DFF23BB121FC9F61",
    battle_equip_table: "1E52FEC685F1D3C193F3AAA64A47E94D41F5C191C61D5EDA86A958F832B0719E",
  },
};

export type GameDataSkillTable = "skill_table" | "range_table" | "gamedata_const";

export const gameDataSkillTableHashes: Readonly<Record<GameDataRegion, Readonly<Record<GameDataSkillTable, string>>>> = {
  en: {
    skill_table: "C70AAB798F37A07C5D1BB30D0E596260F8FC2458773A33A573660E1144C58900",
    range_table: "A98344D688A8933C4DD7DDAAE3CB76C4347295359A18B60B918042CC2542D9D9",
    gamedata_const: "F45652A5C0DAB05A9774C286B9E21655569D24B809C1678BAE3D15D08A97CACD",
  },
  cn: {
    skill_table: "A3B1A5680421BA32465211E3876475E1AAD116CFCCC63755352AE667559A6E88",
    range_table: "A98344D688A8933C4DD7DDAAE3CB76C4347295359A18B60B918042CC2542D9D9",
    gamedata_const: "DA2F59B8213AFBF7E1F745A092B48B0106A5D1B8903B9D73DC2883918B688231",
  },
};

// Base (infrastructure) skills of each operator.
export type GameDataBuildingTable = "building_data";

export const gameDataBuildingTableHashes: Readonly<Record<GameDataRegion, Readonly<Record<GameDataBuildingTable, string>>>> = {
  en: { building_data: "A46851367F3844E3EFB37C9C540BA0AE55A8F5D46360F2B24CD4AE44DDC152C4" },
  cn: { building_data: "824CB228DD44697B469ECAE907ED835C74DA32068589CB52F352D4D32EB0F0F9" },
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
    gacha_table: "40F7CFEE04EA9DDC48D717F64EA9EB0C608514A2D94FC3F0800A1B93F7EE98AF",
    roguelike_topic_table: "9C9B9527A3B22A8776A3554117506623EBEBAE7DFF2E688B12F7C0864DD19850",
  },
};

/** Every table pinned for a region, with its SHA-256. */
export function pinnedGameDataTableHashes(region: GameDataRegion): Readonly<Record<string, string>> {
  return {
    ...gameDataTableHashes[region], ...gameDataSkillTableHashes[region], ...gameDataBuildingTableHashes[region], ...gameDataFavorTableHashes[region],
    ...gameDataHandbookTableHashes[region], ...gameDataReleaseTableHashes[region],
  } as Readonly<Record<string, string>>;
}

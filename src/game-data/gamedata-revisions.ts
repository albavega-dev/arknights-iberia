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

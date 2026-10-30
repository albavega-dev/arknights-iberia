import { compareCodeUnits } from "./string-order";
import modesData from "../../data/operator-module-modes.json";

// Names of the game modes and Integrated Strategies themes that module effects are limited to, with their sources. The file is
// small on purpose: the module generator and the interface read it instead of the large roguelike and sandbox tables.
export type ModuleModeName = Readonly<{ name: string; region?: string; source: Readonly<Record<string, string>> }>;
export type ModuleModeNames = Readonly<{ gameTags: Readonly<Record<string, ModuleModeName>>; mapTags: Readonly<Record<string, ModuleModeName>> }>;

export const moduleModeNames = modesData as ModuleModeNames;

/** Mode tags a module profile uses that have no name in the file. */
export function unnamedModeTags(tags: Iterable<{ gameTag?: string | null; mapTag?: string | null }>, names: ModuleModeNames = moduleModeNames): string[] {
  const missing = new Set<string>();
  for (const tag of tags) {
    if (tag.gameTag && !names.gameTags[tag.gameTag]) missing.add(`gameTag ${tag.gameTag}`);
    if (tag.mapTag && !names.mapTags[tag.mapTag]) missing.add(`mapTag ${tag.mapTag}`);
  }
  return [...missing].sort(compareCodeUnits);
}

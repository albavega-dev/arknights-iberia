// Builds paths under /assets/.
export const assetsRoot = "/assets";

export function assetPath(directory: string, file: string): string {
  if (!/^[a-z0-9-]+$/.test(directory)) throw new Error(`Invalid asset directory: ${directory}`);
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(file)) throw new Error(`Invalid asset file: ${file}`);
  return `${assetsRoot}/${directory}/${file}`;
}

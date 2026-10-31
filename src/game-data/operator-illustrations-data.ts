import "server-only";

import imageManifest from "../../data/operator-image-manifest.json";
import { illustrationAssetsFrom, type OperatorIllustrationAssets } from "./operator-assets";

// Read on the server so the image manifest never reaches the client bundles.
export function getOperatorIllustrationAssets(operatorId: string): OperatorIllustrationAssets | null {
  return illustrationAssetsFrom(imageManifest.illustrations, operatorId);
}

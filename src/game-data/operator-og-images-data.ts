import "server-only";

import ogManifest from "../../data/operator-og-manifest.json";
import { ogImageUrlFrom } from "./operator-og-images";

// Read on the server so the manifest never reaches the client bundles.
export function getOperatorOgImageUrl(operatorId: string): string {
  return ogImageUrlFrom(ogManifest.images, operatorId);
}

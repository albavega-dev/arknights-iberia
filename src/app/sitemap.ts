import type { MetadataRoute } from "next";

import { listOperatorRecords } from "../game-data/operator-catalog-data";
import { buildSitemap, getSiteOrigin } from "../game-data/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return buildSitemap(getSiteOrigin(), listOperatorRecords());
}

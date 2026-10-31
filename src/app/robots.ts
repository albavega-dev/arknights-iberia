import type { MetadataRoute } from "next";

import { buildRobots, getSiteOrigin } from "../game-data/seo";

export default function robots(): MetadataRoute.Robots {
  return buildRobots(getSiteOrigin());
}

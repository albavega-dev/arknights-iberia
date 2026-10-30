import { connection } from "next/server";

import { biographiesIndexErrors } from "@/game-data/operator-biographies-data";
import { catalogErrors } from "@/game-data/operator-catalog-data";
import { modulesIndexErrors } from "@/game-data/operator-modules-data";
import { skillsIndexErrors } from "@/game-data/operator-skills-data";
import { statsIndexErrors } from "@/game-data/operator-stats-data";

const datasetChecks = [catalogErrors, biographiesIndexErrors, statsIndexErrors, skillsIndexErrors, modulesIndexErrors];

export async function GET() {
  await connection();
  const ready = datasetChecks.every((check) => check().length === 0);
  return Response.json(
    { status: ready ? "ok" : "unavailable" },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

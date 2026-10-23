import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    <img {...props} data-testid="next-image" data-unoptimized={props.unoptimized === true ? "true" : "false"} />
  ),
}));

import { OperatorDetailData } from "../../src/app/operators/[slug]/operator-detail-data";
import { OperatorTacticalInfo } from "../../src/app/operators/[slug]/operator-tactical-info";
import type { OperatorRecord } from "../../src/game-data/operators";

const operator: OperatorRecord = {
  id: "char_component_test",
  name: "Component Test",
  cnName: null,
  globalName: null,
  class: "Medic",
  subClassId: "healer",
  rarity: 5,
  slug: "component-test",
  cnOnly: false,
  availabilityStatus: "global-snapshot",
  cnReleaseDate: null,
  globalReleaseDate: null,
  mainPowerNationId: null,
  mainPowerGroupId: null,
  mainPowerTeamId: null,
  mainFactionId: null,
};

describe("OperatorDetailData image policy", () => {
  it("marks subclass icons unoptimized and keeps regular icons optimized", () => {
    render(
      <OperatorDetailData
        operator={operator}
        biography={{ status: "not-found", operatorId: operator.id, region: "en", revision: "test" }}
        tactical={null}
        artistCredit={null}
      />,
    );

    const images = screen.getAllByTestId("next-image");
    expect(images).toHaveLength(2);
    expect(images.filter((image) => image.getAttribute("data-unoptimized") === "true")).toHaveLength(1);
    expect(images.filter((image) => image.getAttribute("data-unoptimized") === "false")).toHaveLength(1);
  });

  it("shows a loading state while the E2 illustration transitions", () => {
    const operatorWithIllustrations: OperatorRecord = {
      ...operator,
      id: "char_002_amiya",
      class: "Caster",
      subClassId: null,
    };

    render(
      <OperatorDetailData
        operator={operatorWithIllustrations}
        biography={{ status: "not-found", operatorId: operatorWithIllustrations.id, region: "en", revision: "test" }}
        tactical={null}
        artistCredit={null}
      />,
    );

    expect(document.querySelector(".operator-detail-illustration")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "E2" }));

    const loadingArt = document.querySelector(".operator-detail-art");
    expect(loadingArt).toHaveAttribute("aria-busy", "true");
    const preload = document.querySelector(".operator-detail-illustration-preload");
    expect(preload).toBeInTheDocument();

    fireEvent.load(preload!);

    const eliteTwo = document.querySelector(".operator-detail-illustration.is-elite2");
    expect(eliteTwo).toBeInTheDocument();
    expect(loadingArt).toHaveAttribute("aria-busy", "true");

    fireEvent.load(eliteTwo!);
    expect(document.querySelector(".operator-detail-illustration.is-elite2")).toBeInTheDocument();
  });

  it("renders the tactical tags heading and supplied tags", () => {
    render(
      <OperatorTacticalInfo
        entry={{
          id: "char_002_amiya",
          source: { region: "en", revision: "test" },
          position: "RANGED",
          tags: ["DPS"],
          phases: [
            { phase: 0, rangeId: "3-6", rangeKey: "en:3-6" },
            { phase: 1, rangeId: "3-1", rangeKey: "en:3-1" },
            { phase: 2, rangeId: "3-1", rangeKey: "en:3-1" },
          ],
        }}
      />,
    );

    expect(screen.getByText("Etiquetas")).toBeInTheDocument();
    expect(screen.getByText("DPS")).toBeInTheDocument();
  });
});

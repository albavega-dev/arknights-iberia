import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import NotFound from "../../src/app/not-found";

describe("NotFound", () => {
  it("explains the error in Spanish", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Esta ruta no llega a ningún puerto");
  });
});

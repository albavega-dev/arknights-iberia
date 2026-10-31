import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HydrationMarker } from "../../src/app/hydration-marker";

describe("HydrationMarker", () => {
  it("lists every mounted scope on <html> and removes each one when it unmounts", () => {
    const site = render(<HydrationMarker scope="site" />);
    const catalog = render(<HydrationMarker scope="catalog" />);
    expect(document.documentElement.dataset.hydrated).toBe("site catalog");

    catalog.unmount();
    expect(document.documentElement.dataset.hydrated).toBe("site");

    site.unmount();
    expect(document.documentElement.hasAttribute("data-hydrated")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { withOwnFirst } from "./useOwnDivision";

describe("withOwnFirst", () => {
  const divisions = [
    { division_id: "a", name: "Primera" },
    { division_id: "b", name: "Intermedia" },
    { division_id: "c", name: "M19" },
  ];

  it("mueve la división propia al frente sin tocar el resto del orden", () => {
    expect(withOwnFirst(divisions, "c").map((d) => d.division_id)).toEqual([
      "c", "a", "b",
    ]);
  });

  it("sin división propia (socio) conserva el orden que ya trae la API", () => {
    expect(withOwnFirst(divisions, null)).toEqual(divisions);
  });

  it("si la propia ya está primera, no reordena nada", () => {
    expect(withOwnFirst(divisions, "a").map((d) => d.division_id)).toEqual([
      "a", "b", "c",
    ]);
  });
});

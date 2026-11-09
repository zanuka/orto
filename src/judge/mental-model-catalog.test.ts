import { describe, expect, it } from "vitest";
import {
  catalogEntriesNotIn,
  listMentalModelCatalog,
  renderCatalogSourceQuery,
} from "./mental-model-catalog.js";

describe("mental model catalog", () => {
  it("includes standing questions beyond the starter three", () => {
    const ids = listMentalModelCatalog().map((entry) => entry.id);
    expect(ids).toContain("project-context");
    expect(ids).toContain("module-boundaries");
    expect(ids).toContain("auth-and-identity");
    expect(ids).toContain("release-process");
  });

  it("filters entries already declared in the template", () => {
    const remaining = catalogEntriesNotIn(
      new Set(["project-context", "architecture-decisions", "coding-standards"]),
    );
    expect(remaining.map((entry) => entry.id)).not.toContain("project-context");
    expect(remaining.map((entry) => entry.id)).toContain("module-boundaries");
  });

  it("renders source queries with the project name", () => {
    const entry = listMentalModelCatalog().find(
      (item) => item.id === "module-boundaries",
    );
    expect(entry).toBeDefined();
    expect(renderCatalogSourceQuery(entry!, "Orto")).toContain("Orto");
  });
});

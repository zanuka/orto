import { describe, expect, it } from "vitest";
import {
  catalogEntriesNotIn,
  catalogProposalCreateSpec,
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

  it("maps catalog kinds onto create tags and refresh defaults", () => {
    const architecture = catalogProposalCreateSpec({
      id: "module-boundaries",
      title: "Module Boundaries",
      kind: "architecture",
      sourceQuery: "What are the module boundaries?",
    });
    expect(architecture.tags).toEqual(["knowledge:architecture"]);
    expect(architecture.refreshAfterConsolidation).toBe(true);

    const standard = catalogProposalCreateSpec({
      id: "testing-conventions",
      title: "Testing Conventions",
      kind: "standard",
      sourceQuery: "What testing conventions apply?",
    });
    expect(standard.tags).toEqual(["knowledge:standard"]);
    expect(standard.refreshAfterConsolidation).toBe(false);
    expect(standard.maxTokens).toBe(1536);
  });
});

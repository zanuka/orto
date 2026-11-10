import { describe, expect, it } from "vitest";
import {
  RETAIN_TAG_AXIS_IDS,
  composeRetainTags,
  retainTagCatalog,
  retainTagQuestions,
} from "./retain-tags.js";
import { relevanceQuestions } from "./relevance.js";

describe("retain tags", () => {
  it("loads a versioned catalog with layer, domain, and stability axes", () => {
    const catalog = retainTagCatalog();
    expect(catalog.version).toBe(1);
    expect(catalog.axes.map((axis) => axis.id)).toEqual([
      ...RETAIN_TAG_AXIS_IDS,
    ]);
    expect(catalog.axes[0]?.choices.some((choice) => choice.tag === "layer:platform")).toBe(
      true,
    );
    expect(
      catalog.axes[2]?.choices.map((choice) => choice.id).sort(),
    ).toEqual(["evolving", "frozen"]);
  });

  it("exposes one Choice question per axis", () => {
    const questions = retainTagQuestions();
    expect(Object.keys(questions)).toEqual(["layer", "domain", "stability"]);
    expect(questions.layer?.type).toBe("choice");
    expect(relevanceQuestions().layer).toEqual(questions.layer);
  });

  it("composes only confident tags from judge answers", () => {
    const composed = composeRetainTags({
      confidence: 0.8,
      answers: {
        layer: {
          type: "choice",
          choice: "platform",
          probabilities: { platform: 0.91 },
          confidence: 0.91,
        },
        domain: {
          type: "choice",
          choice: "engineering",
          probabilities: { engineering: 0.4 },
          confidence: 0.4,
        },
        stability: {
          type: "choice",
          choice: "frozen",
          probabilities: { frozen: 0.88 },
          confidence: 0.88,
        },
      },
    });
    expect(composed.tags).toEqual(["layer:platform", "stability:frozen"]);
    expect(composed.axes.map((item) => item.axis)).toEqual([
      "layer",
      "stability",
    ]);
  });

  it("ignores unrecognized choices", () => {
    const composed = composeRetainTags({
      confidence: 0.8,
      answers: {
        layer: {
          type: "choice",
          choice: "not-a-layer",
          probabilities: {},
          confidence: 0.99,
        },
      },
    });
    expect(composed.tags).toEqual([]);
  });
});

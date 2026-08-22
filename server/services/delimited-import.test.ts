import { describe, expect, it } from "vitest";
import {
  buildDelimitedCandidates,
  splitDelimitedImport,
  type DelimitedMetadata,
} from "./delimited-import.js";

const novak = `How much discipline? In January 2012, I beat Nadal in the finals of the Australian Open.
$ The match lasted five hours and fifty-three minutes-the longest match in Australian Open history,
$ and the longest Grand Slam singles final in the Open Era.
$ Many commentators have called that match the single greatest tennis match of all time. 
$ After I won, I sat in the locker room in Melbourne. I wanted one thing: to taste chocolate. 
$ I hadn't tasted it since the summer of 2010.
$ Miljan brought me a candy bar. I broke off one square-one tiny square
$ -and popped it into my mouth, let it melt on my tongue. 
$ That was all I would allow myself. That is what it has taken to get to number one.`;

const metadata = (position: number, focusTerms: string[] = []): DelimitedMetadata => ({
  position,
  cue: `Перевод ${position}`,
  note: "",
  category: "Novak Djokovic, Discipline",
  focusTerms,
  disposition: "active",
  frequencyBand: "common",
  currency: "current",
  personaFit: 4,
  naturalness: 5,
  commonness: 4,
});

describe("$ delimited import", () => {
  it("turns novak.txt into nine exact whitespace-normalized targets", () => {
    const fragments = splitDelimitedImport(novak);
    expect(fragments).toHaveLength(9);
    expect(fragments).toEqual([
      "How much discipline? In January 2012, I beat Nadal in the finals of the Australian Open.",
      "The match lasted five hours and fifty-three minutes-the longest match in Australian Open history,",
      "and the longest Grand Slam singles final in the Open Era.",
      "Many commentators have called that match the single greatest tennis match of all time.",
      "After I won, I sat in the locker room in Melbourne. I wanted one thing: to taste chocolate.",
      "I hadn't tasted it since the summer of 2010.",
      "Miljan brought me a candy bar. I broke off one square-one tiny square",
      "-and popped it into my mouth, let it melt on my tongue.",
      "That was all I would allow myself. That is what it has taken to get to number one.",
    ]);
    const candidates = buildDelimitedCandidates(fragments, fragments.map((_, index) => metadata(index + 1)));
    expect(candidates.map((candidate) => candidate.target)).toEqual(fragments);
  });

  it("includes text before the first delimiter and discards empty fragments", () => {
    expect(splitDelimitedImport(" before  first  $ $ after\nsecond $ ")).toEqual([
      "before first", "after second",
    ]);
  });

  it("rejects fragment limits before calling the model", () => {
    expect(() => splitDelimitedImport(Array.from({ length: 101 }, () => "card").join("$")))
      .toThrow("IMPORT_TOO_MANY_FRAGMENTS");
    expect(() => splitDelimitedImport(`ok$${"a".repeat(2_001)}`)).toThrow("IMPORT_FRAGMENT_TOO_LONG");
    expect(() => splitDelimitedImport("$  $ ")).toThrow("IMPORT_NO_FRAGMENTS");
  });

  it("rejects incomplete, reordered, or invalid focus metadata as one batch", () => {
    const fragments = ["I can pull through.", "It worked."];
    expect(() => buildDelimitedCandidates(fragments, [metadata(1)])).toThrow("INCOMPLETE_DELIMITED_IMPORT");
    expect(() => buildDelimitedCandidates(fragments, [metadata(2), metadata(1)]))
      .toThrow("INCOMPLETE_DELIMITED_IMPORT");
    expect(() => buildDelimitedCandidates(fragments, [metadata(1, ["missing"]), metadata(2)]))
      .toThrow("INVALID_IMPORT_FOCUS");
  });
});

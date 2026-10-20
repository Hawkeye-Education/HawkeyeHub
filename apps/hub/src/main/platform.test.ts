import { expect, test } from "vitest";
import { treeOf } from "./platform";

test("a tree is its root and every process descended from it, created after its parent", () => {
  const processes = [
    { pid: 10, parent: 1, created: 100n },
    { pid: 11, parent: 10, created: 110n },
    { pid: 12, parent: 11, created: 120n },
    // A sibling of the root: not in its tree.
    { pid: 20, parent: 1, created: 105n },
    // Its parent id is the root's, but it is older: an orphan of an earlier process with that id.
    { pid: 30, parent: 10, created: 90n },
    { pid: 31, parent: 30, created: 130n },
  ];
  expect(treeOf(10, processes).map(({ pid }) => pid)).toEqual([10, 11, 12]);
});

test("a root that is no longer running has no tree", () => {
  expect(treeOf(10, [{ pid: 11, parent: 10, created: 110n }])).toEqual([]);
});

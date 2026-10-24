import { expect, test } from "vitest";
import { treeOf } from "./platform";

const root = { pid: 10, parent: 1, created: 100n };

test("a tree is its root and every process descended from it, created after its parent", () => {
  const processes = [
    root,
    { pid: 11, parent: 10, created: 110n },
    { pid: 12, parent: 11, created: 120n },
    // A sibling of the root: not in its tree.
    { pid: 20, parent: 1, created: 105n },
    // Its parent id is the root's, but it is older: an orphan of an earlier process with that id.
    { pid: 30, parent: 10, created: 90n },
    { pid: 31, parent: 30, created: 130n },
  ];
  expect(treeOf([root], processes).map(({ pid }) => pid)).toEqual([10, 11, 12]);
});

test("a noted process that has exited still has the children that name it as their parent", () => {
  const processes = [
    { pid: 11, parent: 10, created: 110n },
    { pid: 12, parent: 11, created: 120n },
    { pid: 30, parent: 10, created: 90n },
  ];
  expect(treeOf([root], processes).map(({ pid }) => pid)).toEqual([10, 11, 12]);
});

test("a process noted twice is in the tree once", () => {
  const child = { pid: 11, parent: 10, created: 110n };
  expect(treeOf([root, child], [root, child])).toEqual([root, child]);
});

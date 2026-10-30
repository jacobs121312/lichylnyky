import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStates, fingerprint } from "../src/sync.js";

const laptop = { docs: { m1: { kind: "meter", name: "Газ", u: 100 }, r1: { kind: "reading", value: 10, u: 100 } }, deleted: {} };

test("an empty phone receives everything from the laptop", () => {
  assert.deepEqual(mergeStates({ docs: {}, deleted: {} }, laptop), laptop);
});

test("records added on each device end up on both", () => {
  const phone = { docs: { ...laptop.docs, r2: { kind: "reading", value: 12, u: 200 } }, deleted: {} };
  const pc = { docs: { ...laptop.docs, r3: { kind: "reading", value: 13, u: 210 } }, deleted: {} };
  assert.deepEqual(Object.keys(mergeStates(phone, pc).docs).sort(), ["m1", "r1", "r2", "r3"]);
});

test("the newer edit wins", () => {
  const a = { docs: { m1: { name: "Газ", u: 100 } }, deleted: {} };
  const b = { docs: { m1: { name: "Газ (кухня)", u: 300 } }, deleted: {} };
  assert.equal(mergeStates(a, b).docs.m1.name, "Газ (кухня)");
  assert.equal(mergeStates(b, a).docs.m1.name, "Газ (кухня)");
});

test("a deletion on one device is not undone by the other", () => {
  const phone = { docs: { m1: laptop.docs.m1 }, deleted: { r1: 150 } };
  const merged = mergeStates(laptop, phone);
  assert.equal(merged.docs.r1, undefined);
  assert.equal(merged.deleted.r1, 150);
});

test("a record edited after it was deleted elsewhere is kept", () => {
  const merged = mergeStates({ docs: { r1: { value: 11, u: 400 } }, deleted: {} }, { docs: {}, deleted: { r1: 150 } });
  assert.equal(merged.docs.r1.value, 11);
});

test("old data without timestamps still merges", () => {
  const merged = mergeStates({ docs: { a: { v: 1 } } }, null);
  assert.deepEqual(merged.docs, { a: { v: 1 } });
});

test("fingerprint changes only when data changes", () => {
  assert.equal(fingerprint(laptop), fingerprint(mergeStates(laptop, laptop)));
  assert.notEqual(fingerprint(laptop), fingerprint({ ...laptop, deleted: { r1: 1 } }));
});

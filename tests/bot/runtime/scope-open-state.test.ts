import { describe, it, expect, beforeEach } from "vitest";
import {
  clearScopeOpenPathIndex,
  encodeScopedPathReference,
  decodeScopedPathReference,
  __resetScopeOpenStateForTests,
} from "../../../src/bot/runtime/scope-open-state.js";

describe("scope-open-state", () => {
  beforeEach(() => {
    __resetScopeOpenStateForTests();
  });

  it("should encode and decode a scoped path reference", () => {
    const ref = encodeScopedPathReference("scope-a", "/some/long/path");
    expect(ref).toMatch(/^#\d+$/);
    expect(decodeScopedPathReference("scope-a", ref)).toBe("/some/long/path");
  });

  it("should return null for unknown reference in a scope", () => {
    const ref = encodeScopedPathReference("scope-a", "/path-a");
    expect(decodeScopedPathReference("scope-b", ref)).toBeNull();
  });

  it("should isolate paths between different scopes", () => {
    const refA = encodeScopedPathReference("scope-a", "/path/a");
    const refB = encodeScopedPathReference("scope-b", "/path/b");

    expect(decodeScopedPathReference("scope-a", refA)).toBe("/path/a");
    expect(decodeScopedPathReference("scope-a", refB)).not.toBe("/path/b");
    expect(decodeScopedPathReference("scope-b", refB)).toBe("/path/b");
    expect(decodeScopedPathReference("scope-b", refA)).toBeNull();
  });

  it("should clear all paths for a specific scope", () => {
    const ref = encodeScopedPathReference("scope-a", "/path/to/clear");
    expect(decodeScopedPathReference("scope-a", ref)).toBe("/path/to/clear");

    clearScopeOpenPathIndex("scope-a");
    expect(decodeScopedPathReference("scope-a", ref)).toBeNull();
  });

  it("should not affect other scopes when clearing one scope", () => {
    const refB = encodeScopedPathReference("scope-b", "/path/keep");
    clearScopeOpenPathIndex("scope-a");
    expect(decodeScopedPathReference("scope-b", refB)).toBe("/path/keep");
  });

  it("should start fresh counter for each scope", () => {
    clearScopeOpenPathIndex("scope-a");
    const ref1 = encodeScopedPathReference("scope-a", "/path/1");
    const ref2 = encodeScopedPathReference("scope-a", "/path/2");
    expect(ref1).toBe("#0");
    expect(ref2).toBe("#1");
  });

  it("should return encoded path reference for short paths", () => {
    const shortPath = "/short";
    const ref = encodeScopedPathReference("scope-a", shortPath);
    expect(decodeScopedPathReference("scope-a", ref)).toBe("/short");
  });
});

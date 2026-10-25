import { afterEach, describe, expect, it } from "vitest";
import type { BagLine } from "./lines";
import { createBagStore, localStorageBagPersistence } from "./basket-store";

const LINE: BagLine = { kind: "PIECE", serviceId: "11111111-1111-4111-8111-111111111111", garmentTypeId: "33333333-3333-4333-8333-333333333333", pieceQuantity: 2 };

describe("F01-02 bag store", () => {
  it("starts empty and notifies subscribers on every change", () => {
    const store = createBagStore();
    expect(store.getLines()).toEqual([]);
    let updates = 0;
    const unsubscribe = store.subscribe(() => { updates++; });
    store.setLines([LINE]);
    store.setLines([]);
    unsubscribe();
    store.setLines([LINE]);
    expect(updates).toBe(2);
    expect(store.getLines()).toEqual([LINE]);
  });

  it("persists lines through the injected store and restores them", () => {
    let saved: BagLine[] | null = null;
    const store = createBagStore({ load: () => saved, save: (lines) => { saved = lines; } });
    store.setLines([LINE]);
    expect(saved).toEqual([LINE]);

    const restored = createBagStore({ load: () => saved, save: () => undefined });
    expect(restored.getLines()).toEqual([LINE]);
  });

  it("drops malformed persisted lines instead of throwing at mount", () => {
    const store = createBagStore({
      load: () => [LINE, { kind: "PIECE", serviceId: "nope" } as unknown as BagLine, null as unknown as BagLine],
      save: () => undefined,
    });
    expect(store.getLines()).toEqual([LINE]);
  });

  it("survives a persistence save failure", () => {
    const store = createBagStore({ load: () => null, save: () => { throw new Error("quota"); } });
    store.setLines([LINE]);
    expect(store.getLines()).toEqual([LINE]);
  });

  it("clears the bag and keeps persistence in sync", () => {
    let saved: BagLine[] | null = null;
    const store = createBagStore({ load: () => null, save: (lines) => { saved = lines; } });
    store.setLines([LINE]);
    store.clear();
    expect(saved).toEqual([]);
  });

  it("uses web localStorage when available and nothing on native", () => {
    expect(localStorageBagPersistence()).toBeUndefined();
    const backing = new Map<string, string>();
    const fakeStorage = {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => { backing.set(key, value); },
    };
    const globalScope = globalThis as { localStorage?: typeof fakeStorage };
    globalScope.localStorage = fakeStorage;
    try {
      const persistence = localStorageBagPersistence("test.bag");
      expect(persistence).toBeDefined();
      persistence!.save([LINE]);
      expect(backing.get("test.bag")).toContain("11111111");
      expect(persistence!.load()).toEqual([LINE]);
      backing.set("test.bag", "{not json");
      expect(persistence!.load()).toEqual([]);
    } finally {
      delete globalScope.localStorage;
    }
  });
});

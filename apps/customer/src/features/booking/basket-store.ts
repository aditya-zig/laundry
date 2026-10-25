import { isBagLine, type BagLine } from "./lines";

export interface BagPersistence {
  load(): BagLine[] | null;
  save(lines: BagLine[]): void;
}

export function localStorageBagPersistence(key = "laundry.customer.bag.v2"): BagPersistence | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return {
    load() {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return null;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isBagLine);
      } catch {
        return [];
      }
    },
    save(lines) {
      try {
        localStorage.setItem(key, JSON.stringify(lines));
      } catch {
      }
    },
  };
}

export interface BagStore {
  getLines(): BagLine[];
  setLines(lines: BagLine[]): void;
  clear(): void;
  subscribe(listener: () => void): () => void;
}

export function createBagStore(persistence?: BagPersistence): BagStore {
  let lines: BagLine[] = (persistence?.load() ?? []).filter(isBagLine);
  const listeners = new Set<() => void>();
  const store: BagStore = {
    getLines: () => lines,
    setLines: (next) => {
      lines = next;
      try {
        persistence?.save(lines);
      } catch {
      }
      for (const listener of [...listeners]) listener();
    },
    clear: () => store.setLines([]),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return store;
}

let singleton: BagStore | undefined;

export function bagStore(): BagStore {
  singleton ??= createBagStore(localStorageBagPersistence());
  return singleton;
}

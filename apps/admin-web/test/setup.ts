import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { Blob as NodeBlob } from "node:buffer";
import { afterEach } from "vitest";

const storage = new Map<string, string>();

Object.defineProperty(globalThis, "Blob", {
  configurable: true,
  value: NodeBlob,
});

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  },
});

afterEach(() => {
  cleanup();
  storage.clear();
});

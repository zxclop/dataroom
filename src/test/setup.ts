// Vitest runs in Node, where IndexedDB does not exist.
// fake-indexeddb provides an in-memory, spec-compliant implementation.
import "fake-indexeddb/auto";
import { __setLatency } from "@/api/dataroom";

__setLatency(0); // tests should not wait for simulated network

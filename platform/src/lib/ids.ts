import { randomUUID } from "node:crypto";
export const newId = () => randomUUID();
export const nowIso = () => new Date().toISOString();

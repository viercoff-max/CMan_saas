import "../../engine/__tests__/env"; // temp SQLite + DATA_DIR
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { notifyHandoff } from "../handoff";
import { addMessage, getOrCreateConversation, saveAgentSettings } from "../../store";

const outbox = () => path.join(process.env.DATA_DIR!, "outbox");
const filesFor = (convId: string) => (fs.existsSync(outbox()) ? fs.readdirSync(outbox()).filter((f) => f.includes(convId)) : []);

describe("notifyHandoff", () => {
  it("never writes an alert for the simulator channel", async () => {
    const tenantId = `t-${randomUUID()}`;
    saveAgentSettings(tenantId, { handoffEmail: "equipo@marca.mx" });
    const conv = getOrCreateConversation(tenantId, "simulator", "sim-user", "Simulador");
    addMessage(tenantId, conv.id, { direction: "in", sender: "customer", body: "mi freidora echó humo" });
    await notifyHandoff(tenantId, conv.id, "safety");
    expect(filesFor(conv.id)).toHaveLength(0);
  });

  it("writes an outbox file under DATA_DIR for real channels, with emails masked", async () => {
    const tenantId = `t-${randomUUID()}`;
    saveAgentSettings(tenantId, { handoffEmail: "equipo@marca.mx" });
    const conv = getOrCreateConversation(tenantId, "whatsapp", "521555", "Ana");
    addMessage(tenantId, conv.id, { direction: "in", sender: "customer", body: "pedido 1234 correo ana.lopez@gmail.com" });
    await notifyHandoff(tenantId, conv.id, "attempts");
    const files = filesFor(conv.id);
    expect(files).toHaveLength(1);
    const text = fs.readFileSync(path.join(outbox(), files[0]), "utf8");
    expect(text).not.toContain("ana.lopez@gmail.com");
    expect(text).toContain("a***@gmail.com");
  });
});

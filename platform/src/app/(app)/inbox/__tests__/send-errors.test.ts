import { describe, expect, it } from "vitest";
import { classifySendError } from "../send-errors";

describe("classifySendError", () => {
  it("maps known failures to friendly keys", () => {
    expect(classifySendError("Meta 400: (#131047) Re-engagement message")).toBe("e.window");
    expect(classifySendError("channel_not_connected")).toBe("e.notConnected");
    expect(classifySendError("missing_token")).toBe("e.notConnected");
    expect(classifySendError("Meta 401: Invalid OAuth access token")).toBe("e.token");
    expect(classifySendError("timeout")).toBe("e.network");
    expect(classifySendError("network_error")).toBe("e.network");
  });
  it("falls back to a generic message", () => {
    expect(classifySendError("Meta 500: boom")).toBe("e.default");
    expect(classifySendError(undefined)).toBe("e.default");
  });
});

import { describe, expect, it, vi } from "vitest";
import { shareOrDownloadConfig } from "./configFileSharing";

describe("configuration file transfer", () => {
  const file = new File(['{"阵容":"测试"}'], "lineup.json", { type: "application/json" });
  it("shares the original file without putting configuration text into the share payload", async () => {
    const share = vi.fn().mockResolvedValue(undefined), download = vi.fn();
    expect(await shareOrDownloadConfig(file, { canShare: () => true, share }, download)).toBe("shared");
    expect(share).toHaveBeenCalledWith({ files: [file], title: "无尽冬日阵容配置" });
    expect(download).not.toHaveBeenCalled();
  });
  it("downloads when the browser cannot share JSON files", async () => {
    const share = vi.fn(), download = vi.fn();
    expect(await shareOrDownloadConfig(file, { canShare: () => false, share }, download)).toBe("downloaded");
    expect(download).toHaveBeenCalledOnce();
    expect(share).not.toHaveBeenCalled();
  });
  it("does not download after the user cancels the share sheet", async () => {
    const download = vi.fn();
    const share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    expect(await shareOrDownloadConfig(file, { canShare: () => true, share }, download)).toBe("cancelled");
    expect(download).not.toHaveBeenCalled();
  });
  it("falls back to a file when the browser denies native sharing", async () => {
    const download = vi.fn();
    const share = vi.fn().mockRejectedValue(new DOMException("Blocked", "NotAllowedError"));
    expect(await shareOrDownloadConfig(file, { canShare: () => true, share }, download)).toBe("downloaded");
    expect(download).toHaveBeenCalledOnce();
  });
});

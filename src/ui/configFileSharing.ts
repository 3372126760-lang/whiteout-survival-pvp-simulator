/** Keep configurations in files; never expand them into clipboard text or URLs. */
export async function shareOrDownloadConfig(
  file: File,
  host: Pick<Navigator, "canShare" | "share">,
  download: () => void,
): Promise<"shared" | "downloaded" | "cancelled"> {
  try {
    const data: ShareData = { files: [file], title: "无尽冬日阵容配置" };
    if (typeof host.canShare === "function" && typeof host.share === "function" && host.canShare(data)) {
      await host.share(data);
      return "shared";
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return "cancelled";
  }
  download();
  return "downloaded";
}

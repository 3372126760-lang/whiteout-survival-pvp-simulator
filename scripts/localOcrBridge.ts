import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

/** One lazy Python worker per Vite instance. Requests share its RapidOCR model. */
export class LocalOcrBridge {
  private worker: ChildProcessWithoutNullStreams | null = null;
  private queued: Promise<unknown> = Promise.resolve();
  private active: { resolve: (value: unknown) => void;
    reject: (reason: Error) => void } | null = null;
  private output = "";
  private errors = "";
  private starts = 0;
  private requests = 0;

  constructor(private readonly python: string, private readonly script: string,
    private readonly cwd: string) {}

  status() {
    return { started: this.worker !== null, pid: this.worker?.pid ?? null,
      workerStarts: this.starts, requests: this.requests };
  }

  recognize(body: string): Promise<unknown> {
    const task = this.queued.then(() => this.run(body));
    this.queued = task.catch(() => undefined);
    return task;
  }

  dispose(): void {
    this.active?.reject(new Error("本地 OCR 服务已停止。"));
    this.active = null;
    this.worker?.kill();
    this.worker = null;
  }

  private getWorker(): ChildProcessWithoutNullStreams {
    if (this.worker !== null) return this.worker;
    this.output = "";
    this.errors = "";
    const worker = spawn(this.python, [this.script, "--worker"], {
      cwd: this.cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
    });
    this.worker = worker;
    this.starts += 1;
    worker.stdout.setEncoding("utf8");
    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk: string) => {
      this.errors = (this.errors + chunk).slice(-2000);
    });
    worker.stdout.on("data", (chunk: string) => {
      if (this.worker !== worker) return;
      this.output += chunk;
      const newline = this.output.indexOf("\n");
      if (newline < 0) return;
      const line = this.output.slice(0, newline);
      this.output = this.output.slice(newline + 1);
      try { this.active?.resolve(JSON.parse(line)); }
      catch { this.active?.reject(new Error("本地 OCR 返回格式无效。")); }
      this.active = null;
    });
    const failed = (error: Error) => {
      if (this.worker !== worker) return;
      this.active?.reject(error);
      this.active = null;
      this.worker = null;
    };
    worker.on("error", (error) => failed(new Error(`本地 OCR 未就绪：${error.message}`)));
    worker.on("close", (code) => failed(new Error(
      `本地 OCR 进程已退出 (${code})：${this.errors.slice(-500)}`)));
    worker.stdin.on("error", (error) => failed(new Error(`OCR 请求发送失败：${error.message}`)));
    return worker;
  }

  private run(body: string): Promise<unknown> {
    const request = JSON.parse(body) as { images?: unknown[] };
    if (!Array.isArray(request.images) || request.images.length < 1 || request.images.length > 8)
      return Promise.reject(new Error("一次识图须包含 1–8 张图片。"));
    this.requests += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("本地 OCR 识别超时，请缩小图片后重试。"));
        this.dispose();
      }, 120_000);
      timeout.unref();
      this.active = {
        resolve: (value) => { clearTimeout(timeout); resolve(value); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      };
      this.getWorker().stdin.write(JSON.stringify(request) + "\n");
    });
  }
}

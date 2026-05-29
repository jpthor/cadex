import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let bridgeProcess: ChildProcess | undefined;

function readRequestBody(req: import("node:http").IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function cadexKernelBridge() {
  return {
    name: "cadex-kernel-bridge",
    configureServer(server) {
      server.middlewares.use("/api/machupx", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, message: "Use POST." }));
          return;
        }

        try {
          const request = JSON.parse(await readRequestBody(req));
          const projectName = String(request.projectName ?? "CadexAircraft");
          const exportDir = path.resolve("exports/machupx");
          fs.mkdirSync(exportDir, { recursive: true });
          const inputPath = path.join(exportDir, `${projectName.replace(/[^a-zA-Z0-9_-]+/g, "_") || "cadex"}_cadex_input.json`);
          fs.writeFileSync(inputPath, JSON.stringify({ name: projectName, sizing: request.sizing }, null, 2));

          const run = spawnSync(
            "node",
            ["--experimental-strip-types", "scripts/analyze-machupx.mjs", inputPath, exportDir, "--json-only"],
            { cwd: process.cwd(), encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
          );

          res.setHeader("Content-Type", "application/json");
          if (run.status !== 0) {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: false, solver: "MachUpX", message: "MachUpX analysis failed.", stdout: run.stdout, stderr: run.stderr }));
            return;
          }
          res.end(run.stdout);
        } catch (error) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, solver: "MachUpX", message: String(error) }));
        }
      });

      if (bridgeProcess) return;
      bridgeProcess = spawn(
        "cargo",
        ["run", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "cadex_bridge"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      bridgeProcess.stdout?.on("data", (data) => process.stdout.write(`[cadex-kernel] ${data}`));
      bridgeProcess.stderr?.on("data", (data) => process.stderr.write(`[cadex-kernel] ${data}`));
      bridgeProcess.on("exit", (code) => {
        bridgeProcess = undefined;
        if (code !== 0 && code !== null) console.error(`[cadex-kernel] exited with code ${code}`);
      });
      const stop = () => {
        bridgeProcess?.kill();
        bridgeProcess = undefined;
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      process.once("exit", stop);
    },
  };
}

export default defineConfig({
  plugins: [react(), cadexKernelBridge()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/api/openai": {
        target: "https://api.openai.com",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/openai/, ""),
      },
      "/api/cad": {
        target: "http://127.0.0.1:1421",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/cad/, ""),
      },
    },
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

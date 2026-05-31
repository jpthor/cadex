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

      server.middlewares.use("/api/openfoam", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, message: "Use POST." }));
          return;
        }

        try {
          const request = JSON.parse(await readRequestBody(req));
          const projectName = String(request.projectName ?? "CadexAircraft");
          const exportDir = path.resolve("exports/openfoam");
          fs.mkdirSync(exportDir, { recursive: true });
          const inputPath = path.join(exportDir, `${projectName.replace(/[^a-zA-Z0-9_-]+/g, "_") || "cadex"}_cadex_input.json`);
          fs.writeFileSync(inputPath, JSON.stringify({ name: projectName, sizing: request.sizing }, null, 2));

          const args = ["scripts/analyze-openfoam.mjs", inputPath, exportDir, "--json-only"];
          if (request.mesh === true) args.push("--mesh");
          if (request.solve === true) args.push("--solve");
          if (request.lexSweep === true) args.push("--lex-sweep");
          if (request.propSwirlSweep === true) args.push("--prop-swirl-sweep");
          if (request.wingevonAlpha === true) args.push("--wingevon-alpha25");
          if (request.cruise === true) args.push("--cruise");
          if (request.reuseGeometry === true) args.push("--reuse-geometry");
          const run = spawnSync("node", args, { cwd: process.cwd(), encoding: "utf8", maxBuffer: 30 * 1024 * 1024 });

          res.setHeader("Content-Type", "application/json");
          if (run.status !== 0) {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: false, solver: "OpenFOAM", message: "OpenFOAM preparation failed.", stdout: run.stdout, stderr: run.stderr }));
            return;
          }
          res.end(run.stdout);
        } catch (error) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, solver: "OpenFOAM", message: String(error) }));
        }
      });

      server.middlewares.use("/api/export-file", async (req, res) => {
        if (req.method !== "GET" || !req.url) {
          res.statusCode = 405;
          res.end("Use GET.");
          return;
        }

        try {
          const url = new URL(req.url, "http://127.0.0.1");
          const requestedPath = path.resolve(url.searchParams.get("path") ?? "");
          const exportsRoot = path.resolve("exports");
          if (!requestedPath.startsWith(`${exportsRoot}${path.sep}`) || !fs.existsSync(requestedPath)) {
            res.statusCode = 404;
            res.end("Not found.");
            return;
          }
          if (path.extname(requestedPath).toLowerCase() !== ".png") {
            res.statusCode = 415;
            res.end("Only PNG previews are supported.");
            return;
          }
          res.setHeader("Content-Type", "image/png");
          fs.createReadStream(requestedPath).pipe(res);
        } catch (error) {
          res.statusCode = 500;
          res.end(String(error));
        }
      });

      server.middlewares.use("/api/paraview", async (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          res.end(JSON.stringify({ ok: false, message: "Use POST." }));
          return;
        }

        try {
          const request = JSON.parse(await readRequestBody(req));
          const projectName = String(request.projectName ?? "CadexAircraft");
          const exportDir = path.resolve("exports/paraview");
          fs.mkdirSync(exportDir, { recursive: true });
          const inputPath = path.join(exportDir, `${projectName.replace(/[^a-zA-Z0-9_-]+/g, "_") || "cadex"}_cadex_input.json`);
          fs.writeFileSync(inputPath, JSON.stringify({ name: projectName, sizing: request.sizing, renderOptions: request.renderOptions }, null, 2));

          const run = spawnSync("node", ["scripts/render-paraview.mjs", inputPath, exportDir, "--json-only"], {
            cwd: process.cwd(),
            encoding: "utf8",
            maxBuffer: 60 * 1024 * 1024,
          });

          res.setHeader("Content-Type", "application/json");
          if (run.status !== 0) {
            res.statusCode = 200;
            res.end(JSON.stringify({ ok: false, solver: "ParaView", message: "ParaView render failed.", stdout: run.stdout, stderr: run.stderr }));
            return;
          }
          res.end(run.stdout);
        } catch (error) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, solver: "ParaView", message: String(error) }));
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

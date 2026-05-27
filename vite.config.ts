import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { spawn, type ChildProcess } from "node:child_process";

let bridgeProcess: ChildProcess | undefined;

function cadexKernelBridge() {
  return {
    name: "cadex-kernel-bridge",
    configureServer() {
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

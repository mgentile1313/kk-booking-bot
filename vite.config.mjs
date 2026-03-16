import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function preferencesApiPlugin() {
  return {
    name: "preferences-api",
    configureServer(server) {
      // Serve preferences.json from project root
      server.middlewares.use("/preferences.json", (req, res, next) => {
        if (req.method === "GET") {
          const filePath = path.join(__dirname, "preferences.json");
          if (fs.existsSync(filePath)) {
            res.setHeader("Content-Type", "application/json");
            res.end(fs.readFileSync(filePath, "utf-8"));
          } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: "preferences.json not found" }));
          }
          return;
        }
        next();
      });

      // Save preferences.json via POST
      server.middlewares.use("/api/save-preferences", (req, res, next) => {
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk.toString();
          });
          req.on("end", () => {
            try {
              // Validate it's valid JSON
              const parsed = JSON.parse(body);
              const filePath = path.join(__dirname, "preferences.json");
              fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ success: true }));
            } catch (err) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: err.message }));
            }
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: "src/ui",
  plugins: [react(), preferencesApiPlugin()],
  server: {
    port: 3000,
    open: true,
  },
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});

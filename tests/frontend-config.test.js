import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../frontend/config.js", import.meta.url), "utf8");

function getApiUrl(location) {
  const window = { location };
  runInNewContext(source, { window });
  return window.HELPCONNECT_CONFIG.apiUrl;
}

test("frontend config keeps local and emulator API endpoints", () => {
  assert.equal(getApiUrl({
    protocol: "http:",
    hostname: "localhost",
    origin: "http://localhost:5500"
  }), "http://localhost:3001/api");
  assert.equal(getApiUrl({
    protocol: "http:",
    hostname: "10.0.2.2",
    origin: "http://10.0.2.2:5500"
  }), "http://10.0.2.2:3001/api");
});

test("frontend config uses the deployed site's same-origin API", () => {
  assert.equal(getApiUrl({
    protocol: "https:",
    hostname: "helpconnect-api-zxja.onrender.com",
    origin: "https://helpconnect-api-zxja.onrender.com"
  }), "https://helpconnect-api-zxja.onrender.com/api");
});

test("development config permits the backend-served localhost and emulator panel origins", () => {
  const script = `
    import { config } from "./backend/src/config.js";
    console.log(JSON.stringify(config.appOrigins));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "test-publishable-key",
      APP_ORIGINS: "",
      APP_ORIGIN: "",
      RENDER_EXTERNAL_URL: "",
      PUBLIC_APP_URL: ""
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const origins = JSON.parse(result.stdout);
  assert.ok(origins.includes("http://localhost:3001"));
  assert.ok(origins.includes("http://127.0.0.1:3001"));
  assert.ok(origins.includes("http://10.0.2.2:3001"));
});

test("Render origin is included for the same-origin panel and WebSocket", () => {
  const script = `
    import { config } from "./backend/src/config.js";
    console.log(JSON.stringify({ appOrigins: config.appOrigins, publicAppUrl: config.publicAppUrl }));
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_ANON_KEY: "test-publishable-key",
      RENDER_EXTERNAL_URL: "https://helpconnect-api.onrender.com",
      APP_ORIGINS: "https://separate-panel.example.com",
      APP_ORIGIN: "",
      PUBLIC_APP_URL: ""
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    appOrigins: ["https://separate-panel.example.com", "https://helpconnect-api.onrender.com"],
    publicAppUrl: "https://helpconnect-api.onrender.com"
  });
});

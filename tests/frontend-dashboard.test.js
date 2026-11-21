import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dashboard includes the container and refresh action used for session rendering", async () => {
  const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");

  assert.match(html, /<div id="sessions" class="sessions"/);
  assert.match(html, /<button id="refreshSessions"[^>]*>Atualizar<\/button>/);
});

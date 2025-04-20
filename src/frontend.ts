import { serve } from "bun";
import path from "path";

const PUBLIC_DIR = path.resolve(import.meta.dir, "../public");

console.log(`Serving static files from: ${PUBLIC_DIR}`);

serve({
  port: 8080,
  async fetch(request) {
    const url = new URL(request.url);
    let filePath = path.join(PUBLIC_DIR, url.pathname);

    // Default to index.html for root path
    if (url.pathname === "/") {
      filePath = path.join(PUBLIC_DIR, "index.html");
    }

    console.log(`Attempting to serve: ${filePath}`);

    const file = Bun.file(filePath);

    // Check if the file exists
    if (await file.exists()) {
      return new Response(file);
    } else {
      console.error(`File not found: ${filePath}`);
      return new Response("Not Found", { status: 404 });
    }
  },
  error() {
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log("Frontend server listening on http://localhost:8080");
console.log(
  "Open http://localhost:8080 in your browser to view the Rate Limiter Demo"
);

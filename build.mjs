import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

const serve = process.argv.includes("--serve");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });

const options = {
  entryPoints: ["src/app.js"],
  bundle: true,
  splitting: true, // Telegram client lands in its own chunk, loaded only when used
  format: "esm",
  platform: "browser",
  target: "es2020",
  outdir: "dist",
  minify: !serve,
  sourcemap: serve,
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
  logLevel: "info",
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: "dist", port: 5173 });
  console.log(`http://localhost:${port}`);
} else {
  await esbuild.build(options);
}

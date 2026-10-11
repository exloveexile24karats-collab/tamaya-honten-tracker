// App.jsx を「storage.js → テスト用スタブ」に差し替えてバンドルする
import * as esbuild from "esbuild";
import path from "path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
await esbuild.build({
  entryPoints: [path.join(root, "src/App.jsx")],
  bundle: true, format: "esm", platform: "node", outfile: path.join(root, "test/.out/app_test.mjs"),
  jsx: "automatic", logLevel: "warning",
  external: ["react", "react-dom", "recharts", "lucide-react"],
  plugins: [{ name: "stub-storage", setup(b) { b.onResolve({ filter: /^\.\/storage$/ }, () => ({ path: path.join(root, "test/storage.stub.js") })); } }],
});
console.log("bundled");

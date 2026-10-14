"""Build the private desktop host against a pinned MIT/Apache ArtCraft frontend."""
import json
import os
import pathlib
import re
import shutil
import subprocess

HERE = pathlib.Path(__file__).resolve().parents[1]
REPO = HERE.parent
PIN = "d4e4ac69bbd93d237eaf5d0260bc6a5ff3a5e373"
SOURCE = pathlib.Path(os.environ.get("ARTCRAFT_SOURCE", str(REPO / ".local-qa/artcraft-desktop-source"))).resolve()


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


if not (SOURCE / ".git").exists():
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    run("git", "clone", "--filter=blob:none", "--no-checkout", "https://github.com/storytold/artcraft.git", str(SOURCE))
    run("git", "sparse-checkout", "init", "--cone", cwd=SOURCE)
    run("git", "sparse-checkout", "set", "frontend", cwd=SOURCE)
    run("git", "checkout", PIN, cwd=SOURCE)
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=SOURCE, text=True).strip() == PIN
frontend = SOURCE / "frontend"
if not (frontend / "node_modules/.bin/vite").exists():
    run("npm", "ci", "--no-audit", "--no-fund", cwd=frontend)
host = frontend / "apps/ltaiqin-desktop"
host.mkdir(parents=True, exist_ok=True)
shutil.copytree(HERE / "renderer", host / "src", dirs_exist_ok=True)
libs = frontend / "libs"


def original(relative):
    # Always begin each adapted file from the pinned version, so rebuilding is
    # deterministic without resetting the caller's checkout or deleting caches.
    content = subprocess.check_output(["git", "show", PIN + ":frontend/" + relative], cwd=SOURCE)
    return content.decode()


draw_path = "libs/components/pagedraw/src/lib/PageDraw.tsx"
draw = original(draw_path)
snapshot = '''const api = new PromptsApi();
          const snapshotResult = await api.uploadSceneSnapshot({
            screenshot: compositeFile,
          });'''
assert draw.count(snapshot) == 2
draw = draw.replace(snapshot, "const snapshotResult = await (adapter as any).snapshotImage(compositeFile);")
draw = draw.replace("useState<number>(4)", "useState<number>(1)")
marker = '<div className={`fixed inset-0 -z-10 ${backgroundClassName}`} />'
assert marker in draw
draw = draw.replace(marker, marker + '''
      <button className="studio-canvas-save" onClick={async () => {
        try { const file = await getCompositeFile(); if (file) await (adapter as any).saveCanvas(file); }
        catch (error) { (adapter as any).onError(error); }
      }}>保存画布到素材库</button>''')
(frontend / draw_path).write_text(draw)
(libs / "components/pagedraw/src/lib/PromptEditor/PromptEditor.tsx").write_text('export { default } from "@ltaiqin/studio-prompt";\n')

# Presets that refer to vendor-owned cloud tokens cannot work in an offline,
# account-free application. Keep primitives and bundled skyboxes; user models
# are supplied through the local adapter, without a vendor library request.
assets = libs / "components/pagescene/src/lib/signals/demoAssets"
for filename in ["demoCharacterItems.ts", "demoAnimationItems.ts", "demoMemeItems.ts"]:
    relative = str((assets / filename).relative_to(frontend))
    text = original(relative)
    text = re.sub(r"(export const \w+\s*:\s*MediaItem\[\]\s*=\s*)\[[\s\S]*?\];", r"\1[];", text)
    (assets / filename).write_text(text)
relative = "libs/components/pagescene/src/lib/signals/demoAssets/demoAssets.ts"
text = original(relative)
text = re.sub(r"(export const demoObjectItems:\s*MediaItem\[\]\s*=\s*)\[[\s\S]*?\];", r"\1[];", text)
(frontend / relative).write_text(text)

# Still/video output can be kept in the local library without any sign-in or
# cloud upload. Both save and download buttons operate on the local Blob.
relative = "libs/components/pagescene/src/lib/comps/CompletionModal/CompletionModal.tsx"
text = original(relative)
start = text.index('    if (artifact?.kind === "image" && !autoStartedRef.current) {')
end = text.index("    if (!artifact) {", start)
text = text[:start] + text[end:]
text = text.replace('isVideo && status === "idle"', 'status === "idle"')
text = text.replace("Upload &amp; continue", "保存到本地素材库")
text = text.replace("Uploading to gallery…", "正在保存到本机…")
text = text.replace('{/* actions */}', '''{/* actions */}<a href={artifact.objectUrl} download={artifact.fileName}
  className="flex h-9 items-center justify-center border border-white/20 text-sm">下载渲染结果</a>''')
(frontend / relative).write_text(text)

# All workspace libraries resolve to one source module instance. This prevents
# duplicated Zustand/keybind stores from separately built dependency bundles.
aliases = []
for package in libs.rglob("package.json"):
    if "node_modules" in package.parts:
        continue
    definition = json.loads(package.read_text())
    name = definition.get("name", "")
    entry = package.parent / "src/index.ts"
    if name.startswith("@storyteller/") and entry.exists():
        aliases.append({"find": name, "replacement": str(entry)})
aliases.append({"find": "@ltaiqin/studio-prompt", "replacement": str(host / "src/CanvasPrompt.tsx")})
aliases.sort(key=lambda x: len(x["find"]), reverse=True)
public = frontend / "apps/artcraft/app/public"
config = '''import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
export default defineConfig({
  root: ROOT, base: '/', publicDir: PUBLIC,
  resolve: { alias: ALIASES, dedupe: ['react','react-dom','zustand','three'], conditions: ['development','browser','module'] },
  plugins: [react(), wasm()],
  worker: { format: 'es', plugins: () => [wasm()] },
  build: { outDir: OUTPUT, emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 1600 },
});'''
for marker, value in [("ROOT", str(host)), ("PUBLIC", str(public)), ("ALIASES", aliases), ("OUTPUT", str(HERE / "renderer-dist"))]:
    config = config.replace(marker, json.dumps(value))
(host / "vite.config.mjs").write_text(config)
(host / "index.html").write_text('''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LTaiQin Studio · ArtCraft</title></head><body><div id="root"></div><script type="module" src="/src/App.tsx"></script></body></html>''')
tailwind = (frontend / "apps/artcraft/tailwind.config.ts").read_text()
start = tailwind.index("  content: [")
end = tailwind.index("  theme:", start)
tailwind = tailwind[:start] + "  content: " + json.dumps([str(host / "src/**/*.{ts,tsx}"), str(libs / "**/src/**/*.{ts,tsx}")]) + ",\n" + tailwind[end:]
(host / "tailwind.config.ts").write_text(tailwind)
(host / "postcss.config.cjs").write_text("module.exports={plugins:{tailwindcss:{config:" + json.dumps(str(host / "tailwind.config.ts")) + "},autoprefixer:{}}};")
run("npx", "vite", "build", "--config", str(host / "vite.config.mjs"), cwd=frontend)
third_party = HERE / "THIRD_PARTY"
third_party.mkdir(exist_ok=True)
for name in ["LICENSE-MIT", "LICENSE-APACHE", "NOTICE"]:
    shutil.copy2(SOURCE / name, third_party / ("ArtCraft-" + name))
(third_party / "SOURCE.txt").write_text("https://github.com/storytold/artcraft\nCommit: " + PIN + "\n")
print("Desktop renderer and bundled attribution ready:", HERE / "renderer-dist")

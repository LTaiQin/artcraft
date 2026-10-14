import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Input } from "@storyteller/ui-input";
import { Button } from "@storyteller/ui-button";
import { useModelsStore } from "@storyteller/tauri-api";

interface Config {
  baseUrl: string;
  model: string;
  editFormat: string;
  voice: string;
  language: string;
  hasKey: boolean;
}
type Kind = "image" | "video" | "audio";
type Settings = Record<Kind, Config>;

export const AccountSettingsPane = (_props: { globalAccountLogoutCallback: () => void }) => {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    invoke<Settings>("personal_get_settings_command").then(setSettings).catch((e) => setError(String(e)));
  }, []);
  return (
    <div className="flex flex-col gap-5 pt-3 text-base-fg">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">Personal APIs</p>
        <p className="text-sm text-base-fg/70">无需登录。密钥仅存放在这台电脑，Windows 使用系统加密。</p>
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      {settings && (["image", "video", "audio"] as Kind[]).map((kind) => (
        <ApiBlock key={kind} kind={kind} saved={settings[kind]} onSaved={setSettings} />
      ))}
    </div>
  );
};

const TITLES = { image: "GPT Image 2.5", video: "Seedance 2.5", audio: "Alibaba Bailian · Qwen TTS" };
const ApiBlock = ({ kind, saved, onSaved }: { kind: Kind; saved: Config; onSaved: (s: Settings) => void }) => {
  const [config, setConfig] = useState(saved);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => { setConfig(saved); }, [saved]);
  const update = (field: keyof Config, value: string) => setConfig((c) => ({ ...c, [field]: value }));
  const save = async (clearKey = false) => {
    setBusy(true); setMessage("");
    try {
      const result = await invoke<Settings>("personal_save_settings_command", { kind, config, key: key || null, clearKey });
      onSaved(result); setKey(""); setFailed(false);
      setMessage(clearKey ? "密钥已移除" : "已保存。填写的 API Key 不会显示或发给 ArtCraft。修改服务地址的域名后，需要重新填写对应密钥。");
      await useModelsStore.getState().loadModelsFromBackend();
      window.dispatchEvent(new Event("personal-api-config-changed"));
    } catch (e) { setFailed(true); setMessage(String(e)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <hr className="border-ui-panel-border" />
      <div className="flex flex-col gap-3" data-personal-api={kind}>
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em]">{TITLES[kind]}</p>
        <label className="flex flex-col gap-1 text-sm">API Base URL
          <Input aria-label={`${kind} API Base URL`} value={config.baseUrl} onChange={(e) => update("baseUrl", e.target.value)} placeholder="https://api.example.com/v1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">Model ID
          <Input aria-label={`${kind} Model ID`} value={config.model} onChange={(e) => update("model", e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">API Key {saved.hasKey ? "· 已保存" : "· 尚未设置"}
          <Input aria-label={`${kind} API Key`} type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={saved.hasKey ? "留空保留已保存的密钥" : "输入 API Key"} />
        </label>
        {kind === "image" && <label className="flex flex-col gap-1 text-sm">Image editing protocol
          <select aria-label="Image editing protocol" className="h-9 rounded-[3px] border border-ui-panel-border bg-ui-panel px-2 text-base-fg" value={config.editFormat} onChange={(e) => update("editFormat", e.target.value)}>
            <option value="json">官方 JSON（images / mask）</option><option value="multipart">兼容 Multipart（image[] / mask）</option>
          </select>
        </label>}
        {kind === "audio" && <>
          <label className="flex flex-col gap-1 text-sm">Voice<Input aria-label="audio Voice" value={config.voice} onChange={(e) => update("voice", e.target.value)} /></label>
          <label className="flex flex-col gap-1 text-sm">Language<Input aria-label="audio Language" value={config.language} onChange={(e) => update("language", e.target.value)} /></label>
          <p className="text-xs text-base-fg/60">Qwen TTS 朗读输入文本；此接口用于语音合成。声音风格需要 instruct 型号。</p>
        </>}
        <div className="flex gap-2">
          <Button className="h-9 px-3" disabled={busy} onClick={() => save()}>{busy ? "Saving…" : "Save"}</Button>
          {saved.hasKey && <Button variant="secondary" className="h-9 px-3" disabled={busy} onClick={() => save(true)}>Remove key</Button>}
        </div>
        {message && <p role={failed ? "alert" : "status"} className={`text-xs leading-relaxed ${failed ? "text-red-400" : "text-base-fg/70"}`}>{message}</p>}
      </div>
    </>
  );
};

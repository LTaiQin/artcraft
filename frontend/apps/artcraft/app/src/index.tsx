import { StrictMode, useEffect } from "react";
import { useSignals, useSignalEffect } from "@preact/signals-react/runtime";
import { BrowserRouter } from "react-router-dom";
import { MainApp } from "./pages/MainApp";
import { GlobalFileDropHandler } from "./components/GlobalFileDropHandler/GlobalFileDropHandler";
import { createRoot } from "react-dom/client";
import "./styles/normalize.css";
import "./styles/tailwind.css";
import "./styles/base.css";
import EnvironmentVariables from "~/Classes/EnvironmentVariables";
import { pageHeight, pageWidth, persistLogin } from "~/signals";
import { SyncStorytellerApiConfig } from "./api/SyncStorytellerApiConfig";
import { posthog } from "posthog-js";
import { SoundManager } from "@storyteller/soundboard";
import { ModelPage, useClassyModelSelectorStore } from "@storyteller/ui-model-selector";
import { useModelsStore } from "@storyteller/tauri-api";

useClassyModelSelectorStore.setState({
  selectedProviders: Object.fromEntries(Object.values(ModelPage).map((page) => [page, {}])),
});

// TODO(bt,2025-04-19): Make these configurable
const ENV = {
  UPLOAD_API_VIDEO: "https://personal.artcraft.local",
  GOOGLE_API: "https://personal.artcraft.local",
  FUNNEL_API: "https://personal.artcraft.local",
  CDN_API: "https://cdn-2.fakeyou.com",
  GRAVATAR_API: "https://personal.artcraft.local",
  DEPLOY_PRIME_URL: "https://personal.artcraft.local",
};

const GlobalSettingsManager = ({ env }: { env: Record<string, string> }) => {
  console.log("GlobalSettingsManager()");

  SyncStorytellerApiConfig();

  useSignals();

  useSignalEffect(() => {
    persistLogin();
  });

  /// Initizations that depends on ENV vars ///
  function PostHogInit() {
    const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
    posthog.init(apiKey, {
      api_host: "https://us.i.posthog.com/",
      ui_host: "https://us.i.posthog.com/",
    });
  }

  useEffect(() => {
    EnvironmentVariables.initialize(env);
    if (import.meta.env.DEV) {
      return;
    }
    // Personal desktop: no cloud account analytics or credentials.
  }, [env]);

  // Apply stored theme early on mount
  useEffect(() => {
    const key = "st-theme";
    const value = (localStorage.getItem(key) || "gray").trim();
    const allowed = ["light", "gray", "black", "aurora", "sunset", "gradient"];
    const normalized = value === "gradient" ? "aurora" : value;
    const theme = allowed.includes(value) ? (normalized as string) : "gray";
    const root = document.documentElement;
    const toRemove: string[] = [];
    root.classList.forEach((c) => {
      if (c.startsWith("theme-")) toRemove.push(c);
    });
    toRemove.forEach((c) => root.classList.remove(c));
    root.classList.add(`theme-${theme}`);
  }, []);

  /// Initizations that run only once on 1ST mount ///
  function setPage() {
    // TODO address this issue with zooming
    pageHeight.value = window.innerHeight;
    pageWidth.value = window.innerWidth;
  }

  useEffect(() => {
    setPage();
    window.addEventListener("resize", setPage);
    return () => {
      window.removeEventListener("resize", setPage);
    };
  }, []);

  useEffect(() => {
    SoundManager.install();
  }, []);

  // Reconcile the model dropdowns against the backend omni listing once on boot.
  // The store is already seeded with the static overlay, so a failure here is a
  // no-op (the UI keeps the overlay models).
  useEffect(() => {
    void useModelsStore.getState().loadModelsFromBackend().then(() => {
      const { imageModels, videoModels } = useModelsStore.getState();
      const selector = useClassyModelSelectorStore.getState();
      const image = imageModels.find((model) => !model.tauriId.endsWith("_inpaint"));
      if (image) for (const page of [ModelPage.TextToImage, ModelPage.Canvas2D, ModelPage.Stage3D, ModelPage.ImageEditor, ModelPage.Angles]) selector.setSelectedModel(page, image);
      if (videoModels[0]) selector.setSelectedModel(ModelPage.ImageToVideo, videoModels[0]);
    });
  }, []);

  return null;
};

// TODO: Replace environment variables from `root.tsx`
createRoot(document.getElementById("root")!).render(
  <>
    <StrictMode>
      <BrowserRouter>
        <GlobalSettingsManager env={ENV} />
        <div className="topbar-spacer" data-tauri-drag-region={true} />
        <MainApp />
        <GlobalFileDropHandler />
      </BrowserRouter>
    </StrictMode>
  </>,
);

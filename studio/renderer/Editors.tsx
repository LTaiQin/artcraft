import { useMemo, useState, useEffect } from 'react';
import { PageDraw, BlankCanvasModal, useSceneStore } from '@storyteller/ui-pagedraw';
import { Stage3D, getActiveEditor, usePageSceneStore, AssetType, FilterEngineCategories } from '@storyteller/ui-pagescene';
import { addObject, addCharacter } from '@storyteller/ui-pagescene';
import toast from 'react-hot-toast';
import { native, storeBlob, waitJob, type Asset } from './client';

function BaseSelector({ onImageSelect, start }: any) {
  const [blank, setBlank] = useState(false);
  useEffect(() => { if (start) onImageSelect({ url: start.url, mediaToken: start.id }); }, []);
  return <div className="studio-base-selector"><div className="studio-base-icon">◈</div><h2>从一张图片，或一块空白开始。</h2><p>画布、图层和绘制均在本机完成。</p><div><button onClick={async () => { const assets = await native.importFiles('image'); if (assets[0]) onImageSelect({ url: assets[0].url, mediaToken: assets[0].id }); }}>选择本地图片</button><button className="secondary" onClick={() => setBlank(true)}>空白画布</button></div><BlankCanvasModal isOpen={blank} onClose={() => setBlank(false)} onConfirm={(width, height) => { onImageSelect({ url: '', mediaToken: 'blank-canvas', isBlankCanvas: true, blankCanvasWidth: width, blankCanvasHeight: height }); setBlank(false); }} /></div>;
}

export function CanvasEditor({ start }: { start?: Asset }) {
  const adapter = useMemo(() => {
    const edit = async (request: any) => {
      const mask = request.maskImageRawBytes ? await storeBlob(new Blob([request.maskImageRawBytes], { type: 'image/png' }), 'canvas-mask.png', 'image') : null;
      const refs = [request.canvasImageMediaToken || request.imageMediaToken, ...(request.imageMediaTokens || [])].filter((x: string) => x && x !== 'blank-canvas');
      const job = await native.generate('image', { prompt: request.prompt, count: request.imageCount || 1, references: refs, maskId: mask?.id });
      void waitJob(job.id).then(assets => {
        useSceneStore.getState().addHistoryImageBundle({ images: assets.map(asset => ({ url: asset.url, mediaToken: asset.id })) });
        toast.success('生成完成，结果已保存到本地素材库');
      }).catch(error => toast.error(error.message)).finally(() => useSceneStore.getState().removePendingGeneration(request.frontendSubscriberId));
      return { status: 'success' };
    };
    return {
      enqueueEditImage: edit,
      enqueueInpaint: edit,
      snapshotImage: async (file: File) => { const asset = await storeBlob(file, 'canvas-snapshot.png', 'image'); return { success: true, data: asset.id }; },
      saveCanvas: async (file: File) => { await storeBlob(file, 'canvas-' + Date.now() + '.png', 'image'); toast.success('画布已保存到本机，可在素材库导出'); },
      onError: (error: any) => toast.error(error.message),
      uploadImage: async ({ file, assetFile, progressCallback, callback }: any) => {
        const image = file || assetFile;
        const asset = await storeBlob(image, image.name || 'reference.png', 'image');
        const result = { status: 'success', data: asset.id };
        progressCallback?.(result); callback?.(result); return { success: true, data: asset.id };
      },
      enqueueBgRemoval: async (base64: string, nodeId: string) => {
        const data = await fetch(base64.startsWith('data:') ? base64 : 'data:image/png;base64,' + base64).then(r => r.blob());
        const asset = await storeBlob(data, 'background-input.png', 'image');
        await native.generate('image', { prompt: '移除图片背景，保留主体的精确外形和细节，输出透明背景。', background: 'transparent', references: [asset.id], backgroundNodeId: nodeId });
        toast.success('背景处理已提交到你的图片 API，完成后可在素材库打开');
      },
      renderBaseImageSelector: (props: any) => <BaseSelector {...props} start={start} />,
    };
  }, []);
  return <div className="studio-editor-frame" style={{ '--pd-bottom-reserve': '5rem' } as any}><PageDraw adapter={adapter as any} backgroundClassName="bg-ui-background" fillParentHeight showBottomRightControls={false} /></div>;
}

async function addLocalModel(asset: Asset, character = false) {
  const editor = getActiveEditor();
  if (!editor) throw new Error('3D 编辑器仍在初始化');
  // The upstream scene serializer recognizes m_* as file-backed objects.
  // Reserve our own local namespace while keeping native asset IDs unchanged.
  const item: any = { version: 1, media_id: 'm_local_' + asset.id, name: asset.name, type: character ? AssetType.CHARACTER : AssetType.OBJECT, media_type: asset.name.split('.').pop() };
  await (character ? addCharacter : addObject)(editor, item);
}

function LocalModelPicker({ isOpen, onClose, character = false }: any) {
  if (!isOpen) return null;
  return <div className="studio-local-modal"><h3>导入本地 3D 素材</h3><p>选择自包含的 GLB 或 SPZ 文件；带骨骼的 GLB 可作为角色调整姿态。不会上传到服务器。</p><button onClick={async () => { try { const assets = await native.importFiles('model'); for (const asset of assets) await addLocalModel(asset, character); onClose(); } catch (error: any) { toast.error(error.message); } }}>选择素材文件</button><button className="secondary" onClick={onClose}>关闭</button></div>;
}

export function SceneEditor({ sceneId }: { sceneId?: string }) {
  const [cache, setCache] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [character, setCharacter] = useState(false);
  useEffect(() => {
    usePageSceneStore.getState().setCurrentUserToken('local-owner');
    usePageSceneStore.getState().setSceneMeta({ token: sceneId, ownerToken: 'local-owner', title: '', isInitializing: false });
    if (sceneId) Promise.all([native.loadScene(sceneId), native.snapshot()]).then(([value, state]: any) => { usePageSceneStore.getState().setSceneMeta({ title: state.scenes.find((s: any) => s.id === sceneId)?.title || '', token: sceneId, ownerToken: 'local-owner', isInitializing: false }); setCache(JSON.stringify(value)); }).catch((error: any) => { toast.error(error.message); setCache(''); });
    else setCache(localStorage.getItem('studio-scene-draft') || '');
  }, []);
  const adapter = useMemo(() => {
    const getAsset = async (id: string) => { const state = await native.snapshot(); const asset = state.assets.find((a: Asset) => a.id === id.replace(/^m_local_/, '')); if (!asset) throw new Error('素材不在本机，请使用「导入模型」'); return asset; };
    return {
      enqueueGeneration: async () => { toast('从左侧「生成图片」或「生成视频」调用你的 API'); return { status: 'fail' }; },
      saveScene: async ({ saveJson, sceneTitle, sceneToken }: any) => { const scene = await native.saveScene({ json: saveJson, title: sceneTitle, id: sceneToken }); toast.success('场景已保存到本机'); return scene.id; },
      loadScene: (id: string) => native.loadScene(id),
      fetchAsset: (url: string, init?: any) => fetch(url, { signal: init?.signal }),
      getCdnOrigin: () => 'studio://app',
      getApiSchemeAndHost: () => 'studio://app',
      getCurrentUserToken: () => 'local-owner',
      getCdnUrl: (value: string) => value.startsWith('studio:') ? value : 'studio://app/' + value.replace(/^\//, ''),
      getMediaUrlByToken: async (id: string) => (await getAsset(id)).url,
      getMediaUrlsByTokens: async (ids: string[]) => { const state = await native.snapshot(); return Object.fromEntries(ids.map(id => [id, state.assets.find((a: Asset) => a.id === id.replace(/^m_local_/, ''))?.url]).filter(([, url]) => !!url)); },
      getViewportSize: () => { const rect = document.querySelector('.editor-content')?.getBoundingClientRect(); return { width: rect?.width || window.innerWidth - 216, height: rect?.height || window.innerHeight - 64 }; },
      listUserMediaFiles: async () => ({ success: true, data: [] }),
      listFeaturedMediaFiles: async () => ({ success: true, data: [] }),
      listUserSceneProjects: async () => { const state = await native.snapshot(); return { success: true, data: state.scenes.map((s: any) => ({ token: s.id, maybe_title: s.title, updated_at: s.updatedAt })) }; },
      showToast: (_: any, message: string) => toast(message),
      onError: (error: any) => toast.error(error.message),
      renderAssetBrowser: () => <p>使用顶部「导入模型」添加本地角色或物体。</p>,
      renderSceneLoader: ({ onSceneSelect }: any) => <button onClick={async () => { const state = await native.snapshot(); if (state.scenes[0]) onSceneSelect(state.scenes[0].id); }}>打开最近保存的场景</button>,
      renderAssetUploader: (props: any) => <LocalModelPicker {...props} />,
      renderImageUploader: (props: any) => <div>{props.isOpen && <button onClick={async () => { const assets = await native.importFiles('image'); for (const asset of assets) await addLocalModel(asset); props.onClose(); }}>选择本地图片</button>}</div>,
      renderSplatUploader: (props: any) => <LocalModelPicker {...props} />,
      uploadImage: async ({ assetFile, progressCallback }: any) => { const asset = await storeBlob(assetFile, assetFile.name || 'reference.png', 'image'); progressCallback?.({ status: 'success', data: asset.id }); },
      uploadPlaneFromMediaToken: async ({ progressCallback }: any) => progressCallback({ status: 'success' }),
      navigateToImageTo3D: () => toast('本版本使用本地 GLB / SPZ 模型，无需模型生成账号'),
      uploadMedia: async ({ blob, fileName, kind }: any) => (await storeBlob(blob, fileName, kind)).id,
      openMediaLightbox: () => toast.success('渲染结果已保存到本地素材库'),
      performLogout: () => {},
      onSceneTitleChange: (meta: any) => usePageSceneStore.getState().setSceneMeta({ ...meta, ownerToken: 'local-owner', isInitializing: false }),
    };
  }, []);
  if (cache === null) return <div className="studio-loading">正在读取本地场景…</div>;
  return <div className="studio-editor-frame"><Stage3D adapter={adapter as any} cacheJsonString={cache || undefined} sceneToken={sceneId} onSceneSerialized={json => { if (!sceneId) localStorage.setItem('studio-scene-draft', json); }} showCostCalculator={false} showHelpMenu={false} showImageTo3DButton={false} modelSelectorPlacement="prompt-box" topBarEndSlot={<div className="studio-model-actions"><button onClick={() => { setCharacter(false); setPicker(true); }}>导入模型</button><button onClick={() => { setCharacter(true); setPicker(true); }}>导入角色</button></div>} /><LocalModelPicker isOpen={picker} onClose={() => setPicker(false)} character={character} /></div>;
}

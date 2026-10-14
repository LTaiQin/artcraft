import { useState } from 'react';

export default function CanvasPrompt({ onGenerateClick, isDisabled, isEnqueueing, generationCount, onGenerationCountChange }: any) {
  const [prompt, setPrompt] = useState('');
  return <div className="studio-canvas-prompt">
    <textarea value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="描述你想如何改变画面。画布内容会作为参考图发送到你配置的图片 API。" aria-label="画布编辑提示词" />
    <div><span>GPT Image 2.5 · 使用自定义图片 API</span><label>数量 <select aria-label="画布生成数量" value={generationCount} onChange={event => onGenerationCountChange(Number(event.target.value))}>{[1,2,3,4].map(n => <option key={n}>{n}</option>)}</select></label><button disabled={isDisabled || isEnqueueing || !prompt.trim()} onClick={() => onGenerateClick(prompt, { aspectRatio: 'auto' })}>{isEnqueueing ? '正在提交…' : '生成修改'}</button></div>
  </div>;
}

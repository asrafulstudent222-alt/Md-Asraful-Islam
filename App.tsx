
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from './components/Button';
import { DesignBrief, AttachedFile, AttachedLink } from './types';
import { generateDesignBrief, generateSVGDesign, ModelType } from './services/geminiService';

interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutProps {
  enabled: boolean;
  direction: 'horizontal' | 'vertical';
  gap: number;
  padding: number;
}

interface ShadowProps {
  enabled: boolean;
  x: number;
  y: number;
  blur: number;
  color: string;
  opacity: number;
}

interface GradientStop {
  offset: number;
  color: string;
}

interface GradientProps {
  enabled: boolean;
  type: 'linear' | 'radial';
  angle: number;
  stops: GradientStop[];
}

const COMPONENT_PRESETS = [
  'Modern Flat Professional',
  'Minimalist Dashboard',
  'SaaS Landing Page',
  'Mobile App UI Kit',
  'Realistic 3D UI Package',
  'UI Button Package'
];

export default function App() {
  const [brief, setBrief] = useState<DesignBrief | null>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [manualPrompt, setManualPrompt] = useState<string>('');
  const [selectedPreset, setSelectedPreset] = useState<string>('Modern Flat Professional');
  const [selectedModel, setSelectedModel] = useState<ModelType>('gemini-3-flash-preview');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<'canvas' | 'code'>('canvas');
  const [zoom, setZoom] = useState(1);
  const [quotaError, setQuotaError] = useState(false);
  const [isApiKeySelected, setIsApiKeySelected] = useState(true);
  const [systemError, setSystemError] = useState<string | null>(null);
  const [loadingMessage, setLoadingMessage] = useState<string>('Forging vectors...');
  const [isCopied, setIsCopied] = useState(false);
  
  // Selection & Inspector State
  const [selectedElements, setSelectedElements] = useState<SVGElement[]>([]);
  const [layoutProps, setLayoutProps] = useState<LayoutProps>({
    enabled: false,
    direction: 'horizontal',
    gap: 16,
    padding: 16
  });
  const [shadowProps, setShadowProps] = useState<ShadowProps>({
    enabled: false,
    x: 0,
    y: 4,
    blur: 10,
    color: '#000000',
    opacity: 0.25
  });
  const [gradientProps, setGradientProps] = useState<GradientProps>({
    enabled: false,
    type: 'linear',
    angle: 90,
    stops: [
      { offset: 0, color: '#6366f1' },
      { offset: 100, color: '#a855f7' }
    ]
  });

  const canvasRef = useRef<HTMLDivElement>(null);
  const [bbox, setBbox] = useState<BoundingBox | null>(null);

  useEffect(() => {
    const checkKey = async () => {
      try {
        // @ts-ignore
        if (typeof window !== 'undefined' && window.aistudio?.hasSelectedApiKey) {
          // @ts-ignore
          const hasKey = await window.aistudio.hasSelectedApiKey();
          setIsApiKeySelected(hasKey);
        }
      } catch (err) {
        console.warn("Key check failed", err);
      }
    };
    checkKey();
  }, []);

  const handleSelectKey = async () => {
    try {
      // @ts-ignore
      if (typeof window !== 'undefined' && window.aistudio?.openSelectKey) {
        // @ts-ignore
        await window.aistudio.openSelectKey();
        setQuotaError(false);
        setIsApiKeySelected(true);
        setSystemError(null);
      } else {
        setSystemError("API Key selection is not supported in this environment.");
      }
    } catch (err) {
      console.error("Failed to open key selector", err);
    }
  };

  const safeBtoa = (str: string) => {
    try {
      return window.btoa(unescape(encodeURIComponent(str)));
    } catch (e) {
      console.error("Btoa failed", e);
      return "";
    }
  };

  const runAutoLayout = useCallback((group: SVGGElement) => {
    const isFlex = group.getAttribute('data-layout') === 'flex';
    if (!isFlex) return;

    const direction = group.getAttribute('data-direction') || 'horizontal';
    const gap = parseInt(group.getAttribute('data-gap') || '0');
    const padding = parseInt(group.getAttribute('data-padding') || '0');

    let currentOffset = padding;
    const children = Array.from(group.children).filter(c => c.tagName !== 'title' && c.tagName !== 'desc') as SVGElement[];

    children.forEach((child) => {
      try {
        const childBBox = (child as any).getBBox();
        if (direction === 'horizontal') {
          child.setAttribute('transform', `translate(${currentOffset}, ${padding})`);
          currentOffset += childBBox.width + gap;
        } else {
          child.setAttribute('transform', `translate(${padding}, ${currentOffset})`);
          currentOffset += childBBox.height + gap;
        }
      } catch (e) {}
    });
  }, []);

  const updateLayoutProperty = (group: SVGGElement, prop: string, value: string) => {
    group.setAttribute(`data-${prop}`, value);
    runAutoLayout(group);
    
    if (selectedElements.length === 1 && selectedElements[0] === group) {
      setLayoutProps(prev => ({
        ...prev,
        [prop]: prop === 'direction' ? value : parseInt(value)
      }));
    }
    
    const currentSvg = canvasRef.current?.querySelector('svg');
    if (currentSvg) setSvgContent(currentSvg.outerHTML);
  };

  const updateShadowProperty = (prop: keyof ShadowProps, value: any) => {
    if (selectedElements.length === 0) return;

    const newProps = { ...shadowProps, [prop]: value };
    setShadowProps(newProps);

    selectedElements.forEach(el => {
      if (!newProps.enabled) {
        el.style.filter = '';
        return;
      }
      const rgba = hexToRgba(newProps.color, newProps.opacity);
      el.style.filter = `drop-shadow(${newProps.x}px ${newProps.y}px ${newProps.blur}px ${rgba})`;
    });

    const currentSvg = canvasRef.current?.querySelector('svg');
    if (currentSvg) setSvgContent(currentSvg.outerHTML);
  };

  const updateGradientProperty = (prop: keyof GradientProps, value: any) => {
    if (selectedElements.length === 0) return;
    const newGradient = { ...gradientProps, [prop]: value };
    setGradientProps(newGradient);

    const rootSvg = canvasRef.current?.querySelector('svg');
    if (!rootSvg) return;

    let defs = rootSvg.querySelector('defs');
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      rootSvg.prepend(defs);
    }

    selectedElements.forEach(el => {
      if (!newGradient.enabled) {
        el.setAttribute('fill', el.getAttribute('data-orig-fill') || el.getAttribute('fill') || '#cccccc');
        return;
      }

      if (!el.getAttribute('data-orig-fill')) {
        el.setAttribute('data-orig-fill', el.getAttribute('fill') || '#cccccc');
      }

      const gradId = el.id ? `grad-${el.id}` : `grad-${Math.random().toString(36).substr(2, 5)}`;
      let gradEl = defs?.querySelector(`#${gradId}`);
      if (!gradEl) {
        gradEl = document.createElementNS('http://www.w3.org/2000/svg', newGradient.type === 'linear' ? 'linearGradient' : 'radialGradient');
        gradEl.setAttribute('id', gradId);
        defs?.appendChild(gradEl);
      } else if (gradEl.tagName.toLowerCase() !== (newGradient.type === 'linear' ? 'linearGradient' : 'radialGradient').toLowerCase()) {
        const newGradEl = document.createElementNS('http://www.w3.org/2000/svg', newGradient.type === 'linear' ? 'linearGradient' : 'radialGradient');
        newGradEl.setAttribute('id', gradId);
        gradEl.replaceWith(newGradEl);
        gradEl = newGradEl;
      }

      if (newGradient.type === 'linear') {
        const rad = (newGradient.angle * Math.PI) / 180;
        gradEl.setAttribute('x1', `${Math.round(50 - Math.cos(rad) * 50)}%`);
        gradEl.setAttribute('y1', `${Math.round(50 - Math.sin(rad) * 50)}%`);
        gradEl.setAttribute('x2', `${Math.round(50 + Math.cos(rad) * 50)}%`);
        gradEl.setAttribute('y2', `${Math.round(50 + Math.cos(rad) * 50)}%`);
      } else {
        gradEl.setAttribute('cx', '50%');
        gradEl.setAttribute('cy', '50%');
        gradEl.setAttribute('r', '50%');
      }

      gradEl.innerHTML = '';
      newGradient.stops.forEach(stop => {
        const stopEl = document.createElementNS('http://www.w3.org/2000/svg', 'stop');
        stopEl.setAttribute('offset', `${stop.offset}%`);
        stopEl.setAttribute('stop-color', stop.color);
        gradEl?.appendChild(stopEl);
      });

      el.setAttribute('fill', `url(#${gradId})`);
    });

    const currentSvg = canvasRef.current?.querySelector('svg');
    if (currentSvg) setSvgContent(currentSvg.outerHTML);
  };

  const updateGradientStop = (index: number, stop: Partial<GradientStop>) => {
    const newStops = [...gradientProps.stops];
    newStops[index] = { ...newStops[index], ...stop };
    updateGradientProperty('stops', newStops);
  };

  const addGradientStop = () => {
    const newStops = [...gradientProps.stops, { offset: 100, color: '#000000' }];
    updateGradientProperty('stops', newStops);
  };

  const removeGradientStop = (index: number) => {
    if (gradientProps.stops.length <= 2) return;
    const newStops = gradientProps.stops.filter((_, i) => i !== index);
    updateGradientProperty('stops', newStops);
  };

  const hexToRgba = (hex: string, alpha: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const createAutoLayoutGroup = () => {
    if (selectedElements.length < 2) return;
    const rootSvg = canvasRef.current?.querySelector('svg');
    if (!rootSvg) return;

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('data-layout', 'flex');
    group.setAttribute('data-direction', 'horizontal');
    group.setAttribute('data-gap', '16');
    group.setAttribute('data-padding', '16');
    group.setAttribute('id', `layout-${Math.random().toString(36).substr(2, 9)}`);

    const firstElem = selectedElements[0];
    firstElem.parentNode?.insertBefore(group, firstElem);
    selectedElements.forEach(el => group.appendChild(el));

    runAutoLayout(group);
    setSelectedElements([group]);
    
    const currentSvg = canvasRef.current?.querySelector('svg');
    if (currentSvg) setSvgContent(currentSvg.outerHTML);
  };

  const ungroup = () => {
    if (selectedElements.length !== 1 || selectedElements[0].tagName !== 'g') return;
    const group = selectedElements[0] as SVGGElement;
    const parent = group.parentNode;
    if (!parent) return;

    const children = Array.from(group.children) as SVGElement[];
    children.forEach(child => parent.insertBefore(child, group));
    group.remove();
    setSelectedElements(children);
    
    const currentSvg = canvasRef.current?.querySelector('svg');
    if (currentSvg) setSvgContent(currentSvg.outerHTML);
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const svgEl = target.closest('path, rect, circle, ellipse, text, g') as SVGElement | null;

    if (svgEl && svgEl.tagName !== 'svg') {
      let nextSelection = [...selectedElements];
      if (e.shiftKey) {
        if (nextSelection.includes(svgEl)) {
          nextSelection = nextSelection.filter(item => item !== svgEl);
        } else {
          nextSelection.push(svgEl);
        }
      } else {
        nextSelection = [svgEl];
      }
      setSelectedElements(nextSelection);
    } else {
      setSelectedElements([]);
    }
  };

  useEffect(() => {
    if (selectedElements.length === 0) {
      setBbox(null);
      return;
    }

    // Cast to SVGElement to avoid "unknown" type errors for attribute access
    const firstEl = selectedElements[0] as SVGElement;

    // Update Layout Props
    if (selectedElements.length === 1 && firstEl.tagName === 'g') {
      const el = firstEl;
      const isLayout = el.getAttribute('data-layout') === 'flex';
      setLayoutProps({
        enabled: isLayout,
        direction: (el.getAttribute('data-direction') as any) || 'horizontal',
        gap: parseInt(el.getAttribute('data-gap') || '16'),
        padding: parseInt(el.getAttribute('data-padding') || '16')
      });
    } else {
      setLayoutProps(prev => ({ ...prev, enabled: false }));
    }

    // Update Shadow Props
    const filter = firstEl.style.filter;
    if (filter && filter.includes('drop-shadow')) {
      const match = filter.match(/drop-shadow\(([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s+(rgba?\(.*?\))\)/i);
      if (match) {
        setShadowProps(prev => ({
          ...prev,
          enabled: true,
          x: parseFloat(match[1]),
          y: parseFloat(match[2]),
          blur: parseFloat(match[3])
        }));
      }
    } else {
      setShadowProps(prev => ({ ...prev, enabled: false }));
    }

    // Update Gradient Props from selection
    const fill = firstEl.getAttribute('fill');
    if (fill && fill.startsWith('url(#')) {
      const gradId = fill.slice(5, -1);
      const rootSvg = canvasRef.current?.querySelector('svg');
      const gradEl = rootSvg?.querySelector(`#${gradId}`);
      if (gradEl) {
        const stops = Array.from(gradEl.querySelectorAll('stop')).map(s => ({
          offset: parseInt(s.getAttribute('offset') || '0'),
          color: s.getAttribute('stop-color') || '#000000'
        }));
        setGradientProps({
          enabled: true,
          type: gradEl.tagName.toLowerCase().includes('linear') ? 'linear' : 'radial',
          angle: 90, // We don't parse back the complex angle logic yet
          stops: stops.length > 0 ? stops : gradientProps.stops
        });
      }
    } else {
      setGradientProps(prev => ({ ...prev, enabled: false }));
    }

    // Update BBox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    selectedElements.forEach(el => {
      try {
        const rect = (el as any).getBBox();
        const transform = el.getAttribute('transform') || '';
        const m = transform.match(/translate\(([^,)]+),?\s*([^)]*)\)/);
        const tx = m ? parseFloat(m[1]) : 0;
        const ty = m ? parseFloat(m[2]) : 0;
        
        minX = Math.min(minX, rect.x + tx);
        minY = Math.min(minY, rect.y + ty);
        maxX = Math.max(maxX, rect.x + rect.width + tx);
        maxY = Math.max(maxY, rect.y + rect.height + ty);
      } catch (e) {}
    });
    if (minX !== Infinity) {
      setBbox({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    } else {
      setBbox(null);
    }
  }, [selectedElements]);

  const handleGenerate = async () => {
    setIsGenerating(true);
    setQuotaError(false);
    setSystemError(null);
    setSelectedElements([]);
    setLoadingMessage('Strategizing Layout...');
    
    try {
      const db = await generateDesignBrief(attachedFiles, [], manualPrompt, selectedPreset, selectedModel);
      setBrief(db);
      setLoadingMessage('Forging Premium Vectors...');
      const svg = await generateSVGDesign(db, selectedModel);
      setSvgContent(svg);
      setActiveTab('canvas');
    } catch (err: any) {
      console.error("Generation Error:", err);
      const errorStr = JSON.stringify(err);
      
      if (err.message === "ENTITY_NOT_FOUND" || errorStr.includes("Requested entity was not found.")) {
        setSystemError("API Key session invalid. Re-selecting...");
        setIsApiKeySelected(false);
        handleSelectKey();
        return;
      }

      const isQuota = 
        err?.status === 429 || 
        err?.message?.includes('429') || 
        errorStr.includes('429') || 
        errorStr.includes('RESOURCE_EXHAUSTED');

      if (isQuota) {
        setQuotaError(true);
      } else {
        setSystemError(err.message || "Generation failed. Please try again.");
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportSvg = () => {
    if (!svgContent) return;
    const base64 = safeBtoa(svgContent);
    const a = document.createElement('a');
    a.href = 'data:image/svg+xml;base64,' + base64;
    a.download = 'vector_visions_design.svg';
    a.click();
  };

  const handleCopySvg = async () => {
    if (!svgContent) return;
    try {
      await navigator.clipboard.writeText(svgContent);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <div className="flex h-screen w-full bg-[#0b0f19] text-slate-200 overflow-hidden font-sans">
      {/* Sidebar Left */}
      <aside className="w-80 border-r border-slate-800 flex flex-col glass z-20">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center font-bold text-white shadow-lg">V</div>
            <h1 className="font-bold text-lg tracking-tight">Visions Studio</h1>
          </div>
          <button 
            onClick={handleSelectKey} 
            className={`p-2 rounded-lg transition-all ${!isApiKeySelected ? 'bg-amber-500/20 text-amber-500 border border-amber-500/30 animate-pulse' : 'hover:bg-slate-800 text-slate-500'}`} 
            title="Configure Pro API Key"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-8 custom-scrollbar">
          {quotaError && (
            <div className="bg-amber-500/10 border border-amber-500/30 p-5 rounded-2xl space-y-4 animate-in fade-in shadow-2xl ring-2 ring-amber-500/20 relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
              <div className="flex items-center gap-3 text-amber-400">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                <p className="text-xs font-bold uppercase tracking-widest">Quota Limit (429)</p>
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed font-medium">
                You've hit the rate limit. Please try switching to <strong>Flash Engine</strong> or connect a <strong>paid project</strong> for higher throughput.
              </p>
              <Button size="sm" className="w-full bg-amber-500 hover:bg-amber-400 text-black border-0 font-bold py-3 shadow-lg" onClick={handleSelectKey}>Connect Paid Project</Button>
            </div>
          )}

          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Generation Engine</label>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[9px] font-bold uppercase tracking-tighter border border-emerald-500/20">Free Optimized</span>
            </div>
            <div className="flex bg-slate-900/50 rounded-xl p-1 border border-slate-800">
              <button 
                onClick={() => setSelectedModel('gemini-3-flash-preview')}
                className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all ${selectedModel === 'gemini-3-flash-preview' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Flash
              </button>
              <button 
                onClick={() => setSelectedModel('gemini-3-pro-preview')}
                className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all ${selectedModel === 'gemini-3-pro-preview' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
              >
                Pro
              </button>
            </div>
          </section>

          <section className="space-y-4">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Style Preset</label>
            <div className="grid grid-cols-1 gap-2">
              {COMPONENT_PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => setSelectedPreset(p)}
                  className={`text-left px-4 py-3 rounded-xl text-xs font-semibold border transition-all ${selectedPreset === p ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400 shadow-inner' : 'bg-slate-900/30 border-slate-800 text-slate-500 hover:border-slate-700'}`}
                >
                  {p}
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Design Prompt</label>
            <textarea
              className="w-full h-28 bg-slate-900 border border-slate-800 rounded-2xl p-4 text-xs text-slate-100 focus:ring-2 focus:ring-indigo-500/30 outline-none resize-none transition-all"
              placeholder="e.g. Modern Minimalist Fintech Dashboard..."
              value={manualPrompt}
              onChange={(e) => setManualPrompt(e.target.value)}
            />
            <Button className="w-full py-4 font-bold bg-indigo-600 hover:bg-indigo-500 uppercase text-xs tracking-widest shadow-2xl shadow-indigo-500/20" isLoading={isGenerating} onClick={handleGenerate}>
              {isGenerating ? loadingMessage : 'Forge All Free'}
            </Button>
          </section>

          {brief && (
            <section className="bg-slate-900/50 p-5 rounded-2xl border border-slate-800 space-y-4 animate-in slide-in-from-bottom-2">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Asset Metadata</label>
              <div className="text-[11px] font-medium leading-relaxed bg-black/20 p-3 rounded-xl border border-slate-800 text-slate-300">{brief.suggestedTitle}</div>
              <div className="flex flex-wrap gap-1.5 h-24 overflow-y-auto custom-scrollbar pt-1">
                {brief.keywords?.map((k, i) => (
                  <span key={i} className="px-2 py-0.5 bg-slate-800 text-[9px] rounded-full text-slate-400 border border-slate-700">{k}</span>
                ))}
              </div>
            </section>
          )}
        </div>
      </aside>

      {/* Main Canvas Area */}
      <main className="flex-1 flex flex-col relative bg-[#0b0f19]">
        <header className="h-16 border-b border-slate-900 glass flex items-center justify-between px-8 z-10">
          <div className="flex bg-slate-900 rounded-xl p-1 border border-slate-800">
            <button className={`px-4 py-1.5 text-[10px] font-bold uppercase rounded-lg transition-all ${activeTab === 'canvas' ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`} onClick={() => setActiveTab('canvas')}>Canvas</button>
            <button className={`px-4 py-1.5 text-[10px] font-bold uppercase rounded-lg transition-all ${activeTab === 'code' ? 'bg-slate-700 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`} onClick={() => setActiveTab('code')}>Source</button>
          </div>

          <div className="flex gap-3">
            {selectedElements.length > 1 && (
              <Button size="sm" onClick={createAutoLayoutGroup} className="bg-indigo-600 hover:bg-indigo-500 font-bold uppercase text-[10px] border-0">Auto Layout</Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleCopySvg} disabled={!svgContent} className="px-5 font-bold uppercase text-[10px] border border-slate-700">
              {isCopied ? 'Copied!' : 'Copy SVG'}
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExportSvg} disabled={!svgContent} className="px-5 font-bold uppercase text-[10px] border-slate-700">Export SVG</Button>
          </div>
        </header>

        <div className="flex-1 relative overflow-auto p-12 canvas-bg custom-scrollbar" ref={canvasRef}>
          {activeTab === 'canvas' ? (
            <div className="flex items-center justify-center min-h-full">
              {svgContent ? (
                <div onMouseDown={handleCanvasMouseDown} className="shadow-2xl bg-white rounded-lg relative transition-transform duration-200" style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}>
                  <div dangerouslySetInnerHTML={{ __html: svgContent }} className="pointer-events-auto" />
                  {bbox && (
                    <div className="absolute pointer-events-none border-2 border-indigo-500 ring-2 ring-indigo-500/20" style={{ left: bbox.x - 2, top: bbox.y - 2, width: bbox.width + 4, height: bbox.height + 4 }}>
                      <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-indigo-500 shadow-sm" />
                      <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-indigo-500 shadow-sm" />
                      <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border-2 border-indigo-500 shadow-sm" />
                      <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border-2 border-indigo-500 shadow-sm" />
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6 opacity-10">
                  <div className="w-40 h-40 border-4 border-dashed border-slate-500 rounded-[3rem] animate-pulse" />
                  <p className="font-bold text-sm uppercase tracking-[0.4em] text-slate-400">Empty Canvas</p>
                </div>
              )}
            </div>
          ) : (
            <div className="relative w-full h-full group">
              <textarea className="w-full h-full bg-[#0b0f19] p-8 font-mono text-[11px] text-indigo-300 outline-none border-0 custom-scrollbar" value={svgContent} readOnly />
              <button 
                onClick={handleCopySvg}
                className="absolute top-4 right-4 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-bold uppercase rounded-lg border border-slate-700 transition-all opacity-0 group-hover:opacity-100"
              >
                {isCopied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          )}
        </div>
        
        <div className="absolute bottom-6 right-6 flex bg-slate-900/90 border border-slate-800 rounded-xl p-1 shadow-2xl backdrop-blur-md transition-all hover:scale-105">
          <button onClick={() => setZoom(z => Math.max(0.1, z - 0.1))} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 font-bold transition-colors">-</button>
          <div className="px-3 flex items-center text-[10px] font-bold w-12 justify-center text-slate-200">{Math.round(zoom * 100)}%</div>
          <button onClick={() => setZoom(z => Math.min(5, z + 0.1))} className="p-2 hover:bg-slate-800 rounded-lg text-slate-400 font-bold transition-colors">+</button>
        </div>
      </main>

      {/* Sidebar Right */}
      <aside className="w-80 border-l border-slate-800 glass hidden lg:flex flex-col shadow-2xl">
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Inspector</h2>
          {svgContent && (
            <button onClick={() => { setSvgContent(''); setBrief(null); setSelectedElements([]); }} className="text-[9px] font-bold text-slate-600 hover:text-red-400 uppercase tracking-tighter transition-colors">Clear</button>
          )}
        </div>
        
        <div className="p-6 space-y-10 overflow-y-auto custom-scrollbar">
          {selectedElements.length > 0 ? (
            <div className="space-y-8 animate-in slide-in-from-right-2">
              {layoutProps.enabled && (
                <div className="space-y-6 bg-indigo-500/5 p-4 rounded-2xl border border-indigo-500/20">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Auto Layout</h3>
                    <button onClick={ungroup} className="p-1 hover:text-red-400 transition-colors" title="Ungroup"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h8m-8 6h16"></path></svg></button>
                  </div>
                  <div className="flex bg-slate-900 rounded-xl p-1 border border-slate-800">
                    <button onClick={() => updateLayoutProperty(selectedElements[0] as SVGGElement, 'direction', 'horizontal')} className={`flex-1 py-1.5 text-[9px] font-bold uppercase rounded-lg transition-all ${layoutProps.direction === 'horizontal' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500'}`}>Row</button>
                    <button onClick={() => updateLayoutProperty(selectedElements[0] as SVGGElement, 'direction', 'vertical')} className={`flex-1 py-2 text-[10px] font-bold uppercase rounded-lg transition-all ${layoutProps.direction === 'vertical' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500'}`}>Column</button>
                  </div>
                </div>
              )}

              {/* Advanced Gradient Section */}
              <div className="space-y-6 bg-slate-900/30 p-4 rounded-2xl border border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Advanced Gradient</h3>
                  <input 
                    type="checkbox" 
                    checked={gradientProps.enabled} 
                    onChange={(e) => updateGradientProperty('enabled', e.target.checked)}
                    className="w-4 h-4 accent-indigo-500 cursor-pointer"
                  />
                </div>
                
                {gradientProps.enabled && (
                  <div className="space-y-4 pt-2">
                    <div className="flex bg-slate-900 rounded-xl p-1 border border-slate-800">
                      <button onClick={() => updateGradientProperty('type', 'linear')} className={`flex-1 py-1.5 text-[9px] font-bold uppercase rounded-lg transition-all ${gradientProps.type === 'linear' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500'}`}>Linear</button>
                      <button onClick={() => updateGradientProperty('type', 'radial')} className={`flex-1 py-1.5 text-[9px] font-bold uppercase rounded-lg transition-all ${gradientProps.type === 'radial' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-500'}`}>Radial</button>
                    </div>

                    {gradientProps.type === 'linear' && (
                      <div className="space-y-2">
                        <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase">
                          <span>Angle</span>
                          <span className="text-indigo-400">{gradientProps.angle}°</span>
                        </div>
                        <input type="range" min="0" max="360" value={gradientProps.angle} onChange={(e) => updateGradientProperty('angle', parseInt(e.target.value))} className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer" />
                      </div>
                    )}

                    <div className="space-y-3">
                      <div className="flex justify-between items-center">
                        <label className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Color Stops</label>
                        <button onClick={addGradientStop} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-400 rounded-lg transition-colors">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4"></path></svg>
                        </button>
                      </div>
                      
                      <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                        {gradientProps.stops.map((stop, idx) => (
                          <div key={idx} className="flex items-center gap-2 p-2 bg-slate-900/50 rounded-xl border border-slate-800/50">
                            <input type="color" value={stop.color} onChange={(e) => updateGradientStop(idx, { color: e.target.value })} className="w-6 h-6 rounded-md bg-transparent border-0 cursor-pointer p-0" />
                            <input type="number" value={stop.offset} onChange={(e) => updateGradientStop(idx, { offset: parseInt(e.target.value) })} className="w-10 bg-transparent text-[10px] text-slate-300 font-mono focus:outline-none" min="0" max="100" />
                            <span className="text-[9px] text-slate-600 font-bold">%</span>
                            <div className="flex-1">
                               <input type="range" min="0" max="100" value={stop.offset} onChange={(e) => updateGradientStop(idx, { offset: parseInt(e.target.value) })} className="w-full h-1 accent-indigo-500 bg-slate-800 rounded-full appearance-none cursor-pointer" />
                            </div>
                            <button onClick={() => removeGradientStop(idx)} className="text-slate-600 hover:text-red-400 transition-colors">
                               <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Shadow Section */}
              <div className="space-y-6 bg-slate-900/30 p-4 rounded-2xl border border-slate-800">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Advanced Shadow</h3>
                  <input 
                    type="checkbox" 
                    checked={shadowProps.enabled} 
                    onChange={(e) => updateShadowProperty('enabled', e.target.checked)}
                    className="w-4 h-4 accent-indigo-500 cursor-pointer"
                  />
                </div>
                
                {shadowProps.enabled && (
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase">
                        <span>Offset X</span>
                        <span className="text-indigo-400">{shadowProps.x}px</span>
                      </div>
                      <input type="range" min="-50" max="50" value={shadowProps.x} onChange={(e) => updateShadowProperty('x', parseInt(e.target.value))} className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase">
                        <span>Offset Y</span>
                        <span className="text-indigo-400">{shadowProps.y}px</span>
                      </div>
                      <input type="range" min="-50" max="50" value={shadowProps.y} onChange={(e) => updateShadowProperty('y', parseInt(e.target.value))} className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between text-[9px] font-bold text-slate-500 uppercase">
                        <span>Blur Radius</span>
                        <span className="text-indigo-400">{shadowProps.blur}px</span>
                      </div>
                      <input type="range" min="0" max="100" value={shadowProps.blur} onChange={(e) => updateShadowProperty('blur', parseInt(e.target.value))} className="w-full accent-indigo-500 h-1 bg-slate-800 rounded-full appearance-none cursor-pointer" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] text-slate-500 font-bold uppercase">Shadow Color</label>
                      <input type="color" value={shadowProps.color} onChange={(e) => updateShadowProperty('color', e.target.value)} className="w-full h-8 bg-slate-900 border border-slate-800 rounded-lg cursor-pointer overflow-hidden" />
                    </div>
                  </div>
                )}
              </div>

              {/* Geometry Section */}
              <div className="space-y-6">
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Geometry</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 font-bold uppercase">X Pos</label>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-xs font-mono text-slate-300">{Math.round(bbox?.x || 0)}</div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] text-slate-500 font-bold uppercase">Y Pos</label>
                    <div className="bg-slate-900 p-2 rounded-lg border border-slate-800 text-xs font-mono text-slate-300">{Math.round(bbox?.y || 0)}</div>
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-slate-800">
                <button 
                  className="w-full py-3 bg-red-500/10 text-red-500 border border-red-500/20 rounded-2xl text-[10px] font-bold uppercase hover:bg-red-500 hover:text-white transition-all shadow-lg"
                  onClick={() => {
                    selectedElements.forEach(el => el.remove());
                    setSelectedElements([]);
                    const currentSvg = canvasRef.current?.querySelector('svg');
                    if (currentSvg) setSvgContent(currentSvg.outerHTML);
                  }}
                >
                  Delete Selected
                </button>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center opacity-20 text-center gap-4">
               <svg className="w-12 h-12 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"></path></svg>
               <p className="text-[10px] font-bold uppercase tracking-widest leading-relaxed">Select items to<br/>inspect properties</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

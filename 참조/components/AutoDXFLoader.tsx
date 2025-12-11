import React, { useState, useEffect, useRef } from 'react';
import MultiDXFViewer from './MultiDXFViewer';
import { DXFFile, PRESET_COLORS } from '../types';

const AutoDXFLoader: React.FC = () => {
  const [dxfFiles, setDxfFiles] = useState<DXFFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [manualMode, setManualMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadDXFFiles();
  }, []);

  const loadDXFFiles = async () => {
    try {
      setLoading(true);
      setError('');
      setManualMode(false);
      
      // Attempt to load from /DXF folder using Vite's glob import
      // We use ?raw query to ensure we get the text content
      const dxfModules = (import.meta as any).glob('/DXF/*.dxf', { query: '?raw', import: 'default' });
      const paths = Object.keys(dxfModules);
      
      const files: DXFFile[] = [];
      let colorIndex = 0;
      
      if (paths.length > 0) {
        for (const path of paths) {
          try {
            const content = await dxfModules[path]();
            const fileName = path.split('/').pop() || 'unknown.dxf';
            
            if (typeof content === 'string') {
               files.push({
                id: `auto-${colorIndex}`,
                name: fileName,
                content: content,
                color: PRESET_COLORS[colorIndex % PRESET_COLORS.length],
                visible: true
              });
              colorIndex++;
            }
          } catch (err) {
            console.warn(`Failed to load ${path}`, err);
          }
        }
      }

      if (files.length === 0) {
        // If no files found, switch to manual mode without error
        console.log('No auto-loaded files found. Switching to manual mode.');
        setManualMode(true);
      } else {
        setDxfFiles(files);
      }
      
    } catch (err) {
      console.error('Auto-load failed:', err);
      setError('Failed to auto-load files.');
      setManualMode(true);
    } finally {
      setLoading(false);
    }
  };

  const handleManualFileAdd = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    const newFiles: DXFFile[] = [];
    // Start colors from where we left off
    let colorIndex = dxfFiles.length;

    const readers: Promise<void>[] = [];

    Array.from(files).forEach((file, i) => {
      // Check extension
      if (!file.name.toLowerCase().endsWith('.dxf')) return;

      const reader = new FileReader();
      const promise = new Promise<void>((resolve) => {
        reader.onload = (e) => {
          const content = e.target?.result as string;
          if (content) {
            newFiles.push({
              id: `manual-${Date.now()}-${i}`,
              name: file.name,
              content: content,
              color: PRESET_COLORS[colorIndex % PRESET_COLORS.length],
              visible: true
            });
            colorIndex++;
          }
          resolve();
        };
        reader.readAsText(file);
      });
      readers.push(promise);
    });

    await Promise.all(readers);
    
    if (newFiles.length > 0) {
      setDxfFiles(prev => [...prev, ...newFiles]);
      setError('');
    }
    
    setLoading(false);
    if (event.target) event.target.value = '';
  };

  const handleRemoveFile = (id: string) => {
    setDxfFiles(prev => prev.filter(f => f.id !== id));
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to remove all loaded files?')) {
      setDxfFiles([]);
    }
  };

  if (loading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-zinc-950 text-white">
        <div className="text-6xl mb-6 animate-pulse">📐</div>
        <div className="text-2xl font-light tracking-wide">Processing DXF Files...</div>
      </div>
    );
  }

  // Render View if we have files OR we are in manual mode
  // If manual mode active but no files, we show the upload UI (handled inside this block)
  if (manualMode || dxfFiles.length > 0) {
     const hasFiles = dxfFiles.length > 0;

     return (
      <div className="flex flex-col w-screen h-screen bg-zinc-950 overflow-hidden">
        {/* Header / Toolbar */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-zinc-900 to-zinc-800 border-b border-zinc-700 shadow-md z-10">
          <div className="flex items-center gap-4">
            <span className="text-2xl">🏗️</span>
            <h1 className="text-xl font-bold text-gray-100 tracking-tight">
              3D DXF Viewer
            </h1>
          </div>

          <div className="flex items-center gap-3">
             <input
                ref={fileInputRef}
                type="file"
                accept=".dxf"
                multiple
                onChange={handleManualFileAdd}
                className="hidden"
                id="file-upload"
              />
              <label
                htmlFor="file-upload"
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-md cursor-pointer transition-colors shadow-lg shadow-blue-900/20"
              >
                <span>➕</span> Add DXF
              </label>

              {hasFiles && (
                <button
                  onClick={handleClearAll}
                  className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-bold rounded-md transition-colors"
                >
                  Clear All
                </button>
              )}
          </div>
        </div>

        {/* File List Bar (Visible if files exist) */}
        {hasFiles && (
            <div className="px-6 py-2 bg-zinc-900/50 border-b border-zinc-800 flex flex-wrap gap-2 max-h-32 overflow-y-auto">
              {dxfFiles.map((file, idx) => (
                <div key={file.id} className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded border border-white/10">
                   <span className="text-xs text-gray-500 font-mono">#{idx + 1}</span>
                   <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: file.color }} />
                   <span className="text-xs text-gray-200 max-w-[120px] truncate" title={file.name}>{file.name}</span>
                   <button 
                     onClick={() => handleRemoveFile(file.id)}
                     className="ml-1 text-gray-500 hover:text-red-400"
                   >
                     ✕
                   </button>
                </div>
              ))}
            </div>
        )}

        {/* Main Content Area */}
        <div className="flex-1 relative">
          {hasFiles ? (
            <MultiDXFViewer files={dxfFiles} />
          ) : (
            /* Empty State for Manual Mode */
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 gap-6">
               <div className="text-8xl opacity-20">🏗️</div>
               <div className="text-center">
                  <h2 className="text-2xl font-bold text-gray-300 mb-2">Ready to View</h2>
                  <p className="text-gray-400">Click the <span className="text-blue-400">Add DXF</span> button above to upload files.</p>
               </div>
               
               {error && (
                 <div className="bg-orange-500/10 border border-orange-500/30 text-orange-400 px-4 py-3 rounded-lg max-w-md text-center text-sm">
                    ⚠️ {error}
                 </div>
               )}

               <div className="mt-8 p-6 bg-white/5 border border-dashed border-white/10 rounded-xl max-w-lg text-sm leading-relaxed text-gray-400">
                  <h3 className="font-bold text-green-400 mb-3">Supported Features</h3>
                  <ul className="space-y-1 list-disc list-inside">
                    <li>Multi-file viewing with auto-coloring</li>
                    <li>Toggle visibility per file</li>
                    <li>Pan, Zoom, and Orbit 3D controls</li>
                    <li>Supports standard ASCII DXF (AutoCAD 2000+)</li>
                  </ul>
               </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return null; // Should not reach here
};

export default AutoDXFLoader;
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
    let colorIndex = dxfFiles.length;

    const readers: Promise<void>[] = [];

    Array.from(files).forEach((file, i) => {
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
    if (window.confirm('모든 파일을 제거하시겠습니까?')) {
      setDxfFiles([]);
    }
  };

  // 로딩 스피너
  if (loading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white">
        <style>{`
          @keyframes rotate360 {
            from { transform: rotateY(0deg); }
            to { transform: rotateY(360deg); }
          }
          .logo-rotate {
            animation: rotate360 2s linear infinite;
            transform-style: preserve-3d;
          }
        `}</style>

        {/* 로고 - 원본 비율, 360도 회전 */}
        <div className="mb-8" style={{ perspective: '1000px' }}>
          <img
            src="/logo.jpg"
            alt="SeaStar Logo"
            className="logo-rotate h-auto max-w-[300px] shadow-2xl rounded-lg"
            style={{ maxHeight: '80px' }}
          />
        </div>

        {/* 로딩 스피너 */}
        <div className="relative mb-6">
          <div className="w-16 h-16 border-4 border-blue-500/30 rounded-full"></div>
          <div className="absolute top-0 left-0 w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        </div>

        <div className="text-xl font-light tracking-wide text-blue-300">DXF 파일 처리 중...</div>
        <div className="text-sm text-gray-500 mt-2">잠시만 기다려주세요</div>
      </div>
    );
  }

  if (manualMode || dxfFiles.length > 0) {
    const hasFiles = dxfFiles.length > 0;

    return (
      <div className="flex flex-col w-screen h-screen bg-gray-900 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-800 to-gray-850 border-b border-gray-700 shadow-md z-10">
          <div className="flex items-center gap-3">
            {/* 로고 - 원본 비율 */}
            <img src="/logo.jpg" alt="SeaStar Logo" className="h-8 w-auto rounded shadow" />
            <h1 className="text-lg font-bold text-gray-100 tracking-tight">
              3D DXF Viewer
            </h1>
          </div>

          <div className="flex items-center gap-2">
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
              className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded cursor-pointer transition-colors shadow"
            >
              ➕ DXF 추가
            </label>

            {hasFiles && (
              <button
                onClick={handleClearAll}
                className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-sm font-medium rounded transition-colors"
              >
                모두 지우기
              </button>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 relative">
          {hasFiles ? (
            <MultiDXFViewer files={dxfFiles} />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 gap-6">
              <img src="/logo.jpg" alt="Logo" className="w-24 h-24 rounded-xl opacity-50" />
              <div className="text-center">
                <h2 className="text-2xl font-bold text-gray-300 mb-2">DXF 파일을 업로드하세요</h2>
                <p className="text-gray-400">상단의 <span className="text-blue-400">DXF 추가</span> 버튼을 클릭하세요.</p>
              </div>

              {error && (
                <div className="bg-orange-500/10 border border-orange-500/30 text-orange-400 px-4 py-3 rounded-lg max-w-md text-center text-sm">
                  ⚠️ {error}
                </div>
              )}

              <div className="mt-6 p-5 bg-white/5 border border-dashed border-white/10 rounded-xl max-w-lg text-sm leading-relaxed text-gray-400">
                <h3 className="font-bold text-green-400 mb-3">지원 기능</h3>
                <ul className="space-y-1 list-disc list-inside">
                  <li>멀티 파일 뷰잉 (자동 색상 지정)</li>
                  <li>Section Box (범위 자르기)</li>
                  <li>X-Ray / 와이어프레임 모드</li>
                  <li>레이어별 가시성 및 투명도 조절</li>
                  <li>3D 회전, 확대/축소, 이동</li>
                </ul>
              </div>
            </div>
          )}
        </div>

        {/* Footer - 저작권 */}
        <div className="px-4 py-2 bg-gray-800 border-t border-gray-700 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-2">
            <img src="/logo.jpg" alt="SeaStar Logo" className="h-4 w-auto rounded" />
            <span>© 2025 SeaStar. All rights reserved.</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="https://github.com/byjay/3DVIEW" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors">
              GitHub
            </a>
            <span>Powered by Three.js</span>
          </div>
        </div>
      </div>
    );
  }

  return null;
};

export default AutoDXFLoader;
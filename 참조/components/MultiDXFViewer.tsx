import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { DXFFile } from '../types';

interface MultiDXFViewerProps {
  files: DXFFile[];
}

// Helper types for the parser
interface DXFEntity {
  type: string;
  layer?: string;
  // Common coordinates
  x?: number; y?: number; z?: number;
  x1?: number; y1?: number; z1?: number;
  x2?: number; y2?: number; z2?: number;
  // Specific properties
  vertices?: {x:number, y:number, z:number}[];
  controlPoints?: {x:number, y:number, z:number}[];
  knots?: number[];
  degree?: number;
  closed?: boolean;
  blockName?: string; // For INSERT
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  rotation?: number; // For INSERT
  scale?: {x:number, y:number, z:number}; // For INSERT
  [key: string]: any;
}

const MultiDXFViewer: React.FC<MultiDXFViewerProps> = ({ files }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [wireframeMode, setWireframeMode] = useState(false);
  const [loadedFiles, setLoadedFiles] = useState<DXFFile[]>([]);
  
  // Three.js references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  // Initialize Three.js
  useEffect(() => {
    if (!containerRef.current) return;

    // Dispose old renderer if exists
    if (rendererRef.current) {
      rendererRef.current.dispose();
      containerRef.current.innerHTML = '';
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111111); // Darker background
    sceneRef.current = scene;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500000);
    camera.position.set(1000, 1000, 1000);
    camera.up.set(0, 0, 1); // Z-up for CAD usually
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, logarithmicDepthBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.screenSpacePanning = true;
    controls.minDistance = 1;
    controls.maxDistance = 500000;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(100, 100, 200);
    scene.add(dirLight);

    // Grid (XY Plane)
    const gridHelper = new THREE.GridHelper(5000, 50, 0x444444, 0x222222);
    gridHelper.rotation.x = Math.PI / 2; // Rotate to lie on XY plane if Z is up
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(500);
    scene.add(axesHelper);

    // Animation Loop
    let animationId: number;
    const animate = () => {
      animationId = requestAnimationFrame(animate);
      if (controlsRef.current) controlsRef.current.update();
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    };
    animate();

    const handleResize = () => {
      if (!containerRef.current || !cameraRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
      renderer.dispose();
      // eslint-disable-next-line react-hooks/exhaustive-deps
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  // Handle File Loading
  useEffect(() => {
    if (files.length > 0 && sceneRef.current) {
      loadAllDXFFiles(files);
    }
  }, [files]);

  // ==========================================
  // 🧠 Robust DXF Parser Implementation
  // ==========================================
  const parseDXF = (content: string, color: string): THREE.Group => {
    const group = new THREE.Group();
    const lines = content.split(/\r?\n/);
    
    // Data stores
    const blocks: Record<string, DXFEntity[]> = {};
    const entities: DXFEntity[] = [];
    
    // State machine
    let section: string | null = null;
    let currentBlockName: string | null = null;
    let currentBlockEntities: DXFEntity[] = [];
    let currentEntity: DXFEntity | null = null;
    
    // Commit current entity to the appropriate list
    const commitEntity = () => {
      if (!currentEntity) return;
      
      if (section === 'BLOCKS' && currentBlockName) {
        currentBlockEntities.push(currentEntity);
      } else if (section === 'ENTITIES') {
        entities.push(currentEntity);
      }
      currentEntity = null;
    };

    // --- Pass 1: Parse Structure (Entities & Blocks) ---
    for (let i = 0; i < lines.length - 1; i += 2) {
      const codeStr = lines[i].trim();
      const value = lines[i+1].trim();
      if(codeStr === '') continue; // skip empty lines
      
      const code = parseInt(codeStr, 10);
      if (isNaN(code)) continue;

      // Group Code 0: Start of entity or separator
      if (code === 0) {
        commitEntity(); // Finish previous entity

        if (value === 'SECTION') {
          section = null; // Wait for section name
        } else if (value === 'ENDSEC') {
          section = null;
        } else if (value === 'BLOCK') {
          currentBlockName = ''; // Start block definition
          currentBlockEntities = [];
        } else if (value === 'ENDBLK') {
          if (currentBlockName) {
            blocks[currentBlockName] = currentBlockEntities;
          }
          currentBlockName = null;
          currentBlockEntities = [];
        } else {
          // New Entity Start
          if ((section === 'ENTITIES') || (section === 'BLOCKS' && currentBlockName !== null)) {
             currentEntity = { type: value };
          }
        }
      }
      
      // Group Code 2: Section Name or Block Name
      else if (code === 2) {
        if (section === null && (value === 'ENTITIES' || value === 'BLOCKS')) {
          section = value;
        } else if (section === 'BLOCKS' && currentBlockName === '') {
          currentBlockName = value; // Capture block name
        } else if (currentEntity && (currentEntity.type === 'INSERT')) {
          currentEntity.blockName = value; // INSERT referencing a block
        }
      }
      
      // Entity Properties
      else if (currentEntity) {
        const valNum = parseFloat(value);
        
        switch(code) {
          // Coordinates
          case 10: currentEntity.x = valNum; break;
          case 20: currentEntity.y = valNum; break;
          case 30: currentEntity.z = valNum; break;
          case 11: currentEntity.x1 = valNum; break; // OR endpoint for Line
          case 21: currentEntity.y1 = valNum; break;
          case 31: currentEntity.z1 = valNum; break;
          case 12: currentEntity.x2 = valNum; break;
          case 22: currentEntity.y2 = valNum; break;
          case 32: currentEntity.z2 = valNum; break;
          case 13: currentEntity.x3 = valNum; break;
          case 23: currentEntity.y3 = valNum; break;
          case 33: currentEntity.z3 = valNum; break;
          
          // Circle/Arc
          case 40: 
            if (currentEntity.knots) currentEntity.knots.push(valNum); // Spline knot
            else currentEntity.radius = valNum; 
            break;
          case 50: currentEntity.startAngle = valNum; break;
          case 51: currentEntity.endAngle = valNum; break;
          
          // Insert
          case 41: if(!currentEntity.scale) currentEntity.scale = {x:1,y:1,z:1}; currentEntity.scale.x = valNum; break;
          case 42: if(!currentEntity.scale) currentEntity.scale = {x:1,y:1,z:1}; currentEntity.scale.y = valNum; break;
          case 43: if(!currentEntity.scale) currentEntity.scale = {x:1,y:1,z:1}; currentEntity.scale.z = valNum; break;
          case 50: currentEntity.rotation = valNum; break; // Rotation in degrees

          // Polyline/Spline vertices (simplified)
          case 10: // Vertices often repeat 10, 20, 30
             // Handled by overriding x, y, z. For Polylines, we need logic for vertex lists.
             // But simpler approach for LWPOLYLINE is storing arrays.
             break;
        }

        // Special handling for LWPOLYLINE and SPLINE control points
        if (currentEntity.type === 'LWPOLYLINE') {
           if (code === 10) {
             if (!currentEntity.vertices) currentEntity.vertices = [];
             currentEntity.vertices.push({ x: valNum, y: 0, z: 0 });
           }
           if (code === 20 && currentEntity.vertices) {
             const v = currentEntity.vertices[currentEntity.vertices.length - 1];
             if (v) v.y = valNum;
           }
           if (code === 70) currentEntity.closed = (valNum & 1) === 1;
        }
        
        if (currentEntity.type === 'SPLINE') {
          if (code === 10) {
             if (!currentEntity.controlPoints) currentEntity.controlPoints = [];
             currentEntity.controlPoints.push({ x: valNum, y: 0, z: 0 });
          }
          if (code === 20 && currentEntity.controlPoints) {
             const v = currentEntity.controlPoints[currentEntity.controlPoints.length - 1];
             if (v) v.y = valNum;
          }
          if (code === 30 && currentEntity.controlPoints) {
             const v = currentEntity.controlPoints[currentEntity.controlPoints.length - 1];
             if (v) v.z = valNum;
          }
        }
      }
    }
    commitEntity(); // Commit last

    // --- Pass 2: Generate Geometry ---
    const materialLine = new THREE.LineBasicMaterial({ color: new THREE.Color(color) });
    const materialMesh = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, wireframe: wireframeMode });

    // Function to create Three.js object from DXF Entity
    const createObject = (e: DXFEntity): THREE.Object3D | null => {
      try {
        if (e.type === 'LINE') {
          const points = [
            new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0),
            new THREE.Vector3(e.x1 || 0, e.y1 || 0, e.z1 || 0) // Note: DXF uses 10/20/30 for start, 11/21/31 for end
          ];
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          return new THREE.Line(geometry, materialLine);
        }
        
        if (e.type === 'LWPOLYLINE' && e.vertices && e.vertices.length > 1) {
          const points = e.vertices.map(v => new THREE.Vector3(v.x, v.y, e.z || 0)); // LWPolyline uses global elevation
          if (e.closed) points.push(points[0]);
          const geometry = new THREE.BufferGeometry().setFromPoints(points);
          return new THREE.Line(geometry, materialLine);
        }
        
        if (e.type === 'CIRCLE') {
          const curve = new THREE.EllipseCurve(
            0, 0, e.radius || 1, e.radius || 1, 0, 2 * Math.PI, false, 0
          );
          const pts = curve.getPoints(32).map(p => new THREE.Vector3(p.x, p.y, 0));
          const geometry = new THREE.BufferGeometry().setFromPoints(pts);
          const line = new THREE.Line(geometry, materialLine);
          line.position.set(e.x || 0, e.y || 0, e.z || 0);
          return line;
        }

        if (e.type === 'ARC') {
          const start = (e.startAngle || 0) * Math.PI / 180;
          const end = (e.endAngle || 0) * Math.PI / 180;
          const curve = new THREE.EllipseCurve(
            0, 0, e.radius || 1, e.radius || 1, start, end, false, 0
          );
          const pts = curve.getPoints(32).map(p => new THREE.Vector3(p.x, p.y, 0));
          const geometry = new THREE.BufferGeometry().setFromPoints(pts);
          const line = new THREE.Line(geometry, materialLine);
          line.position.set(e.x || 0, e.y || 0, e.z || 0);
          return line;
        }
        
        if (e.type === 'SPLINE' && e.controlPoints && e.controlPoints.length > 1) {
          const vecPoints = e.controlPoints.map(p => new THREE.Vector3(p.x, p.y, p.z || 0));
          const curve = new THREE.CatmullRomCurve3(vecPoints); // Approx spline
          const pts = curve.getPoints(50);
          const geometry = new THREE.BufferGeometry().setFromPoints(pts);
          return new THREE.Line(geometry, materialLine);
        }

        if (e.type === '3DFACE') {
           const pts = [
             new THREE.Vector3(e.x || 0, e.y || 0, e.z || 0),
             new THREE.Vector3(e.x1 || 0, e.y1 || 0, e.z1 || 0),
             new THREE.Vector3(e.x2 || 0, e.y2 || 0, e.z2 || 0),
             new THREE.Vector3(e.x3 || 0, e.y3 || 0, e.z3 || 0)
           ];
           // Triangulate quad
           if (!pts[3].equals(pts[2])) {
             pts.push(pts[0], pts[2]);
           }
           const geometry = new THREE.BufferGeometry().setFromPoints(pts);
           geometry.computeVertexNormals();
           return new THREE.Mesh(geometry, materialMesh);
        }

        // --- Handle BLOCKS (INSERT) ---
        if (e.type === 'INSERT' && e.blockName && blocks[e.blockName]) {
           const blockGroup = new THREE.Group();
           const blockDefs = blocks[e.blockName];
           
           blockDefs.forEach(childE => {
              const childObj = createObject(childE);
              if (childObj) blockGroup.add(childObj);
           });

           blockGroup.position.set(e.x || 0, e.y || 0, e.z || 0);
           
           const scaleX = e.scale?.x ?? 1;
           const scaleY = e.scale?.y ?? 1;
           const scaleZ = e.scale?.z ?? 1;
           blockGroup.scale.set(scaleX, scaleY, scaleZ);

           if (e.rotation) {
             blockGroup.rotation.z = (e.rotation * Math.PI) / 180;
           }
           return blockGroup;
        }

      } catch (err) {
        console.warn('Error parsing entity', e.type, err);
      }
      return null;
    };

    // Render all top-level entities
    let count = 0;
    entities.forEach(e => {
      const obj = createObject(e);
      if (obj) {
        group.add(obj);
        count++;
      }
    });
    
    console.log(`Parsed DXF: ${count} objects created. Blocks found: ${Object.keys(blocks).length}`);
    return group;
  };

  const loadAllDXFFiles = async (dxfFiles: DXFFile[]) => {
    setLoading(true);
    setError('');
    setStatus('Parsing files...');

    try {
      // Clear previous groups
      if (sceneRef.current) {
        const toRemove: THREE.Object3D[] = [];
        sceneRef.current.traverse((child) => {
           if (child.name && (child.name.startsWith('auto-') || child.name.startsWith('manual-'))) {
             toRemove.push(child);
           }
        });
        toRemove.forEach(child => sceneRef.current?.remove(child));
      }

      const loadedDXFs: DXFFile[] = [];
      let totalObjects = 0;
      
      for (const dxfFile of dxfFiles) {
        if (!dxfFile.content || dxfFile.content.length < 10) continue;

        // Verify if it's binary
        if (dxfFile.content.startsWith('AutoCAD Binary DXF')) {
           console.error('Binary DXF not supported', dxfFile.name);
           continue;
        }

        const group = parseDXF(dxfFile.content, dxfFile.color);
        group.name = dxfFile.id;
        group.visible = dxfFile.visible;
        
        if (group.children.length === 0) {
           console.warn(`File ${dxfFile.name} parsed but 0 objects were generated. It might use unsupported entities or be empty.`);
        }
        
        if (sceneRef.current) {
          sceneRef.current.add(group);
        }
        
        totalObjects += group.children.length;
        loadedDXFs.push({ ...dxfFile, group });
      }
      
      setLoadedFiles(loadedDXFs);
      
      if (totalObjects === 0) {
        setError('No viewable objects found in DXF files. Files might be empty, binary, or use unsupported formats.');
      } else {
         fitCamera(loadedDXFs);
      }
      
    } catch (err) {
      console.error('DXF Load Error:', err);
      setError('Critical error while processing files.');
    } finally {
      setLoading(false);
      setStatus('');
    }
  };

  const fitCamera = (files: DXFFile[]) => {
      if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;

      const box = new THREE.Box3();
      let hasObjects = false;
      
      files.forEach(dxf => {
        if (dxf.group && dxf.group.visible) {
          box.expandByObject(dxf.group);
          hasObjects = true;
        }
      });
      
      if (hasObjects && !box.isEmpty()) {
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          
          if (maxDim > 0 && maxDim < Infinity) {
             const fov = cameraRef.current.fov * (Math.PI / 180);
             let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;
             cameraZ = Math.max(cameraZ, maxDim);
             
             cameraRef.current.position.set(
               center.x + cameraZ * 0.5,
               center.y - cameraZ * 0.5, // Look from south-east usually better for CAD
               center.z + cameraZ * 0.5
             );
             cameraRef.current.lookAt(center);
             controlsRef.current.target.copy(center);
             controlsRef.current.update();
          }
      }
  };

  const toggleFileVisibility = (fileId: string) => {
    const updatedFiles = loadedFiles.map(f => {
      if (f.id === fileId) {
        const newVisible = !f.visible;
        if (f.group) f.group.visible = newVisible;
        return { ...f, visible: newVisible };
      }
      return f;
    });
    setLoadedFiles(updatedFiles);
    // Optional: Re-fit camera when visibility changes? 
    // fitCamera(updatedFiles.filter(f => f.visible));
  };

  const toggleWireframe = () => {
    const newMode = !wireframeMode;
    setWireframeMode(newMode);
    if (sceneRef.current) {
      sceneRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => (m as THREE.MeshBasicMaterial).wireframe = newMode);
          } else {
            (child.material as THREE.MeshBasicMaterial).wireframe = newMode;
          }
        }
      });
    }
  };

  return (
    <div className="relative w-full h-full bg-[#111]">
      <div ref={containerRef} className="w-full h-full cursor-crosshair" />
      
      {/* Sidebar */}
      <div className="absolute top-5 right-5 w-72 bg-zinc-900/90 backdrop-blur-md p-4 rounded-xl text-white shadow-2xl border border-white/10 max-h-[85vh] overflow-y-auto custom-scrollbar z-20">
        <div className="flex items-center gap-2 mb-4 pb-2 border-b border-white/20">
          <span className="text-xl">🎮</span>
          <h2 className="font-bold text-lg">Control Panel</h2>
        </div>
        
        <div className="flex gap-2 mb-4">
            <button 
                onClick={toggleWireframe} 
                className={`flex-1 py-2 px-3 rounded font-medium text-xs transition-all border ${wireframeMode ? 'bg-green-600 border-green-500' : 'bg-zinc-800 border-zinc-600 hover:bg-zinc-700'}`}
            >
            Wireframe
            </button>
            <button 
                onClick={() => fitCamera(loadedFiles)} 
                className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 border border-blue-400 rounded font-medium text-xs transition-all"
            >
            Fit Camera
            </button>
        </div>
        
        {loadedFiles.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">Layers / Files</div>
            {loadedFiles.map((file) => (
            <div key={file.id} className="flex items-center gap-3 p-2 bg-black/20 hover:bg-black/40 rounded border border-white/5 transition-colors">
                <input
                    type="checkbox"
                    checked={file.visible}
                    onChange={() => toggleFileVisibility(file.id)}
                    className="w-4 h-4 rounded cursor-pointer accent-blue-500"
                />
                <div 
                    className="w-3 h-3 rounded-full shadow-sm"
                    style={{ backgroundColor: file.color, boxShadow: `0 0 8px ${file.color}` }} 
                />
                <span className="flex-1 text-xs truncate font-mono text-gray-300" title={file.name}>
                    {file.name}
                </span>
            </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats/Info */}
      <div className="absolute bottom-6 left-6 bg-zinc-900/80 backdrop-blur-sm p-4 rounded-lg text-white border border-white/10 pointer-events-none z-10">
        <div className="flex items-center gap-2 text-gray-400 text-xs mb-1">
             <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
             READY
        </div>
        <div className="text-xs text-gray-500">
           Mouse: Left (Rotate), Right (Pan), Wheel (Zoom)
        </div>
      </div>

      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm">
          <div className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <span className="text-lg font-light tracking-widest text-blue-400 animate-pulse">{status || 'PROCESSING...'}</span>
        </div>
      )}

      {/* Error Overlay */}
      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-950/90 p-8 rounded-2xl border border-red-500/50 shadow-2xl text-center max-w-md z-50">
            <div className="text-5xl mb-4">⚠️</div>
            <h3 className="text-xl font-bold text-red-200 mb-2">Parsing Error</h3>
            <p className="text-red-300/80 text-sm leading-relaxed">{error}</p>
            <button 
                onClick={() => setError('')}
                className="mt-6 px-6 py-2 bg-red-900/50 hover:bg-red-800/50 border border-red-500/30 rounded-lg text-red-200 text-sm transition-colors"
            >
                Dismiss
            </button>
        </div>
      )}
    </div>
  );
};

export default MultiDXFViewer;
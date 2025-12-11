import * as THREE from 'three';

// DXF 파일 인터페이스
export interface DXFFile {
  id: string;
  name: string;
  content: string;
  color: string;
  visible: boolean;
  group?: THREE.Group;
}

// DXF 엔티티 인터페이스
export interface DXFEntity {
  type: string;
  layer?: string;
  x?: number; y?: number; z?: number;
  x1?: number; y1?: number; z1?: number;
  x2?: number; y2?: number; z2?: number;
  x3?: number; y3?: number; z3?: number;
  vertices?: { x: number; y: number; z: number }[];
  controlPoints?: { x: number; y: number; z: number }[];
  knots?: number[];
  degree?: number;
  closed?: boolean;
  blockName?: string;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  rotation?: number;
  scale?: { x: number; y: number; z: number };
  [key: string]: any;
}

// 객체 트리 노드
export interface ObjectTreeNode {
  id: number;
  name: string;
  type: string;
  properties: {
    name: string;
    type: string;
    material: string;
    volume: string;
    visible: boolean;
    originalColor: number;
    originalPosition: THREE.Vector3;
  };
  object: THREE.Object3D;
  children: ObjectTreeNode[];
}

// 히스토리 엔트리 (Undo용)
export interface HistoryEntry {
  objects: {
    obj: THREE.Object3D;
    position: THREE.Vector3;
  }[];
}

// 슬라이스 상태
export interface SliceState {
  enabled: boolean;
  planes: THREE.Plane[];
  box: THREE.Mesh | null;
  start: { x: number; y: number } | null;
}

// 뷰 타입
export type ViewType = 'front' | 'back' | 'left' | 'right' | 'top' | 'iso';

// 렌더 모드
export type RenderMode = 'shaded' | 'wireframe';

// 측정 포인트
export interface MeasurementPoint {
  position: THREE.Vector3;
  marker: THREE.Mesh;
}

// 측정 상태
export interface MeasurementState {
  enabled: boolean;
  points: MeasurementPoint[];
  line: THREE.Line | null;
  label: THREE.Sprite | null;
}

// 뷰어 상태
export interface ViewerState {
  objects: THREE.Object3D[];
  selectedObjects: THREE.Object3D[];
  objectTree: ObjectTreeNode[];
  expandedNodes: Record<number, boolean>;
  renderMode: RenderMode;
  history: HistoryEntry[];
  slice: SliceState;
  measurement: MeasurementState;
  showSubView: boolean;
}

// 프리셋 색상
export const PRESET_COLORS = [
  '#FF5252', '#FF4081', '#E040FB', '#7C4DFF',
  '#536DFE', '#448AFF', '#40C4FF', '#18FFFF',
  '#64FFDA', '#69F0AE', '#B2FF59', '#EEFF41',
  '#FFFF00', '#FFD740', '#FFAB40', '#FF6E40'
];

// 객체 색상 (샘플용)
export const OBJECT_COLORS = [0xff6b6b, 0x4ecdc4, 0x45b7d1, 0xf9ca24, 0x6c5ce7, 0x95a5a6, 0xe74c3c];
import * as THREE from 'three';

export interface DXFFile {
  id: string;
  name: string;
  content: string;
  color: string;
  visible: boolean;
  opacity: number;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  group?: THREE.Group;
}

export interface EntityData {
  type: string;
  points: THREE.Vector3[];
}

// Preset colors for automatic assignment
export const PRESET_COLORS = [
  '#FF5252', '#FF4081', '#E040FB', '#7C4DFF',
  '#536DFE', '#448AFF', '#40C4FF', '#18FFFF',
  '#64FFDA', '#69F0AE', '#B2FF59', '#EEFF41',
  '#FFFF00', '#FFD740', '#FFAB40', '#FF6E40'
];
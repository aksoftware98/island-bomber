import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MAPS } from './maps.js';

export const ISLAND_FILE = 'assets/island.glb';
export const TRUCK_FILE = 'assets/pickup_aa.glb';

export const JETS = [
  { id: 'f16', name: 'Bluebird', file: 'assets/jet_f16.glb', color: '#2f6fdc', blurb: 'Classic. Sensible. Slightly smug.' },
  { id: 'f35', name: 'Greenbean', file: 'assets/jet_f35.glb', color: '#23a34f', blurb: 'Stubby, and proud of it.' },
  { id: 'f22', name: 'Grape Ape', file: 'assets/jet_f22.glb', color: '#6c35cf', blurb: 'Long, purple and dramatic.' },
];

const loader = new GLTFLoader();
const cache = new Map();
export let largeMapData = { buildings: [], pad: [12, 0, 80] };

export async function loadAll(onProgress) {
  const files = [...MAPS.map((m) => m.file), TRUCK_FILE, ...JETS.map((j) => j.file)];
  const response = await fetch('assets/island_large.json');
  if (!response.ok) throw new Error('Could not load large island metadata');
  largeMapData = await response.json();
  let done = 0;
  await Promise.all(
    files.map((file) =>
      loader.loadAsync(file).then((gltf) => {
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          for (const m of [].concat(o.material)) {
            m.flatShading = true;
            m.needsUpdate = true;
          }
        });
        cache.set(file, gltf.scene);
        onProgress?.(++done / files.length);
      }),
    ),
  );
}

/** The loaded scene itself (use once, for the island). */
export const getSource = (file) => cache.get(file);

/** A copy that shares geometry and materials with the original. */
export const getModel = (file) => cache.get(file).clone();

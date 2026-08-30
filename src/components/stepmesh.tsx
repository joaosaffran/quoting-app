/**
 * Plain-data shape for a single parsed mesh/body coming out of occt-import-js.
 * Deliberately NOT a three.js object — these are held in React state at the
 * QuotingApp level and handed to whichever <ComponentViewer> needs them, so the
 * (relatively expensive) WASM parse only has to happen once per uploaded file.
 */
export interface ParsedMeshData {
  position: number[] | Float32Array;
  normal?: number[] | Float32Array;
  index: number[] | Uint32Array;
  color?: [number, number, number];
}
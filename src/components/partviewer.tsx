"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RotateCcw, Box as BoxIcon, AlertTriangle } from "lucide-react";
import type { ParsedMeshData } from "@/components/stepmesh";

const ACCENT = "#FF5C1A";
const PANEL = "#15181C";
const VIEWPORT = "#1A1D21";
const HAIRLINE_DARK = "#2A2E33";

type Status = "loading" | "ready" | "error";

interface PartViewerProps {
  /** The raw STEP/STP file the user selected. Parsed entirely client-side. */
  file: File;
  /** Whether the backend quote request is still in flight. */
  analyzing?: boolean;
  /** Current stage label to show while analyzing (e.g. "Solving toolpaths & setups…"). */
  stageLabel?: string;
  /** 0–100 progress for the analyzing bar. */
  stageProgress?: number;
  /** Fired once with the raw per-body mesh data after a successful parse, so the parent
   *  can build a lightweight preview for each billed component without re-parsing the file. */
  onMeshesParsed?: (meshes: ParsedMeshData[]) => void;
  /** Fired if the client-side parse fails — the parent can still show results without a preview. */
  onMeshesError?: (message: string) => void;
}

export default function PartViewer({
  file,
  analyzing = false,
  stageLabel,
  stageProgress = 0,
  onMeshesParsed,
  onMeshesError,
}: PartViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelGroupRef = useRef<THREE.Group | null>(null);
  const frameRef = useRef<number>(0);

  const [status, setStatus] = useState<Status>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [wireframe, setWireframe] = useState(false);
  const [bodyCount, setBodyCount] = useState(0);

  // Flip existing materials between solid/wireframe without re-parsing the file.
  useEffect(() => {
    modelGroupRef.current?.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.MeshStandardMaterial).wireframe = wireframe;
      }
    });
  }, [wireframe]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    setStatus("loading");
    setErrorMessage("");

    // ---------- scene setup ----------
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(5, 8, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe4d1, 0.35);
    fill.position.set(-6, 2, -4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.25);
    rim.position.set(-2, -4, -6);
    scene.add(rim);

    const grid = new THREE.GridHelper(400, 40, 0x2a2e33, 0x1e2126);
    const gridMat = grid.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.6;
    scene.add(grid);

    rendererRef.current = renderer;
    cameraRef.current = camera;
    controlsRef.current = controls;

    const resize = () => {
      if (!container) return;
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const frame = (group: THREE.Group) => {
      const box = new THREE.Box3().setFromObject(group);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      group.position.sub(center);

      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const distance = maxDim * 1.8;
      camera.near = maxDim / 100;
      camera.far = maxDim * 100;
      camera.position.set(distance, distance * 0.8, distance);
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
      grid.position.y = -size.y / 2;
    };

    // ---------- parse the STEP file (WASM OpenCascade, runs entirely in-browser) ----------
    (async () => {
      try {
        const occtimportjs = (await import("occt-import-js")).default;
        const occt = await occtimportjs({
          locateFile: (path: string) => (path.endsWith(".wasm") ? "/occt-import-js.wasm" : path),
        });

        const buffer = await file.arrayBuffer();
        const result = occt.ReadStepFile(new Uint8Array(buffer), {
          linearUnit: "millimeter",
          linearDeflectionType: "bounding_box_ratio",
          linearDeflection: 0.3,
        });

        if (cancelled) return;
        if (!result.success || !result.meshes || result.meshes.length === 0) {
          setStatus("error");
          const message = "Couldn't extract a viewable mesh from this file.";
          setErrorMessage(message);
          onMeshesError?.(message);
          return;
        }

        const group = new THREE.Group();
        for (const mesh of result.meshes) {
          const geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
          if (mesh.attributes.normal) {
            geometry.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3));
          }
          geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(mesh.index.array), 1));
          if (!mesh.attributes.normal) geometry.computeVertexNormals();

          const material = new THREE.MeshStandardMaterial({
            color: mesh.color ? new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]) : 0xb9bdc4,
            metalness: 0.75,
            roughness: 0.35,
            wireframe,
          });

          group.add(new THREE.Mesh(geometry, material));
        }

        frame(group);
        scene.add(group);
        modelGroupRef.current = group;
        setBodyCount(result.meshes.length);
        setStatus("ready");

        onMeshesParsed?.(
          result.meshes.map((mesh: any) => ({
            position: mesh.attributes.position.array,
            normal: mesh.attributes.normal?.array,
            index: mesh.index.array,
            color: mesh.color,
          }))
        );
      } catch (err) {
        if (cancelled) return;
        console.error("STEP preview failed:", err);
        setStatus("error");
        const message = "Couldn't render a 3D preview for this file.";
        setErrorMessage(message);
        onMeshesError?.(message);
      }
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameRef.current);
      resizeObserver.disconnect();
      controls.dispose();
      modelGroupRef.current?.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => m.dispose());
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      modelGroupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const resetView = () => {
    const group = modelGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!group || !camera || !controls) return;
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const distance = maxDim * 1.8;
    camera.position.set(distance, distance * 0.8, distance);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  return (
    <div className="overflow-hidden rounded-xl border" style={{ borderColor: HAIRLINE_DARK }}>
      <div className="flex items-center justify-between px-4 py-2.5" style={{ backgroundColor: PANEL }}>
        <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-slate-400">
          <BoxIcon className="h-3.5 w-3.5" style={{ color: ACCENT }} />
          Part Preview
          {status === "ready" && bodyCount > 1 && <span className="text-slate-600">· {bodyCount} bodies</span>}
        </div>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setWireframe((w) => !w)}
            disabled={status !== "ready"}
            className="font-mono text-[11px] uppercase tracking-widest text-slate-400 transition-colors hover:text-white disabled:opacity-30"
          >
            {wireframe ? "Solid" : "Wireframe"}
          </button>
          <button
            type="button"
            onClick={resetView}
            disabled={status !== "ready"}
            className="text-slate-400 transition-colors hover:text-white disabled:opacity-30"
            aria-label="Reset view"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="relative h-80 w-full sm:h-96" style={{ backgroundColor: VIEWPORT }}>
        <div ref={containerRef} className="absolute inset-0 cursor-grab active:cursor-grabbing" />

        {status === "loading" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ backgroundColor: `${VIEWPORT}E6` }}>
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-700" style={{ borderTopColor: ACCENT }} />
            <p className="font-mono text-[11px] uppercase tracking-widest text-slate-500">Rendering geometry…</p>
          </div>
        )}

        {status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <AlertTriangle className="h-5 w-5 text-slate-500" />
            <p className="text-sm text-slate-400">{errorMessage}</p>
            <p className="font-mono text-[11px] text-slate-600">
              Quote unaffected — pricing came from the server-side geometry read.
            </p>
          </div>
        )}

        {status === "ready" && !analyzing && (
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-widest text-slate-500">
            Drag to rotate · Scroll to zoom
          </p>
        )}
      </div>

      {analyzing && (
        <div className="border-t px-4 py-3" style={{ borderColor: HAIRLINE_DARK, backgroundColor: PANEL }}>
          <div className="mb-2 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-slate-300">
              <span
                className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-slate-700"
                style={{ borderTopColor: ACCENT }}
              />
              Analyzing Geometry
            </div>
            <span className="truncate font-mono text-[11px] text-slate-500">{stageLabel}</span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full rounded-full transition-all duration-500 ease-out ${
                stageProgress >= 100 ? "animate-pulse" : ""
              }`}
              style={{ width: `${stageProgress}%`, backgroundColor: ACCENT }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
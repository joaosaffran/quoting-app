import cadquery as cq
import math
from itertools import combinations
from OCP.gp import gp_Pnt, gp_Dir, gp_Lin
from OCP.IntCurvesFace import IntCurvesFace_ShapeIntersector
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

import shutil
import os
import cadquery as cq
# ==========================================
# ESTIMATION CONSTANTS & SHOP RATES
# ==========================================
SHOP_RATE_CAD_PER_HR = 150.0            # $150 CAD/hour
SHOP_RATE_CAD_PER_MIN = SHOP_RATE_CAD_PER_HR / 60.0

# Adjusted for realistic machine dynamics and steel MRR
MRR_ROUGH_MM3_MIN = 3000.0              # Realistic roughing MRR (mm^3/min)
SETUP_TIME_MIN = 15.0                   # 15 minutes to flip and zero the part per side
TOOL_CHANGE_OVERHEAD_MIN = 3.0          # Time per setup for tool changes (rough to finish) and rapids

COST_PER_DRILL_HOLE = 100.0             # Fixed cost for tooling/locating a drill hole
COST_PER_SHARP_CORNER = 500.0           # Massive penalty for requiring EDM or custom broaching

# ==========================================
# ALGORITHM FUNCTIONS
# ==========================================

def get_unique_setups(shape):
    """
    Estimate the minimum number of 3-axis setups required.
    """
    directions = {
        '+Z': cq.Vector(0, 0, 1),
        '-Z': cq.Vector(0, 0, -1),
        '+X': cq.Vector(1, 0, 0),
        '-X': cq.Vector(-1, 0, 0),
        '+Y': cq.Vector(0, 1, 0),
        '-Y': cq.Vector(0, -1, 0),
    }

    bbox = shape.BoundingBox()
    max_dim = max(bbox.xlen, bbox.ylen, bbox.zlen)
    stock_tol = max(1e-5, max_dim * 1e-7)

    def is_stock_boundary_face(face):
        fb = face.BoundingBox()
        return (
            (abs(fb.xmin - bbox.xmin) <= stock_tol and abs(fb.xmax - bbox.xmin) <= stock_tol) or
            (abs(fb.xmin - bbox.xmax) <= stock_tol and abs(fb.xmax - bbox.xmax) <= stock_tol) or
            (abs(fb.ymin - bbox.ymin) <= stock_tol and abs(fb.ymax - bbox.ymin) <= stock_tol) or
            (abs(fb.ymin - bbox.ymax) <= stock_tol and abs(fb.ymax - bbox.ymax) <= stock_tol) or
            (abs(fb.zmin - bbox.zmin) <= stock_tol and abs(fb.zmax - bbox.zmin) <= stock_tol) or
            (abs(fb.zmin - bbox.zmax) <= stock_tol and abs(fb.zmax - bbox.zmax) <= stock_tol)
        )

    def sample_face(face, count=5):
        points = []
        try:
            points.append(face.Center())
        except Exception:
            pass
        try:
            u_min, u_max, v_min, v_max = face.uvBounds()
            for i in range(1, count + 1):
                u = u_min + (u_max - u_min) * i / (count + 1)
                for j in range(1, count + 1):
                    v = v_min + (v_max - v_min) * j / (count + 1)
                    try:
                        points.append(face.positionAt(u, v))
                    except Exception:
                        pass
        except Exception:
            pass

        unique = []
        for p in points:
            if not any((p - q).Length < 0.01 for q in unique):
                unique.append(p)
        return unique

    requirements = []

    for face in shape.Faces():
        if is_stock_boundary_face(face):
            continue

        if face.geomType() == 'CYLINDER':
            continue

        samples = sample_face(face, 5)
        if not samples:
            continue

        if face.geomType() != 'PLANE':
            has_upper = False
            has_lower = False
            for point in samples:
                try:
                    n = face.normalAt(point)
                except Exception:
                    continue
                if n.z > 1e-4:
                    has_upper = True
                elif n.z < -1e-4:
                    has_lower = True

            if has_upper:
                requirements.append({'+Z'})
            if has_lower:
                requirements.append({'-Z'})
            continue

        for point in samples:
            try:
                normal = face.normalAt(point)
            except Exception:
                continue

            reachable = {
                name for name, tool_dir in directions.items()
                if normal.dot(tool_dir) >= -0.05
            }
            if reachable:
                requirements.append(reachable)

    all_dirs = list(directions.keys())

    for num_setups in range(1, len(all_dirs) + 1):
        for combo in combinations(all_dirs, num_setups):
            chosen = set(combo)
            if all(req & chosen for req in requirements):
                return num_setups

    return len(all_dirs)

def count_drill_holes(shape):
    unique_hole_centers = []
    cylinders = [f for f in shape.Faces() if f.geomType() == "CYLINDER"]
    
    for f in cylinders:
        try:
            bb = f.BoundingBox()
            center = cq.Vector((bb.xmin + bb.xmax)/2, 
                               (bb.ymin + bb.ymax)/2, 
                               (bb.zmin + bb.zmax)/2)
            
            if not any((center - h).Length < 1.0 for h in unique_hole_centers):
                unique_hole_centers.append(center)
        except:
            continue
            
    return len(unique_hole_centers)

def count_sharp_internal_corners(shape):
    unique_corners = set()
    lines = [e for e in shape.Edges() if e.geomType() == "LINE"]
    all_faces = shape.Faces()
    
    MIN_CORNER_LENGTH = 5.0
    
    for edge in lines:
        try:
            if edge.Length() < MIN_CORNER_LENGTH:
                continue
                
            adj_faces = [f for f in all_faces if any(e.isSame(edge) for e in f.Edges())]
            
            if len(adj_faces) == 2:
                f1, f2 = adj_faces
                if f1.geomType() != "PLANE" or f2.geomType() != "PLANE":
                    continue
                    
                edge_dir = edge.tangentAt(0.5)
                if abs(edge_dir.z) < 0.99:
                    continue
                    
                mid = edge.Center()
                n1 = f1.normalAt(mid)
                n2 = f2.normalAt(mid)
                
                c1 = f1.Center()
                c2 = f2.Center()
                vec_f1_to_f2 = c2 - c1
                
                if n1.dot(vec_f1_to_f2) > 0.0:
                    angle = math.degrees(n1.getAngle(n2))
                    if abs(angle - 90.0) < 1.0:
                        face_pair_signature = tuple(sorted([
                            (round(c1.x, 3), round(c1.y, 3), round(c1.z, 3)),
                            (round(c2.x, 3), round(c2.y, 3), round(c2.z, 3))
                        ]))
                        unique_corners.add(face_pair_signature)
                        
        except Exception as e:
            print(f"Warning: Edge skipped due to topological error: {e}")
            continue
                
    return len(unique_corners)

def calculate_dynamic_finishing_time(shape, tool_diameter=6.35, feedrate_mm_min=2500.0):
    """
    Analyzes part faces to differentiate between 2D operations and 3D surfacing.
    Calculates toolpath distance based on step-over, returning total finishing time.
    """
    total_finish_time = 0.0
    
    # Define step-over as a percentage of the tool diameter
    stepover_2d = tool_diameter * 0.40 
    stepover_3d = tool_diameter * 0.05 
    
    for face in shape.Faces():
        area = face.Area()
        geom_type = face.geomType()
        
        if geom_type == 'PLANE':
            effective_stepover = stepover_2d
        else:
            effective_stepover = stepover_3d
            
        toolpath_length = area / effective_stepover
        face_time = toolpath_length / feedrate_mm_min
        total_finish_time += face_time
        
    return total_finish_time

def estimate_machining_cost(shape):
    """Core quoting pipeline."""
    # 1. Volumetrics
    bbox = shape.BoundingBox()
    stock_vol = bbox.xlen * bbox.ylen * bbox.zlen
    part_vol = shape.Volume()
    removed_vol = max(0.0, stock_vol - part_vol)
    surface_area = shape.Area()
    
    # 2. Topology & Feature Extraction
    setups = get_unique_setups(shape)
    holes = count_drill_holes(shape)
    sharp_corners = count_sharp_internal_corners(shape)
    
    # 3. Time Calculations
    rough_time = removed_vol / MRR_ROUGH_MM3_MIN
    
    # Calculate finishing time dynamically based on face geometry types
    finish_time = calculate_dynamic_finishing_time(shape, tool_diameter=6.35, feedrate_mm_min=2500.0)
    
    setup_time = setups * SETUP_TIME_MIN
    overhead_time = setups * TOOL_CHANGE_OVERHEAD_MIN
    
    # Ensure total_time accounts for the new tool change overhead
    total_time = rough_time + finish_time + setup_time + overhead_time
    
    # 4. Cost Aggregation
    base_machining_cost = total_time * SHOP_RATE_CAD_PER_MIN
    hole_cost = holes * COST_PER_DRILL_HOLE
    corner_cost = sharp_corners * COST_PER_SHARP_CORNER
    
    total_cost = base_machining_cost + hole_cost + corner_cost
    
    return {
        "metrics": {
            "stock_volume_mm3": stock_vol,
            "removed_volume_mm3": removed_vol,
            "surface_area_mm2": surface_area,
            "setups_required": setups,
            "drill_holes": holes,
            "sharp_internal_edges": sharp_corners
        },
        "times_min": {
            "setup_time": setup_time,
            "rough_time": rough_time,
            "finish_time": finish_time,
            "overhead_time": overhead_time,
            "total_time": total_time
        },
        "costs_cad": {
            "base_machining": base_machining_cost,
            "feature_holes": hole_cost,
            "feature_corners": corner_cost,
            "total_price": total_cost
        }
    }

def quote_assembly(step_file_path):
    print(f"Loading assembly from {step_file_path}...")

    try:
        imported_cad = cq.importers.importStep(step_file_path)
    except Exception as e:
        print(f"Error loading file: {e}")
        return None

    solids = imported_cad.val().Solids()

    if not solids:
        print("No solid bodies found in the file.")
        return None

    print(f"Found {len(solids)} individual components.\n")

    reports = []

    for i, solid_shape in enumerate(solids):
        report = estimate_machining_cost(solid_shape)
        report["component_id"] = i + 1  
        reports.append(report)

    return reports


app = FastAPI()

# Allow your Next.js frontend to communicate with this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/quote")
async def quote_cad(file: UploadFile = File(...)):
    temp_file_path = f"temp_{file.filename}"
    with open(temp_file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    try:
        return quote_assembly(temp_file_path)
    finally:
        if os.path.exists(temp_file_path):
            os.remove(temp_file_path)
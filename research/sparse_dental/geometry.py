"""Calibrated cone-beam geometry for tooth-local research volumes (mm)."""

import numpy as np
from scipy.ndimage import map_coordinates
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation

FDI = tuple(10 * quadrant + index for quadrant in range(1, 5) for index in range(1, 9))
SURFACES = ("mesial", "distal", "facial", "oral", "coronal", "apical")
DIRECTIONS = np.array([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]])
VIEW_NAMES = ("mesial_shift", "straight", "distal_shift")
DEFAULT_ANGLES = (20.0, 0.0, -20.0)
VIEW_SETS = {"1": (1,), "2": (0, 2), "3": (0, 1, 2)}


def surface_names(fdi):
    if fdi not in FDI:
        raise ValueError("Expected a permanent FDI tooth number")
    quadrant, index = divmod(fdi, 10)
    return (
        "mesial", "distal", "labial" if index <= 3 else "buccal",
        "palatal" if quadrant <= 2 else "lingual",
        "incisal" if index <= 3 else "occlusal", "apical",
    )


def unit(vector):
    norm = np.linalg.norm(vector)
    if not np.isfinite(norm) or norm < 1e-6:
        raise ValueError("Degenerate direction")
    return vector / norm


def tooth_frame(centers, fdi, crown, anterior):
    """Return columns pointing mesially, facially and towards the crown."""
    quadrant, index = divmod(fdi, 10)
    crown = unit(np.asarray(crown))
    offset = -1 if index > 1 else 1
    paired = (20 if quadrant == 1 else 10 if quadrant == 2 else
              40 if quadrant == 3 else 30) + 1
    candidates = [(fdi + offset, -offset), (fdi - offset, offset)]
    if index == 1:
        candidates.insert(0, (paired, 1))
    for neighbor, sign in candidates:
        if neighbor in FDI and neighbor in centers:
            tangent = sign * (centers[neighbor] - centers[fdi])
            break
    else:
        raise ValueError("No same-arch neighboring label to establish the mesial axis")
    mesial = unit(tangent - np.dot(tangent, crown) * crown)
    facial = unit(np.cross(crown, mesial))
    superior = -crown if quadrant <= 2 else crown
    patient_left = np.cross(superior, anterior)
    expected = anterior + patient_left * (1 if quadrant in (2, 3) else -1)
    if facial @ expected < 0:
        facial = -facial
    return np.column_stack((mesial, facial, crown))


def volume_grid(size, field_mm):
    if size < 2 or not np.isfinite(field_mm) or field_mm <= 0:
        raise ValueError("Expected a positive field and at least two voxels")
    samples = ((np.arange(size, dtype=np.float32) + 0.5) / size - 0.5) * field_mm
    z, y, x = np.meshgrid(samples, samples, samples, indexing="ij")
    return np.stack((x, y, z), axis=-1)


def view_matrix(angle, pixels, field_mm, source_mm=220.0, detector_mm=250.0):
    if not np.isfinite([angle, field_mm, source_mm, detector_mm]).all() or not (
        0 < field_mm < source_mm < detector_mm and pixels >= 2
    ):
        raise ValueError("Invalid cone-beam detector geometry")
    theta = np.deg2rad(angle)
    source_axis = np.array([np.sin(theta), np.cos(theta), 0.0])
    horizontal = np.array([np.cos(theta), -np.sin(theta), 0.0])
    vertical = np.array([0.0, 0.0, -1.0])
    center = (pixels - 1) / 2
    denominator = np.r_[-source_axis, source_mm]
    detector_pitch_mm = field_mm * detector_mm / (source_mm * pixels)
    focal_length_px = detector_mm / detector_pitch_mm
    return np.stack((
        focal_length_px * np.r_[horizontal, 0.0] + center * denominator,
        focal_length_px * np.r_[vertical, 0.0] + center * denominator,
        denominator,
    ))


def project_points(matrix, xyz):
    homogeneous = xyz @ matrix[:, :3].T + matrix[:, 3]
    if np.any(homogeneous[..., 2] <= 1e-6):
        raise ValueError("Point is behind the camera")
    return homogeneous[..., :2] / homogeneous[..., 2:]


def render_views(attenuation, matrices, pixels, field_mm):
    """Trace pixel-center rays through a resampled attenuation crop."""
    if attenuation.ndim != 3 or len(set(attenuation.shape)) != 1:
        raise ValueError("Expected a cubic attenuation field indexed z, y, x")
    size = attenuation.shape[0]
    yy, xx = np.indices((pixels, pixels), dtype=np.float32)
    detector = np.stack((xx.ravel(), yy.ravel(), np.ones(pixels * pixels)), axis=0)
    images = []
    extent = np.sqrt(3) * field_mm / 2
    steps = int(np.ceil(np.sqrt(3) * size * 1.5))
    step = 2 * extent / steps
    for matrix in matrices:
        linear = matrix[:, :3]
        source = np.linalg.solve(linear, -matrix[:, 3])
        directions = np.linalg.solve(linear, detector).T
        directions /= np.linalg.norm(directions, axis=1, keepdims=True)
        center_distance = -(directions @ source)
        distance = center_distance[:, None] - extent + (np.arange(steps) + 0.5) * step
        points = source + distance[..., None] * directions[:, None, :]
        indices = ((points / field_mm + 0.5) * size - 0.5)[..., ::-1]
        samples = map_coordinates(attenuation, np.moveaxis(indices, -1, 0), order=1,
                                  mode="constant", cval=0.0, prefilter=False)
        images.append((samples.sum(axis=1).reshape(pixels, pixels) * step).astype(np.float32))
    return np.stack(images)


def backproject(images, matrices, size, field_mm):
    grid = volume_grid(size, field_mm)
    volume = []
    for image, matrix in zip(images, matrices, strict=True):
        xy = project_points(matrix, grid)
        volume.append(map_coordinates(image, np.moveaxis(xy[..., ::-1], -1, 0),
                                      order=1, mode="constant", cval=0.0))
    return np.stack(volume).astype(np.float32)


def validate_views(views, minimum=1):
    if not isinstance(views, dict) or not minimum <= len(views) <= 3 or set(views) - set(VIEW_NAMES):
        raise ValueError(f"Expected {minimum}–3 uniquely named calibrated views")
    directions = []
    for view in views.values():
        matrix = np.asarray(view["matrix"], dtype=float)
        if matrix.shape != (3, 4) or not np.isfinite(matrix).all():
            raise ValueError("Expected a finite calibrated 3×4 camera matrix")
        if not np.isfinite(np.linalg.cond(matrix[:, :3])) or np.linalg.cond(matrix[:, :3]) > 1e7:
            raise ValueError("Camera matrix is singular or ill-conditioned")
        source = np.linalg.solve(matrix[:, :3], -matrix[:, 3])
        directions.append(unit(source))
    for i, first in enumerate(directions):
        for second in directions[i + 1:]:
            if np.degrees(np.arccos(np.clip(first @ second, -1, 1))) < 5:
                raise ValueError("Camera positions are too close for this research configuration")


def fit_landmarks(vertices, landmarks, views):
    """Fit one proper similarity transform from operator-matched 2D points."""
    validate_views(views, minimum=2)
    observations = []
    counts = {}
    for view in views.values():
        matrix = np.asarray(view["matrix"], dtype=float)
        for name, pixel in view["landmarks"].items():
            pixel = np.asarray(pixel, dtype=float)
            if name not in landmarks or pixel.shape != (2,) or not np.isfinite(pixel).all():
                raise ValueError("Unexpected landmark name or non-finite pixel coordinate")
            observations.append((matrix, landmarks[name], pixel))
            counts[name] = counts.get(name, 0) + 1
    shared = [landmarks[name] for name, count in counts.items() if count >= 2]
    if len(shared) < 4 or np.linalg.matrix_rank(shared - np.mean(shared, axis=0)) < 3:
        raise ValueError("Mark four non-coplanar corresponding points in two or more views")

    matrices, points, pixels = map(np.asarray, zip(*observations, strict=True))
    def transform(params, xyz):
        return Rotation.from_rotvec(params[:3]).apply(xyz) * np.exp(params[6]) + params[3:6]

    def residuals(params):
        xyz = transform(params, points)
        projected = np.einsum("nij,nj->ni", matrices[:, :, :3], xyz) + matrices[:, :, 3]
        depth = np.maximum(projected[:, 2:], 1e-6)
        return (projected[:, :2] / depth - pixels).ravel()

    result = least_squares(
        residuals, np.zeros(7), loss="soft_l1", f_scale=1.5, max_nfev=200,
        bounds=([-np.inf] * 6 + [np.log(0.6)], [np.inf] * 6 + [np.log(1.6)]),
    )
    transformed = transform(result.x, vertices)
    for view in views.values():
        project_points(np.asarray(view["matrix"]), transformed)
    rms = float(np.sqrt(np.mean(np.sum(result.fun.reshape(-1, 2) ** 2, axis=1))))
    if not result.success or np.linalg.matrix_rank(result.jac) < 7 or rms > 3.0:
        raise ValueError(f"Landmark fit rejected (RMS {rms:.3f} pixels)")
    return transformed, rms

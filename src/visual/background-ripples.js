import * as THREE from 'three';

export function createBackgroundPointField(camera, material, planeZ) {
    // 固定 world space 間距
    const spacing = 0.215;
    // 取得相機參數
    const aspect = window.innerWidth / window.innerHeight;
    const fov = camera.fov * Math.PI / 180;
    // 計算 z = -2 時的可見範圍（相機在 z=8）
    const camZ = camera.position.z;
    const dz = camZ - planeZ;
    const viewHeight = 2 * Math.tan(fov / 2) * dz;
    const viewWidth = viewHeight * aspect;
    const xCount = Math.ceil(viewWidth / spacing) + 2;
    const yCount = Math.ceil(viewHeight / spacing) + 2;
    const xStart = -viewWidth / 2;
    const yStart = -viewHeight / 2;

    const bgPositions = [];
    const bgTypes = [];
    for (let i = 0; i < xCount; i++) {
        for (let j = 0; j < yCount; j++) {
            const x = xStart + i * spacing;
            const y = yStart + j * spacing;
            bgPositions.push(x, y, planeZ);
            bgTypes.push((i + j * 2) % 4);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(bgPositions, 3));
    geometry.setAttribute('aType', new THREE.Float32BufferAttribute(bgTypes, 1));

    const points = new THREE.Points(geometry, material);
    points.renderOrder = 0;

    return points;
}

export function updateBackgroundPointField({
    scene,
    camera,
    material,
    currentPoints,
    planeZ,
    visible
}) {
    if (currentPoints) {
        scene.remove(currentPoints);
        currentPoints.geometry.dispose();
        // material 不要 dispose，會重用
    }

    const points = createBackgroundPointField(camera, material, planeZ);
    scene.add(points);
    points.visible = visible;

    return points;
}

import * as THREE from 'three';

export function updatePianoRollMaskMesh({
    group,
    currentMask,
    pianoContainer,
    getScreenPointOnPlane,
    getPlaneViewSize,
    backgroundColor,
    planeZ
}) {
    if (!group || !pianoContainer) return currentMask;

    if (currentMask) {
        group.remove(currentMask);
        currentMask.geometry.dispose();
        currentMask.material.dispose();
        currentMask = null;
    }

    const containerRect = pianoContainer.getBoundingClientRect();
    if (!containerRect.height || !containerRect.width) return currentMask;

    const maskPlaneZ = planeZ + 0.02;
    const topLeft = getScreenPointOnPlane(0, containerRect.top, maskPlaneZ);
    const bottomRight = getScreenPointOnPlane(window.innerWidth, window.innerHeight, maskPlaneZ);
    const { width: viewWidth } = getPlaneViewSize(maskPlaneZ);
    const maskHeight = Math.max(0.01, topLeft.y - bottomRight.y);

    const geometry = new THREE.PlaneGeometry(viewWidth + 2, maskHeight);
    const material = new THREE.MeshBasicMaterial({
        color: backgroundColor,
        transparent: false,
        depthWrite: false,
        toneMapped: false
    });

    const maskMesh = new THREE.Mesh(geometry, material);
    maskMesh.position.set(0, bottomRight.y + maskHeight * 0.5, maskPlaneZ);
    maskMesh.renderOrder = 2;
    group.add(maskMesh);

    return maskMesh;
}

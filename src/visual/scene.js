import * as THREE from 'three';

export function createVisualScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 8;

    // ?capture 供錄製示範影片用:允許 toDataURL/toBlob 讀取畫面,平常不開以免影響效能
    const preserveDrawingBuffer = new URLSearchParams(window.location.search).has('capture');
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 2.0;
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.2));

    return { scene, camera, renderer };
}

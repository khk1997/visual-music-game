import * as THREE from 'three';

export function createSparkEffect(count, material) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const types = new Float32Array(count);
    const rx = new Float32Array(count);
    const ry = new Float32Array(count);
    const rz = new Float32Array(count);
    const rvx = new Float32Array(count);
    const rvy = new Float32Array(count);
    const rvz = new Float32Array(count);

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aType', new THREE.BufferAttribute(types, 1));
    geo.setAttribute('aRotX', new THREE.BufferAttribute(rx, 1));
    geo.setAttribute('aRotY', new THREE.BufferAttribute(ry, 1));
    geo.setAttribute('aRotZ', new THREE.BufferAttribute(rz, 1));

    const points = new THREE.Points(geo, material);
    points.renderOrder = 2;
    points.visible = false;

    return {
        points,
        geo,
        pos,
        vel,
        sizes,
        alphas,
        types,
        rx,
        ry,
        rz,
        rvx,
        rvy,
        rvz,
        posAttr: geo.attributes.position,
        sizeAttr: geo.attributes.aSize,
        alphaAttr: geo.attributes.aAlpha,
        typeAttr: geo.attributes.aType,
        rotXAttr: geo.attributes.aRotX,
        rotYAttr: geo.attributes.aRotY,
        rotZAttr: geo.attributes.aRotZ
    };
}

export function acquireSparkEffect(parent, pool, count, material) {
    const effect = pool.pop() ?? createSparkEffect(count, material);
    effect.points.visible = true;
    parent.add(effect.points);
    return effect;
}

export function releaseSparkEffect(parent, pool, effect) {
    parent.remove(effect.points);
    effect.points.visible = false;
    pool.push(effect);
}

export function createMistEffect(count, material) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const drift = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);
    const colors = new Float32Array(count * 3);

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

    const points = new THREE.Points(geo, material);
    points.renderOrder = 1;
    points.visible = false;

    return {
        points,
        geo,
        pos,
        drift,
        sizes,
        alphas,
        colors,
        posAttr: geo.attributes.position,
        sizeAttr: geo.attributes.aSize,
        alphaAttr: geo.attributes.aAlpha,
        colorAttr: geo.attributes.aColor
    };
}

export function acquireMistEffect(parent, pool, count, material) {
    const effect = pool.pop() ?? createMistEffect(count, material);
    effect.points.visible = true;
    parent.add(effect.points);
    return effect;
}

export function releaseMistEffect(parent, pool, effect) {
    parent.remove(effect.points);
    effect.points.visible = false;
    pool.push(effect);
}

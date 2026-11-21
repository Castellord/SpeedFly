import * as THREE from "three";

// A sparse volume of windborne grains gives nearby air depth. Wrap the
// volume in world coordinates so turning the pilot never rotates the grains.
export function createAirEffects(scene) {
  const positions = [];
  let seed = 1819;
  function sample() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 4294967296) * 28;
  }
  for (let i = 0; i < 230; i++) positions.push(sample(), sample(), sample());
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      time: { value: 0 },
      density: { value: 0 },
      viewportHeight: { value: 600 },
    },
    vertexShader: `
      uniform float time, density, viewportHeight;
      varying float alpha, warmth;
      void main() {
        float phase = position.x + time * .66;
        vec3 wind = vec3(time*.74 + sin(phase)*.23, sin(position.z + time*.9)*.16 - time*.09, time*.22);
        vec3 delta = mod(position + wind - cameraPosition + 14., 28.) - 14.;
        vec4 eye = viewMatrix * vec4(cameraPosition + delta, 1.);
        float range = length(delta);
        float size = mix(.009,.024,position.y/28.);
        gl_PointSize = clamp(viewportHeight * projectionMatrix[1][1] * size / max(.35,-eye.z), 1., 5.);
        alpha = density * smoothstep(.5,2.3,range) * (1.-smoothstep(7.,13.8,range));
        warmth = position.z/28.;
        gl_Position = projectionMatrix * eye;
      }`,
    fragmentShader: `
      varying float alpha, warmth;
      void main() {
        float r = length(gl_PointCoord - .5);
        gl_FragColor = vec4(mix(vec3(.73,.81,.84),vec3(1.,.88,.61),warmth),
          alpha * (1.-smoothstep(.16,.5,r)));
        #include <colorspace_fragment>
      }`,
  });
  const motes = new THREE.Points(geometry, material);
  motes.frustumCulled = false;
  scene.add(motes);
  return (time, agl, viewportHeight, enabled) => {
    const density = 0.43 * (1 - THREE.MathUtils.smoothstep(agl, 9, 43));
    motes.visible = enabled && density > 0.015;
    material.uniforms.time.value = time;
    material.uniforms.density.value = density;
    material.uniforms.viewportHeight.value = viewportHeight;
  };
}

// Low banks are placed in the valley itself so ridge silhouettes cut into
// them through the normal depth test and the pilot can fly above the layer.
export function createValleyMist(parent, height, river, atlas, rng) {
  const geometry = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1);
  geometry.copy(plane);
  const centers = [],
    shapes = [];
  for (let z = -7700; z < -350; z += 240 + rng() * 430) {
    const x = river(z) + (rng() - 0.5) * 490;
    centers.push(x, height(x, z) + 23 + rng() * 60, z);
    shapes.push(420 + rng() * 660, 58 + rng() * 78, rng(), rng());
  }
  geometry.setAttribute(
    "bankCenter",
    new THREE.InstancedBufferAttribute(new Float32Array(centers), 3),
  );
  geometry.setAttribute(
    "bankShape",
    new THREE.InstancedBufferAttribute(new Float32Array(shapes), 4),
  );
  geometry.instanceCount = centers.length / 3;
  const material = new THREE.ShaderMaterial({
    depthWrite: false,
    transparent: true,
    uniforms: { atlas: { value: atlas }, time: { value: 0 } },
    vertexShader: `
      attribute vec3 bankCenter;
      attribute vec4 bankShape;
      uniform float time;
      varying vec2 bankUV, offset;
      varying float visibility;
      void main() {
        vec3 center = bankCenter + vec3(18.*sin(time*.018+bankShape.z*6.28),0.,0.);
        vec3 delta = cameraPosition - center;
        vec3 across = normalize(vec3(delta.z,.001,-delta.x));
        vec3 p = center + across * position.x * bankShape.x;
        p.y += position.y * bankShape.y;
        bankUV = uv;
        offset = bankShape.zw;
        visibility = smoothstep(140.,550.,length(delta));
        gl_Position = projectionMatrix * viewMatrix * vec4(p,1.);
      }`,
    fragmentShader: `
      varying vec2 bankUV, offset;
      varying float visibility;
      uniform sampler2D atlas;
      uniform float time;
      void main() {
        vec2 q = bankUV*2.-1.;
        float vapor = texture2D(atlas, bankUV*vec2(.69,.23) + offset - vec2(time*.0009,0.)).r;
        float body = 1.-smoothstep(.1,1.,dot(q,q)+(0.50-vapor)*1.25);
        float alpha = visibility*body*smoothstep(.29,.72,vapor)*.39;
        vec3 tint = mix(vec3(.51,.64,.72),vec3(.84,.84,.75),clamp(bankUV.y*.72+vapor*.34,0.,1.));
        gl_FragColor = vec4(tint,alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  parent.add(mesh);
  return { material, geometry };
}

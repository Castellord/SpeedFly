import * as THREE from "three";

// Reconstruct camera motion from depth, so a close slab gets a long exposure
// while the distant ridge stays still. The cockpit and centre of gaze stay sharp.
export function createMotion(renderer) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    samples: Math.min(2, renderer.capabilities.maxSamples),
    colorSpace: THREE.SRGBColorSpace,
  });
  const camera = new THREE.Camera(),
    screen = new THREE.Scene();
  const matrix = new THREE.Matrix4(),
    size = new THREE.Vector2();
  const uniforms = {
    frame: { value: target.texture },
    depthMap: { value: target.depthTexture },
    reprojection: { value: new THREE.Matrix4() },
    pixels: { value: size },
    clips: { value: new THREE.Vector2() },
    gain: { value: 0 },
    shutter: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 uvScreen;
      void main(){uvScreen=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `
      varying vec2 uvScreen;
      uniform sampler2D frame, depthMap;
      uniform mat4 reprojection;
      uniform vec2 pixels, clips;
      uniform float gain, shutter;
      float distanceAt(vec2 uv) {
        float d=texture2D(depthMap,uv).x;
        return clips.x*clips.y / max(.0001,clips.y*(1.-d)+clips.x*d);
      }
      void main(){
        vec2 uv=uvScreen, radial=uv*2.-1.;
        vec3 original=texture2D(frame,uv).rgb;
        float z=distanceAt(uv);
        float effect=gain*smoothstep(.24,.94,length(radial))*smoothstep(1.2,3.4,z)*(1.-smoothstep(42.,135.,z));
        vec3 result=original;
        if(effect>.003){
          float depth=texture2D(depthMap,uv).r;
          vec4 prev=reprojection*vec4(radial,depth*2.-1.,1.);
          vec2 velocity=(prev.xy/max(.001,prev.w)-radial)*.5*pixels*shutter;
          velocity*=min(1.,18./max(.001,length(velocity)))*effect;
          vec2 shift=velocity/pixels;
          vec3 sum=original;
          float weight=1.;
          for(int i=1;i<=4;i++){
            vec2 sampleUV=clamp(uv+shift*(float(i)*.25),vec2(0.),vec2(1.));
            float w=1.-smoothstep(.08,.28,abs(distanceAt(sampleUV)-z)/z);
            sum+=texture2D(frame,sampleUV).rgb*w; weight+=w;
          }
          result=sum/weight;
          vec2 fringe=normalize(radial)*effect*min(1.45,pixels.y*.0016)/pixels;
          result.r+=(texture2D(frame,uv+fringe).r-original.r)*.70;
          result.b+=(texture2D(frame,uv-fringe).b-original.b)*.70;
        }
        gl_FragColor=vec4(max(vec3(0.),result),1.);
        #include <colorspace_fragment>
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  screen.add(quad);
  let previous = null;
  const last = new THREE.Matrix4();
  return (scene, view, gain, dt, snap) => {
    view.updateMatrixWorld();
    matrix.multiplyMatrices(view.projectionMatrix, view.matrixWorldInverse);
    if (gain > 0.008) {
      renderer.getDrawingBufferSize(size);
      target.setSize(size.x, size.y);
      uniforms.reprojection.value
        .copy(matrix)
        .invert()
        .premultiply(snap || !previous ? matrix : last);
      uniforms.clips.value.set(view.near, view.far);
      uniforms.gain.value = gain;
      uniforms.shutter.value = dt > 0 ? Math.min(1, 0.018 / dt) : 0;
      renderer.setRenderTarget(target);
      renderer.render(scene, view);
      renderer.setRenderTarget(null);
      renderer.render(screen, camera);
    } else renderer.render(scene, view);
    last.copy(matrix);
    previous = true;
  };
}
